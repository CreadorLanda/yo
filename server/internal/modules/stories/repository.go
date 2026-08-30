package stories

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

type row struct {
	ID                    uuid.UUID
	AuthorID              uuid.UUID
	Kind                  string
	Caption               string
	MediaURL              *string
	Accent                string
	Visibility            string
	IsAnonymous           bool
	DurationSec           int
	ExpiresAt             time.Time
	CreatedAt             time.Time
	AuthorName            string
	AuthorUser            string
	AuthorAvatar          string
	Viewers               int
	IsViewed              bool
	AllowComments         bool
	AllowAnonymousReplies bool
}

func (r *Repository) Insert(
	ctx context.Context,
	author uuid.UUID,
	kind Kind,
	caption, mediaURL, accent string,
	vis Visibility,
	anon bool,
	durationSec int,
	expires time.Time,
	allowComments bool,
	allowAnonReplies bool,
) (uuid.UUID, error) {
	var media *string
	if mediaURL != "" {
		media = &mediaURL
	}
	var id uuid.UUID
	err := r.db.QueryRow(ctx, `
		INSERT INTO stories (
			author_id, kind, caption, media_url, accent, visibility,
			is_anonymous, duration_sec, expires_at,
			allow_comments, allow_anonymous_replies
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id
	`, author, string(kind), caption, media, accent, string(vis), anon, durationSec, expires,
		allowComments, allowAnonReplies).Scan(&id)
	return id, err
}

func (r *Repository) Get(ctx context.Context, id, viewer uuid.UUID) (row, error) {
	const q = `
		SELECT s.id, s.author_id, s.kind, s.caption, s.media_url, s.accent, s.visibility,
		       s.is_anonymous, s.duration_sec, s.expires_at, s.created_at,
		       s.allow_comments, s.allow_anonymous_replies,
		       COALESCE(u.display_name,''), COALESCE(u.username,''), COALESCE(u.avatar_uri,''),
		       (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id),
		       EXISTS(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = $2)
		FROM stories s
		JOIN users u ON u.id = s.author_id
		WHERE s.id = $1 AND s.expires_at > NOW()
	`
	var x row
	err := r.db.QueryRow(ctx, q, id, viewer).Scan(
		&x.ID, &x.AuthorID, &x.Kind, &x.Caption, &x.MediaURL, &x.Accent, &x.Visibility,
		&x.IsAnonymous, &x.DurationSec, &x.ExpiresAt, &x.CreatedAt,
		&x.AllowComments, &x.AllowAnonymousReplies,
		&x.AuthorName, &x.AuthorUser, &x.AuthorAvatar, &x.Viewers, &x.IsViewed,
	)
	return x, err
}

