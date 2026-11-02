package groups

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(
	ctx context.Context,
	creator uuid.UUID,
	title, description, avatar string,
	memberIDs []uuid.UUID,
) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO chats (type, title, description, avatar_url, created_by, status)
		VALUES ('group', $1, NULLIF($2,''), NULLIF($3,''), $4, 'active')
		RETURNING id
	`, title, description, avatar, creator).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}

	// Creator as admin
	if _, err := tx.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id, role)
		VALUES ($1, $2, 'admin')
	`, id, creator); err != nil {
		return uuid.Nil, err
	}

	seen := map[uuid.UUID]struct{}{creator: {}}
	for _, mid := range memberIDs {
		if _, ok := seen[mid]; ok {
			continue
		}
		seen[mid] = struct{}{}
		if _, err := tx.Exec(ctx, `
			INSERT INTO chat_participants (chat_id, user_id, role)
			VALUES ($1, $2, 'member')
			ON CONFLICT DO NOTHING
		`, id, mid); err != nil {
			return uuid.Nil, err
		}
	}

	// System message: group created
	if _, err := tx.Exec(ctx, `
		INSERT INTO messages (chat_id, sender_id, content, message_type)
		VALUES ($1, $2, $3, 'system')
	`, id, creator, "group:created:"+creator.String()); err != nil {
		return uuid.Nil, err
	}

	return id, tx.Commit(ctx)
}

type groupRow struct {
	ID                 uuid.UUID
	Title              *string
	Description        *string
	AvatarURL          *string
	CreatedBy          uuid.UUID
	CreatedAt          time.Time
	HistoryEnabled     bool
	HistoryMode        string
	HistoryLimit       int
	TextPermission     string
	StickersPermission string
	AudioPermission    string
	MediaPermission    string
	PostingPermission  string
	PostingUntil       *time.Time
}

func (r *Repository) Get(ctx context.Context, id uuid.UUID) (groupRow, error) {
	const q = `
		SELECT id, title, description, avatar_url, created_by, created_at,
		       history_enabled, history_mode, history_limit,
		       text_permission, stickers_permission, audio_permission,
		       media_permission, posting_permission, posting_permission_until
		FROM chats
		WHERE id = $1 AND type = 'group'
	`
	var g groupRow
	err := r.db.QueryRow(ctx, q, id).Scan(
		&g.ID, &g.Title, &g.Description, &g.AvatarURL, &g.CreatedBy, &g.CreatedAt,
		&g.HistoryEnabled, &g.HistoryMode, &g.HistoryLimit,
		&g.TextPermission, &g.StickersPermission, &g.AudioPermission,
		&g.MediaPermission, &g.PostingPermission, &g.PostingUntil,
	)
	return g, err
}

