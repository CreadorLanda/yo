package channels

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

type channelRow struct {
	ID                uuid.UUID
	OwnerID           uuid.UUID
	Name              string
	Handle            string
	Description       string
	Category          string
	AvatarURL         *string
	CoverURL          *string
	Visibility        string
	WhoCanPost        string
	CommentsEnabled   bool
	AllowAnonComments bool
	ReactionsEnabled  bool
	JoinMode          string
	Verified          bool
	CreatedAt         time.Time
	Members           int
	Following         bool
	Role              string
}

func (r *Repository) Create(
	ctx context.Context,
	owner uuid.UUID,
	name, handle, desc, category, avatar, cover string,
	vis Visibility, who PostPermission, join JoinMode,
	comments, anon, reacts bool,
) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO channels (
			owner_id, name, handle, description, category, avatar_url, cover_url,
			visibility, who_can_post, comments_enabled, allow_anon_comments,
			reactions_enabled, join_mode
		) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11,$12,$13)
		RETURNING id
	`, owner, name, handle, desc, category, avatar, cover,
		string(vis), string(who), comments, anon, reacts, string(join),
	).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO channel_members (channel_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, id, owner); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

func (r *Repository) List(ctx context.Context, viewer uuid.UUID, category string) ([]channelRow, error) {
	q := `
		SELECT c.id, c.owner_id, c.name, c.handle, c.description, c.category,
		       c.avatar_url, c.cover_url, c.visibility, c.who_can_post,
		       c.comments_enabled, c.allow_anon_comments, c.reactions_enabled,
		       c.join_mode, c.verified, c.created_at,
		       (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = c.id),
		       EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1),
		       COALESCE((SELECT m.role FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1), 'none')
		FROM channels c
		WHERE (c.visibility = 'public' OR EXISTS(
			SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1
		))
	`
	args := []any{viewer}
	if category != "" && category != "all" {
		q += ` AND c.category = $2`
		args = append(args, category)
	}
	q += ` ORDER BY c.created_at DESC LIMIT 100`

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChannels(rows)
}

func (r *Repository) Get(ctx context.Context, id, viewer uuid.UUID) (channelRow, error) {
	const q = `
		SELECT c.id, c.owner_id, c.name, c.handle, c.description, c.category,
		       c.avatar_url, c.cover_url, c.visibility, c.who_can_post,
		       c.comments_enabled, c.allow_anon_comments, c.reactions_enabled,
		       c.join_mode, c.verified, c.created_at,
		       (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = c.id),
		       EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $2),
		       COALESCE((SELECT m.role FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $2), 'none')
		FROM channels c WHERE c.id = $1
	`
	var c channelRow
	err := r.db.QueryRow(ctx, q, id, viewer).Scan(
		&c.ID, &c.OwnerID, &c.Name, &c.Handle, &c.Description, &c.Category,
		&c.AvatarURL, &c.CoverURL, &c.Visibility, &c.WhoCanPost,
		&c.CommentsEnabled, &c.AllowAnonComments, &c.ReactionsEnabled,
		&c.JoinMode, &c.Verified, &c.CreatedAt, &c.Members, &c.Following, &c.Role,
	)
	return c, err
}

// MemberIDs is everyone following the channel.
//
// Needed by anything that has to reach a channel's audience without importing
// this module's storage — announcing a live, for one.
func (r *Repository) MemberIDs(ctx context.Context, channelID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx,
		`SELECT user_id FROM channel_members WHERE channel_id = $1`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *Repository) HandleTaken(ctx context.Context, handle string, except *uuid.UUID) (bool, error) {
	var n int
	if except != nil {
		err := r.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM channels WHERE handle = $1 AND id <> $2
		`, handle, *except).Scan(&n)
		return n > 0, err
	}
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM channels WHERE handle = $1`, handle).Scan(&n)
	return n > 0, err
}

func (r *Repository) Follow(ctx context.Context, channelID, userID uuid.UUID, role MemberRole) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO channel_members (channel_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (channel_id, user_id) DO NOTHING
	`, channelID, userID, string(role))
	return err
}

func (r *Repository) Unfollow(ctx context.Context, channelID, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		DELETE FROM channel_members
		WHERE channel_id = $1 AND user_id = $2 AND role <> 'owner'
	`, channelID, userID)
	return err
}

func (r *Repository) Patch(
	ctx context.Context, id uuid.UUID,
	name, handle, desc, cat, avatar, cover *string,
	vis *Visibility, who *PostPermission, join *JoinMode,
	comments, anon, reacts *bool,
) error {
	_, err := r.db.Exec(ctx, `
		UPDATE channels SET
			name = COALESCE($2, name),
			handle = COALESCE($3, handle),
			description = COALESCE($4, description),
			category = COALESCE($5, category),
			avatar_url = COALESCE($6, avatar_url),
			cover_url = COALESCE($7, cover_url),
			visibility = COALESCE($8, visibility),
			who_can_post = COALESCE($9, who_can_post),
			join_mode = COALESCE($10, join_mode),
			comments_enabled = COALESCE($11, comments_enabled),
			allow_anon_comments = COALESCE($12, allow_anon_comments),
			reactions_enabled = COALESCE($13, reactions_enabled)
		WHERE id = $1
	`, id, name, handle, desc, cat, avatar, cover, vis, who, join, comments, anon, reacts)
	return err
}

func (r *Repository) InsertPost(
	ctx context.Context,
	channelID, author uuid.UUID,
	text string, ptype PostType, media string, payload json.RawMessage,
) (uuid.UUID, error) {
	var mediaPtr *string
	if media != "" {
		mediaPtr = &media
	}
	var id uuid.UUID
	err := r.db.QueryRow(ctx, `
		INSERT INTO channel_posts (channel_id, author_id, text, post_type, media_url, game_payload)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, channelID, author, text, string(ptype), mediaPtr, payloadOrNil(payload)).Scan(&id)
	return id, err
}

