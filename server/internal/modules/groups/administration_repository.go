package groups

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ApplyMemberChanges is the single transaction for removals, self-leave and
// bulk role changes. All participant rows are locked before the decision is
// made, so two simultaneous leaves cannot both observe the same last admin.
func (r *Repository) ApplyMemberChanges(ctx context.Context, chatID, actor uuid.UUID, targetIDs []uuid.UUID, action string, role MemberRole) (uuid.UUID, error) {
	targets := uniqueUUIDs(targetIDs)
	if len(targets) == 0 {
		return uuid.Nil, pgx.ErrNoRows
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i].String() < targets[j].String() })
	targetStrings := make([]string, len(targets))
	for i, id := range targets {
		targetStrings[i] = id.String()
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT user_id, role
		FROM chat_participants
		WHERE chat_id = $1
		ORDER BY user_id
		FOR UPDATE
	`, chatID)
	if err != nil {
		return uuid.Nil, err
	}
	roles := make(map[uuid.UUID]MemberRole)
	for rows.Next() {
		var id uuid.UUID
		var raw string
		if err := rows.Scan(&id, &raw); err != nil {
			rows.Close()
			return uuid.Nil, err
		}
		roles[id] = MemberRole(raw)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return uuid.Nil, err
	}
	rows.Close()

	for _, id := range targets {
		if _, ok := roles[id]; !ok {
			return uuid.Nil, pgx.ErrNoRows
		}
	}

	if action == "role" {
		if role != RoleAdmin && role != RoleModerator && role != RoleMember {
			return uuid.Nil, ErrInvalidRole
		}
		admins := 0
		for id, current := range roles {
			if current == RoleAdmin {
				admins++
			}
			if current == RoleAdmin && containsUUID(targets, id) && role != RoleAdmin {
				admins--
			}
		}
		if admins == 0 {
			return uuid.Nil, ErrLastAdmin
		}
		for _, id := range targets {
			if _, err := tx.Exec(ctx, `UPDATE chat_participants SET role = $3 WHERE chat_id = $1 AND user_id = $2`, chatID, id, role); err != nil {
				return uuid.Nil, err
			}
			if err := insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:role_changed:%s:%s:%s", actor, id, role)); err != nil {
				return uuid.Nil, err
			}
		}
		return uuid.Nil, tx.Commit(ctx)
	}

	adminsAfter := 0
	for id, current := range roles {
		if current == RoleAdmin && !containsUUID(targets, id) {
			adminsAfter++
		}
	}
	var handoff uuid.UUID
	if adminsAfter == 0 {
		var candidate uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT cp.user_id
			FROM chat_participants cp
			LEFT JOIN messages m ON m.chat_id = cp.chat_id AND m.sender_id = cp.user_id AND m.deleted_at IS NULL
			WHERE cp.chat_id = $1 AND NOT (cp.user_id = ANY($2::uuid[]))
			GROUP BY cp.user_id, cp.joined_at
			ORDER BY COUNT(m.id) DESC, MAX(m.created_at) DESC NULLS LAST, cp.joined_at ASC, cp.user_id ASC
			LIMIT 1
		`, chatID, targetStrings).Scan(&candidate)
		if err != nil {
			if err == pgx.ErrNoRows {
				return uuid.Nil, ErrNoEligibleAdmin
			}
			return uuid.Nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE chat_participants SET role = 'admin' WHERE chat_id = $1 AND user_id = $2`, chatID, candidate); err != nil {
			return uuid.Nil, err
		}
		handoff = candidate
	}

	if _, err := tx.Exec(ctx, `DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = ANY($2::uuid[])`, chatID, targetStrings); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE chats SET key_epoch = key_epoch + 1 WHERE id = $1`, chatID); err != nil {
		return uuid.Nil, err
	}
	for _, id := range targets {
		if err := insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:member_removed:%s:%s", actor, id)); err != nil {
			return uuid.Nil, err
		}
	}
	if handoff != uuid.Nil {
		if err := insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:admin_handoff:%s:%s", actor, handoff)); err != nil {
			return uuid.Nil, err
		}
	}
	return handoff, tx.Commit(ctx)
}

