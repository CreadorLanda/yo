package posts

import (
	"context"
	"fmt"
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

// visibleTo is who may see post `p`, with the viewer in $2.
//
// A contact is the other side of an active direct chat, the same rule stories
// use: group membership and a pending request are not a relationship. A block
// in either direction hides everything, public included; the media module's
// CanRead repeats this rule for the bytes and the two must agree.
const visibleTo = `(
	p.author_id = $2
	OR (
		NOT EXISTS (
			SELECT 1 FROM blocks b
			WHERE (b.blocker_id = $2 AND b.blocked_id = p.author_id)
			   OR (b.blocker_id = p.author_id AND b.blocked_id = $2)
		)
		AND (
			p.visibility = 'public'
			OR (
				p.visibility = 'contacts'
				AND EXISTS (
					SELECT 1
					FROM chat_participants mine
					JOIN chat_participants theirs ON theirs.chat_id = mine.chat_id
					JOIN chats c ON c.id = mine.chat_id AND c.type = 'direct'
					WHERE c.status = 'active'
					  AND mine.user_id = $2
					  AND theirs.user_id = p.author_id
				)
			)
		)
	)
)`

const postColumns = `
	p.id, p.author_id, p.kind, p.caption, p.visibility, p.created_at,
	COALESCE(u.display_name,''), COALESCE(u.username,''), COALESCE(u.avatar_uri,'')`

type row struct {
	ID           uuid.UUID
	AuthorID     uuid.UUID
	Kind         string
	Caption      string
	Visibility   string
	CreatedAt    time.Time
	AuthorName   string
	AuthorUser   string
	AuthorAvatar string
}

func scanRow(s pgx.Row) (row, error) {
	var x row
	err := s.Scan(&x.ID, &x.AuthorID, &x.Kind, &x.Caption, &x.Visibility, &x.CreatedAt,
		&x.AuthorName, &x.AuthorUser, &x.AuthorAvatar)
	return x, err
}

// OwnedMedia returns the kind of each id that this user owns and may publish.
//
// Ids missing from the map are not theirs or are already gone.
func (r *Repository) OwnedMedia(ctx context.Context, owner uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, kind FROM media_objects
		WHERE id = ANY($1::uuid[]) AND owner_id = $2
		  AND purged_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
	`, uuidStrings(ids), owner)
	if err != nil {
		return nil, fmt.Errorf("owned media: %w", err)
	}
	defer rows.Close()
	out := make(map[uuid.UUID]string, len(ids))
	for rows.Next() {
		var id uuid.UUID
		var kind string
		if err := rows.Scan(&id, &kind); err != nil {
			return nil, fmt.Errorf("owned media: %w", err)
		}
		out[id] = kind
	}
	return out, rows.Err()
}

// Insert writes the post and its slides together, so a post never exists
// without the media it was published with.
func (r *Repository) Insert(
	ctx context.Context,
	author uuid.UUID,
	kind Kind,
	caption string,
	vis Visibility,
	mediaIDs []uuid.UUID,
) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert post: %w", err)
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO posts (author_id, kind, caption, visibility)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, author, string(kind), caption, string(vis)).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("insert post: %w", err)
	}
	for i, mediaID := range mediaIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO post_media (post_id, position, media_id) VALUES ($1, $2, $3)
		`, id, i, mediaID); err != nil {
			return uuid.Nil, fmt.Errorf("insert post media: %w", err)
		}
	}
	// Every upload starts on the relay's deadline: the server holds media
	// until it is delivered, then sweeps it. A post is the opposite, so its
	// media is taken off that deadline here, in the same transaction, or the
	// post would quietly lose its pictures a month later.
	//
	// This writes to a table the media module owns. It is done here rather
	// than through that module so that a post and the pin on its media
	// cannot exist one without the other.
	if _, err := tx.Exec(ctx, `
		UPDATE media_objects
		SET keep_forever = TRUE, expires_at = NULL, expected_recipients = 0
		WHERE id = ANY($1::uuid[]) AND owner_id = $2
	`, uuidStrings(mediaIDs), author); err != nil {
		return uuid.Nil, fmt.Errorf("pin post media: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, fmt.Errorf("insert post: %w", err)
	}
	return id, nil
}