func (r *Repository) ListForUser(ctx context.Context, userID uuid.UUID) ([]groupRow, error) {
	const q = `
		SELECT c.id, c.title, c.description, c.avatar_url, c.created_by, c.created_at,
		       c.history_enabled, c.history_mode, c.history_limit,
		       c.text_permission, c.stickers_permission, c.audio_permission,
		       c.media_permission, c.posting_permission, c.posting_permission_until
		FROM chats c
		JOIN chat_participants cp ON cp.chat_id = c.id
		WHERE c.type = 'group' AND cp.user_id = $1
		ORDER BY c.created_at DESC
	`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []groupRow
	for rows.Next() {
		var g groupRow
		if err := rows.Scan(
			&g.ID, &g.Title, &g.Description, &g.AvatarURL, &g.CreatedBy, &g.CreatedAt,
			&g.HistoryEnabled, &g.HistoryMode, &g.HistoryLimit,
			&g.TextPermission, &g.StickersPermission, &g.AudioPermission,
			&g.MediaPermission, &g.PostingPermission, &g.PostingUntil,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *Repository) ListMembers(ctx context.Context, chatID uuid.UUID) ([]Member, error) {
	const q = `
		SELECT cp.user_id, COALESCE(u.username,''), COALESCE(u.display_name,''),
		       COALESCE(u.avatar_uri,''), COALESCE(cp.role,'member'), cp.joined_at
		FROM chat_participants cp
		JOIN users u ON u.id = cp.user_id
		WHERE cp.chat_id = $1
		ORDER BY cp.role DESC, cp.joined_at ASC
	`
	rows, err := r.db.Query(ctx, q, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		var role string
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName, &m.AvatarURI, &role, &m.JoinedAt); err != nil {
			return nil, err
		}
		m.Role = MemberRole(role)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repository) MemberRole(ctx context.Context, chatID, userID uuid.UUID) (MemberRole, error) {
	var role string
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(role,'member') FROM chat_participants
		WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID).Scan(&role)
	if err != nil {
		return "", err
	}
	return MemberRole(role), nil
}

func (r *Repository) IsParticipant(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2)
	`, chatID, userID).Scan(&ok)
	return ok, err
}

func (r *Repository) Patch(
	ctx context.Context,
	id uuid.UUID,
	actor uuid.UUID,
	title, description, avatar *string,
	histEnabled *bool,
	histMode *HistoryMode,
	histLimit *int,
	permissions *GroupPermissions,
) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := lockGroupAdmin(ctx, tx, id, actor); err != nil {
		return err
	}
	// Single UPDATE with COALESCE for optional fields.
	if _, err := tx.Exec(ctx, `
		UPDATE chats SET
			title = COALESCE($2, title),
			description = COALESCE($3, description),
			avatar_url = COALESCE($4, avatar_url),
			history_enabled = COALESCE($5, history_enabled),
			history_mode = COALESCE($6, history_mode),
			history_limit = COALESCE($7, history_limit),
			text_permission = COALESCE($8, text_permission),
			stickers_permission = COALESCE($9, stickers_permission),
			audio_permission = COALESCE($10, audio_permission),
			media_permission = COALESCE($11, media_permission),
			posting_permission = COALESCE($12, posting_permission),
			posting_permission_until = CASE WHEN $13::boolean THEN $14 ELSE posting_permission_until END
		WHERE id = $1 AND type = 'group'
	`, id, title, description, avatar, histEnabled, histMode, histLimit,
		permissionValue(permissions, func(p GroupPermissions) PermissionLevel { return p.Text }),
		permissionValue(permissions, func(p GroupPermissions) PermissionLevel { return p.Stickers }),
		permissionValue(permissions, func(p GroupPermissions) PermissionLevel { return p.Audio }),
		permissionValue(permissions, func(p GroupPermissions) PermissionLevel { return p.Media }),
		permissionValue(permissions, func(p GroupPermissions) PermissionLevel { return p.Posting }),
		permissions != nil, permissionUntil(permissions)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func permissionValue(p *GroupPermissions, pick func(GroupPermissions) PermissionLevel) any {
	if p == nil {
		return nil
	}
	return pick(*p)
}

func permissionUntil(p *GroupPermissions) any {
	if p == nil {
		return nil
	}
	return p.PostingUntil
}

// AddMemberWithHistory adds someone and decides, once, how far back they can
// read.
//
// `shareHistory` false stamps history_from with now, so they see the group
// from their arrival onwards. The decision belongs to whoever is adding, at
// the moment of adding — a group-wide switch could be flipped later and
// retroactively expose a conversation to someone who joined under other terms.
// Returns whether someone actually joined. A caller who was already a member
// changes nothing, and the group should not announce it or rotate its keys.
func (r *Repository) AddMemberWithHistory(ctx context.Context, chatID, userID uuid.UUID, role MemberRole, shareHistory bool) (bool, error) {
	var from any
	if !shareHistory {
		from = time.Now()
	}
	tag, err := r.db.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id, role, history_from)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (chat_id, user_id) DO NOTHING
	`, chatID, userID, role, from)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *Repository) AddMember(ctx context.Context, chatID, userID uuid.UUID, role MemberRole) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (chat_id, user_id) DO NOTHING
	`, chatID, userID, string(role))
	return err
}

func (r *Repository) RemoveMember(ctx context.Context, chatID, userID uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) SetRole(ctx context.Context, chatID, userID uuid.UUID, role MemberRole) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE chat_participants SET role = $3
		WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID, string(role))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) AdminCount(ctx context.Context, chatID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM chat_participants
		WHERE chat_id = $1 AND role = 'admin'
	`, chatID).Scan(&n)
	return n, err
}

func (r *Repository) InsertSystem(ctx context.Context, chatID, actor uuid.UUID, text string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO messages (chat_id, sender_id, content, message_type)
		VALUES ($1, $2, $3, 'system')
	`, chatID, actor, text)
	return err
}