// Feed returns active stories visible to viewer (own + public + contacts heuristic:
// for v1 contacts/close ≈ all non-expired stories from others + own).
func (r *Repository) Feed(ctx context.Context, viewer uuid.UUID) ([]row, error) {
	const q = `
		SELECT s.id, s.author_id, s.kind, s.caption, s.media_url, s.accent, s.visibility,
		       s.is_anonymous, s.duration_sec, s.expires_at, s.created_at,
		       s.allow_comments, s.allow_anonymous_replies,
		       COALESCE(u.display_name,''), COALESCE(u.username,''), COALESCE(u.avatar_uri,''),
		       (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id),
		       EXISTS(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = $1)
		FROM stories s
		JOIN users u ON u.id = s.author_id
		WHERE s.expires_at > NOW()
		  AND (
		    s.author_id = $1
		    OR s.visibility = 'public'
		    OR s.visibility IN ('contacts', 'close')
		  )
		ORDER BY
		  CASE WHEN s.author_id = $1 THEN 0 ELSE 1 END,
		  s.created_at DESC
		LIMIT 100
	`
	rows, err := r.db.Query(ctx, q, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []row
	for rows.Next() {
		var x row
		if err := rows.Scan(
			&x.ID, &x.AuthorID, &x.Kind, &x.Caption, &x.MediaURL, &x.Accent, &x.Visibility,
			&x.IsAnonymous, &x.DurationSec, &x.ExpiresAt, &x.CreatedAt,
			&x.AllowComments, &x.AllowAnonymousReplies,
			&x.AuthorName, &x.AuthorUser, &x.AuthorAvatar, &x.Viewers, &x.IsViewed,
		); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (r *Repository) MarkViewed(ctx context.Context, storyID, viewer uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO story_views (story_id, viewer_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
	`, storyID, viewer)
	return err
}

func (r *Repository) Delete(ctx context.Context, id, author uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM stories WHERE id = $1 AND author_id = $2
	`, id, author)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetReactions makes emojis the caller's whole set on a story: anything not
// in the list goes, anything new arrives. An empty list clears them.
//
// Rows already there are left alone rather than deleted and reinserted, so
// created_at keeps meaning "when they first left this one" — that is the
// order the reaction is read back in.
func (r *Repository) SetReactions(ctx context.Context, storyID, userID uuid.UUID, emojis []string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM story_reactions
		WHERE story_id = $1 AND user_id = $2 AND emoji <> ALL($3::text[])
	`, storyID, userID, emojis); err != nil {
		return err
	}
	if len(emojis) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO story_reactions (story_id, user_id, emoji)
			SELECT $1, $2, e FROM unnest($3::text[]) AS e
			ON CONFLICT DO NOTHING
		`, storyID, userID, emojis); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// uuidStrings is what pgx can put in an array parameter.
//
// pgx has no encode plan for []uuid.UUID — a scalar uuid.UUID is fine, the
// slice is not — so the ids travel as text and the query casts them back to
// uuid[]. The cast is on the parameter, not the column, so the index still
// does the work.
func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out
}

// ReactionsFor counts the reactions on several stories at once, busiest
// emoji first.
//
// Takes a slice rather than one id so the feed costs one query instead of
// one per story: it returns a hundred of them.
func (r *Repository) ReactionsFor(ctx context.Context, storyIDs []uuid.UUID) (map[uuid.UUID][]Reaction, error) {
	out := map[uuid.UUID][]Reaction{}
	if len(storyIDs) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT story_id, emoji, COUNT(*)
		FROM story_reactions
		WHERE story_id = ANY($1::uuid[])
		GROUP BY story_id, emoji
		ORDER BY story_id, COUNT(*) DESC, emoji
	`, uuidStrings(storyIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var x Reaction
		if err := rows.Scan(&id, &x.Emoji, &x.Count); err != nil {
			return nil, err
		}
		out[id] = append(out[id], x)
	}
	return out, rows.Err()
}

// MyReactionsFor is what one person left on several stories, oldest pick
// first.
func (r *Repository) MyReactionsFor(
	ctx context.Context, storyIDs []uuid.UUID, userID uuid.UUID,
) (map[uuid.UUID][]string, error) {
	out := map[uuid.UUID][]string{}
	if len(storyIDs) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT story_id, emoji
		FROM story_reactions
		WHERE story_id = ANY($1::uuid[]) AND user_id = $2
		ORDER BY story_id, created_at, emoji
	`, uuidStrings(storyIDs), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var emoji string
		if err := rows.Scan(&id, &emoji); err != nil {
			return nil, err
		}
		out[id] = append(out[id], emoji)
	}
	return out, rows.Err()
}

// Viewers lists who opened a story, newest first, with the reaction each
// one left.
//
// Reactions are folded in here rather than fetched separately because the
// two are read together every time: a viewer list without reactions is a
// roll call, and the reactions are the part the author actually looks for.
func (r *Repository) Viewers(ctx context.Context, storyID uuid.UUID) ([]Viewer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT u.id, u.username, COALESCE(u.display_name, ''), COALESCE(u.avatar_uri, ''),
		       v.viewed_at, COALESCE(x.emojis, '{}'::text[])
		FROM story_views v
		JOIN users u ON u.id = v.viewer_id
		LEFT JOIN LATERAL (
		       SELECT array_agg(sr.emoji ORDER BY sr.created_at, sr.emoji) AS emojis
		       FROM story_reactions sr
		       WHERE sr.story_id = v.story_id AND sr.user_id = v.viewer_id
		) x ON TRUE
		WHERE v.story_id = $1
		ORDER BY v.viewed_at DESC
	`, storyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Viewer{}
	for rows.Next() {
		var v Viewer
		if err := rows.Scan(&v.UserID, &v.Username, &v.DisplayName, &v.AvatarURI,
			&v.ViewedAt, &v.Emojis); err != nil {
			return nil, err
		}
		// Older clients read a single emoji and know nothing of the list.
		if len(v.Emojis) > 0 {
			v.Emoji = v.Emojis[0]
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