// Get returns a post the viewer may see. One they may not is pgx.ErrNoRows,
// the same as one that does not exist.
func (r *Repository) Get(ctx context.Context, id, viewer uuid.UUID) (row, error) {
	return scanRow(r.db.QueryRow(ctx, `
		SELECT `+postColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.id = $1 AND `+visibleTo, id, viewer))
}

// ListByAuthor is one page of an author's grid as the viewer sees it, newest
// first.
func (r *Repository) ListByAuthor(ctx context.Context, viewer uuid.UUID, q ListQuery) ([]row, error) {
	var before *time.Time
	if !q.Before.IsZero() {
		before = &q.Before
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+postColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.author_id = $1 AND `+visibleTo+`
		  AND ($3::text = '' OR p.kind = $3::text)
		  AND ($4::timestamptz IS NULL OR p.created_at < $4)
		ORDER BY p.created_at DESC, p.id DESC
		LIMIT $5
	`, q.Author, viewer, string(q.Kind), before, q.Limit)
	if err != nil {
		return nil, fmt.Errorf("list posts: %w", err)
	}
	defer rows.Close()
	var out []row
	for rows.Next() {
		x, err := scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("list posts: %w", err)
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// MediaFor loads the slides of several posts at once, in slide order.
//
// One query for the page rather than one per post. Purged blobs are left
// out: a slide that would only 404 is not a slide.
func (r *Repository) MediaFor(ctx context.Context, postIDs []uuid.UUID) (map[uuid.UUID][]Media, error) {
	out := map[uuid.UUID][]Media{}
	if len(postIDs) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT pm.post_id, m.id, m.kind, m.width, m.height, m.duration_ms
		FROM post_media pm
		JOIN media_objects m ON m.id = pm.media_id
		WHERE pm.post_id = ANY($1::uuid[]) AND m.purged_at IS NULL
		ORDER BY pm.post_id, pm.position
	`, uuidStrings(postIDs))
	if err != nil {
		return nil, fmt.Errorf("post media: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var postID uuid.UUID
		var m Media
		if err := rows.Scan(&postID, &m.ID, &m.Kind, &m.Width, &m.Height, &m.DurationMs); err != nil {
			return nil, fmt.Errorf("post media: %w", err)
		}
		m.URL = "/api/media/" + m.ID.String() + "/file"
		out[postID] = append(out[postID], m)
	}
	return out, rows.Err()
}

// Delete removes the author's own post. Anything else is pgx.ErrNoRows.
//
// Media that no other post still shows goes back on a deadline that has
// already passed, so the sweeper removes the bytes on its next run instead
// of keeping them for a post that no longer exists.
func (r *Repository) Delete(ctx context.Context, id, author uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT pm.media_id FROM post_media pm
		JOIN posts p ON p.id = pm.post_id
		WHERE p.id = $1 AND p.author_id = $2
	`, id, author)
	if err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	var mediaIDs []uuid.UUID
	for rows.Next() {
		var mediaID uuid.UUID
		if err := rows.Scan(&mediaID); err != nil {
			rows.Close()
			return fmt.Errorf("delete post: %w", err)
		}
		mediaIDs = append(mediaIDs, mediaID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("delete post: %w", err)
	}

	tag, err := tx.Exec(ctx, `DELETE FROM posts WHERE id = $1 AND author_id = $2`, id, author)
	if err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if _, err := tx.Exec(ctx, `
		UPDATE media_objects m
		SET keep_forever = FALSE, expires_at = NOW()
		WHERE m.id = ANY($1::uuid[]) AND m.owner_id = $2
		  AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)
	`, uuidStrings(mediaIDs), author); err != nil {
		return fmt.Errorf("release post media: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	return nil
}

// uuidStrings is what pgx can put in an array parameter: it has no encode
// plan for []uuid.UUID, so the ids travel as text and the query casts them.
func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out
}