func (r *Repository) ListPosts(ctx context.Context, channelID, viewer uuid.UUID, limit int) ([]Post, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	rows, err := r.db.Query(ctx, `
		SELECT p.id, p.channel_id, p.author_id, p.text, p.post_type, p.media_url, p.views, p.created_at, p.game_payload,
		       COALESCE((SELECT r.emoji FROM channel_post_reactions r WHERE r.post_id = p.id AND r.user_id = $2), '')
		FROM channel_posts p
		WHERE p.channel_id = $1
		ORDER BY p.created_at DESC
		LIMIT $3
	`, channelID, viewer, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Post
	for rows.Next() {
		var p Post
		var media *string
		var ptype string
		var payload []byte
		if err := rows.Scan(&p.ID, &p.ChannelID, &p.AuthorID, &p.Text, &ptype, &media, &p.Views, &p.CreatedAt, &payload, &p.MyEmoji); err != nil {
			return nil, err
		}
		p.PostType = PostType(ptype)
		if media != nil {
			p.MediaURL = *media
		}
		p.GamePayload = payload
		reacts, _ := r.ListReactions(ctx, p.ID)
		p.Reactions = reacts
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPost(ctx context.Context, postID uuid.UUID) (Post, error) {
	var p Post
	var media *string
	var ptype string
	var payload []byte
	err := r.db.QueryRow(ctx, `
		SELECT id, channel_id, author_id, text, post_type, media_url, views, created_at, game_payload
		FROM channel_posts WHERE id = $1
	`, postID).Scan(&p.ID, &p.ChannelID, &p.AuthorID, &p.Text, &ptype, &media, &p.Views, &p.CreatedAt, &payload)
	if err != nil {
		return p, err
	}
	p.PostType = PostType(ptype)
	if media != nil {
		p.MediaURL = *media
	}
	p.GamePayload = payload
	return p, nil
}

func payloadOrNil(payload json.RawMessage) any {
	if len(payload) == 0 {
		return nil
	}
	return payload
}

func (r *Repository) IncViews(ctx context.Context, postID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE channel_posts SET views = views + 1 WHERE id = $1`, postID)
	return err
}

func (r *Repository) SetReaction(ctx context.Context, postID, userID uuid.UUID, emoji string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO channel_post_reactions (post_id, user_id, emoji)
		VALUES ($1,$2,$3)
		ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()
	`, postID, userID, emoji)
	return err
}

func (r *Repository) ClearReaction(ctx context.Context, postID, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		DELETE FROM channel_post_reactions WHERE post_id = $1 AND user_id = $2
	`, postID, userID)
	return err
}

func (r *Repository) ListReactions(ctx context.Context, postID uuid.UUID) ([]React, error) {
	rows, err := r.db.Query(ctx, `
		SELECT emoji, COUNT(*) FROM channel_post_reactions
		WHERE post_id = $1 GROUP BY emoji ORDER BY COUNT(*) DESC
	`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []React
	for rows.Next() {
		var x React
		if err := rows.Scan(&x.Emoji, &x.Count); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (r *Repository) AddComment(ctx context.Context, postID uuid.UUID, author *uuid.UUID, text string, anon bool) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.db.QueryRow(ctx, `
		INSERT INTO channel_comments (post_id, author_id, text, anonymous)
		VALUES ($1,$2,$3,$4) RETURNING id
	`, postID, author, text, anon).Scan(&id)
	return id, err
}

func (r *Repository) ListComments(ctx context.Context, postID uuid.UUID) ([]Comment, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.post_id, c.author_id, c.text, c.anonymous, c.created_at,
		       COALESCE(u.display_name, '')
		FROM channel_comments c
		LEFT JOIN users u ON u.id = c.author_id
		WHERE c.post_id = $1
		ORDER BY c.created_at ASC
		LIMIT 100
	`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		var name string
		if err := rows.Scan(&c.ID, &c.PostID, &c.AuthorID, &c.Text, &c.Anonymous, &c.CreatedAt, &name); err != nil {
			return nil, err
		}
		if !c.Anonymous {
			c.AuthorName = name
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func scanChannels(rows pgx.Rows) ([]channelRow, error) {
	var out []channelRow
	for rows.Next() {
		var c channelRow
		if err := rows.Scan(
			&c.ID, &c.OwnerID, &c.Name, &c.Handle, &c.Description, &c.Category,
			&c.AvatarURL, &c.CoverURL, &c.Visibility, &c.WhoCanPost,
			&c.CommentsEnabled, &c.AllowAnonComments, &c.ReactionsEnabled,
			&c.JoinMode, &c.Verified, &c.CreatedAt, &c.Members, &c.Following, &c.Role,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) UpdatePostText(ctx context.Context, postID uuid.UUID, text string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE channel_posts SET text = $2, edited_at = NOW() WHERE id = $1`,
		postID, text)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) DeletePost(ctx context.Context, postID uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM channel_posts WHERE id = $1`, postID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