// AddMembersWithHistoryAndRotate makes membership, key invalidation and the
// timeline notice one commit. A failed notice must not leave a new member in
// the group with the old sender-key epoch.
func (r *Repository) AddMembersWithHistoryAndRotate(ctx context.Context, chatID, actor uuid.UUID, userIDs []uuid.UUID, shareHistory bool) ([]uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var from any
	if !shareHistory {
		from = time.Now()
	}
	added := make([]uuid.UUID, 0, len(userIDs))
	for _, userID := range uniqueUUIDs(userIDs) {
		var joined uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO chat_participants (chat_id, user_id, role, history_from)
			VALUES ($1, $2, 'member', $3)
			ON CONFLICT (chat_id, user_id) DO NOTHING
			RETURNING user_id
		`, chatID, userID, from).Scan(&joined)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		added = append(added, joined)
	}
	if len(added) == 0 {
		return nil, tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `UPDATE chats SET key_epoch = key_epoch + 1 WHERE id = $1`, chatID); err != nil {
		return nil, err
	}
	ids := make([]string, len(added))
	for i, id := range added {
		ids[i] = id.String()
	}
	if err := insertSystemTx(ctx, tx, chatID, actor, "group:members_added:"+actor.String()+":"+strings.Join(ids, ",")); err != nil {
		return nil, err
	}
	return added, tx.Commit(ctx)
}

func insertSystemTx(ctx context.Context, tx pgx.Tx, chatID, actor uuid.UUID, content string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO messages (chat_id, sender_id, content, message_type)
		VALUES ($1, $2, $3, 'system')
	`, chatID, actor, content)
	return err
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ids))
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func containsUUID(ids []uuid.UUID, wanted uuid.UUID) bool {
	for _, id := range ids {
		if id == wanted {
			return true
		}
	}
	return false
}

func (r *Repository) CreateAchievement(ctx context.Context, chatID, actor uuid.UUID, icon, name string, criteria []byte) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO group_achievements (chat_id, created_by, icon, name, criteria)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		RETURNING id
	`, chatID, actor, icon, name, string(criteria)).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	if err := insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:achievement_created:%s:%s", actor, id)); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

func (r *Repository) ListAchievements(ctx context.Context, chatID uuid.UUID) ([]Achievement, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, chat_id, created_by, icon, name, criteria, created_at
		FROM group_achievements WHERE chat_id = $1 ORDER BY created_at ASC, id ASC
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Achievement, 0)
	for rows.Next() {
		var a Achievement
		if err := rows.Scan(&a.ID, &a.GroupID, &a.CreatedBy, &a.Icon, &a.Name, &a.Criteria, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Awards, err = r.listAchievementAwards(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *Repository) listAchievementAwards(ctx context.Context, achievementID uuid.UUID) ([]AchievementAward, error) {
	rows, err := r.db.Query(ctx, `
		SELECT achievement_id, user_id, awarded_by, evidence_message_id, awarded_at
		FROM group_achievement_awards WHERE achievement_id = $1 ORDER BY awarded_at ASC, user_id ASC
	`, achievementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AchievementAward, 0)
	for rows.Next() {
		var a AchievementAward
		if err := rows.Scan(&a.AchievementID, &a.UserID, &a.AwardedBy, &a.EvidenceMessageID, &a.AwardedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) AwardAchievement(ctx context.Context, chatID, actor, achievementID, userID uuid.UUID, evidenceID int64) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM group_achievements WHERE id = $1 AND chat_id = $2)`, achievementID, chatID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return pgx.ErrNoRows
	}
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2)`, chatID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotMember
	}
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL AND message_type <> 'system')`, evidenceID, chatID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrInvalidAchievementEvidence
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO group_achievement_awards (achievement_id, user_id, awarded_by, evidence_message_id)
		VALUES ($1, $2, $3, $4)
	`, achievementID, userID, actor, evidenceID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrAchievementAlreadyAwarded
		}
		return err
	}
	if err := insertSystemTx(ctx, tx, chatID, actor, fmt.Sprintf("group:achievement_awarded:%s:%s:%s:%d", actor, achievementID, userID, evidenceID)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
