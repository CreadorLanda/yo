package groups

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Moderation (#333). Muting keeps a member from sending until a time; a ban
// removes them and keeps them from being added back. The actor is a group
// admin or a moderation bot the admins allowed (members.manage) — the bots
// module checks that before calling in. Admins and moderators themselves
// cannot be moderated: a bot never outranks the people who installed it.

var (
	ErrCannotModerate = errors.New("cannot_moderate_admin")
	ErrMemberBanned   = errors.New("member_banned")
	ErrInvalidMute    = errors.New("invalid_mute")
)

// MaxMute is the longest a mute may last; longer than that is a ban.
const MaxMute = 30 * 24 * time.Hour

// lockModerationTarget locks the group and the target's row, and refuses a
// target who is not a plain member.
func lockModerationTarget(ctx context.Context, tx pgx.Tx, chatID, target uuid.UUID) error {
	if err := lockGroupRow(ctx, tx, chatID); err != nil {
		return ErrNotFound
	}
	var role string
	err := tx.QueryRow(ctx, `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2 FOR UPDATE`, chatID, target).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotMember
	}
	if err != nil {
		return err
	}
	if MemberRole(role) != RoleMember {
		return ErrCannotModerate
	}
	return nil
}

func displayName(ctx context.Context, tx pgx.Tx, id uuid.UUID) string {
	var name string
	_ = tx.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name, ''), username, '') FROM users WHERE id = $1`, id).Scan(&name)
	return name
}

// Mute keeps a member from sending until `until`.
func (s *Service) Mute(ctx context.Context, chatID, actor, target uuid.UUID, until time.Time) error {
	until = until.UTC()
	if !until.After(time.Now()) || time.Until(until) > MaxMute {
		return ErrInvalidMute
	}
	err := s.repo.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockModerationTarget(ctx, tx, chatID, target); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE chat_participants SET restricted_until = $3 WHERE chat_id = $1 AND user_id = $2`, chatID, target, until); err != nil {
			return err
		}
		return insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_muted:%s:%s:%d", actor, target, until.Unix()))
	})
	if err == nil {
		s.announceMemberChange(ctx, chatID)
	}
	return err
}

// Unmute lifts a mute early.
func (s *Service) Unmute(ctx context.Context, chatID, actor, target uuid.UUID) error {
	err := s.repo.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockModerationTarget(ctx, tx, chatID, target); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE chat_participants SET restricted_until = NULL
			WHERE chat_id = $1 AND user_id = $2 AND restricted_until > NOW()
		`, chatID, target)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_unmuted:%s:%s", actor, target))
	})
	if err == nil {
		s.announceMemberChange(ctx, chatID)
	}
	return err
}

// Kick removes a member. They can be added back.
func (s *Service) Kick(ctx context.Context, chatID, actor, target uuid.UUID) error {
	return s.removeModerated(ctx, chatID, actor, target, false, "")
}

// Ban removes a member if they are one, and keeps them out.
func (s *Service) Ban(ctx context.Context, chatID, actor, target uuid.UUID, reason string) error {
	if len(reason) > 500 {
		reason = reason[:500]
	}
	err := s.removeModerated(ctx, chatID, actor, target, true, reason)
	if errors.Is(err, ErrNotMember) {
		// Not in the group: a ban still keeps them from being added.
		err = s.repo.inTx(ctx, func(tx pgx.Tx) error {
			if err := lockGroupRow(ctx, tx, chatID); err != nil {
				return ErrNotFound
			}
			if err := insertBan(ctx, tx, chatID, actor, target, reason); err != nil {
				return err
			}
			return insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_banned:%s:%s:%s", actor, target, url.PathEscape(displayName(ctx, tx, target))))
		})
	}
	return err
}

func insertBan(ctx context.Context, tx pgx.Tx, chatID, actor, target uuid.UUID, reason string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO group_bans (chat_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4)
		ON CONFLICT (chat_id, user_id) DO UPDATE SET banned_by = $3, reason = $4, created_at = NOW()
	`, chatID, target, actor, reason)
	return err
}

// removeModerated takes a member out of the group, and bans them when asked.
func (s *Service) removeModerated(ctx context.Context, chatID, actor, target uuid.UUID, ban bool, banReason string) error {
	err := s.repo.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockModerationTarget(ctx, tx, chatID, target); err != nil {
			return err
		}
		name := displayName(ctx, tx, target)
		if _, err := tx.Exec(ctx, `DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2`, chatID, target); err != nil {
			return err
		}
		// The removed member must not read what comes next.
		if _, err := tx.Exec(ctx, `UPDATE chats SET key_epoch = key_epoch + 1 WHERE id = $1`, chatID); err != nil {
			return err
		}
		if ban {
			if err := insertBan(ctx, tx, chatID, actor, target, banReason); err != nil {
				return err
			}
			return insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_banned:%s:%s:%s", actor, target, url.PathEscape(name)))
		}
		return insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_removed:%s:%s:%s", actor, target, url.PathEscape(name)))
	})
	if err == nil {
		s.announceMemberChange(ctx, chatID, target)
	}
	return err
}

// Unban lets someone be added again.
func (s *Service) Unban(ctx context.Context, chatID, actor, target uuid.UUID) error {
	return s.repo.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockGroupRow(ctx, tx, chatID); err != nil {
			return ErrNotFound
		}
		tag, err := tx.Exec(ctx, `DELETE FROM group_bans WHERE chat_id = $1 AND user_id = $2`, chatID, target)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_unbanned:%s:%s", actor, target))
	})
}

// Ban is a member, by id, that cannot be added back.
type Ban struct {
	UserID    uuid.UUID `json:"user_id"`
	Name      string    `json:"name"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"created_at"`
}

// Bans lists who is banned, for admins.
func (s *Service) Bans(ctx context.Context, chatID, caller uuid.UUID) ([]Ban, error) {
	if err := s.requireAdmin(ctx, chatID, caller); err != nil {
		return nil, err
	}
	rows, err := s.repo.db.Query(ctx, `
		SELECT b.user_id, COALESCE(NULLIF(u.display_name, ''), u.username, ''), b.reason, b.created_at
		FROM group_bans b JOIN users u ON u.id = b.user_id
		WHERE b.chat_id = $1 ORDER BY b.created_at DESC
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Ban{}
	for rows.Next() {
		var b Ban
		if err := rows.Scan(&b.UserID, &b.Name, &b.Reason, &b.CreatedAt); err != nil {
			return nil, err
		}
		b.CreatedAt = b.CreatedAt.UTC()
		out = append(out, b)
	}
	return out, rows.Err()
}

// anyBanned reports whether any of the ids is banned from the group.
func (r *Repository) anyBanned(ctx context.Context, chatID uuid.UUID, ids []uuid.UUID) (bool, error) {
	strs := make([]string, len(ids))
	for i, id := range ids {
		strs[i] = id.String()
	}
	var banned bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM group_bans WHERE chat_id = $1 AND user_id = ANY($2::uuid[]))`, chatID, strs).Scan(&banned)
	return banned, err
}

// mutedUntil is the end of a member's mute, if they are muted now.
func (r *Repository) mutedUntil(ctx context.Context, chatID, userID uuid.UUID) (*time.Time, error) {
	var until *time.Time
	err := r.db.QueryRow(ctx, `
		SELECT restricted_until FROM chat_participants
		WHERE chat_id = $1 AND user_id = $2 AND restricted_until > NOW()
	`, chatID, userID).Scan(&until)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return until, err
}

func (r *Repository) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
