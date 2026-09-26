package media

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrMediaNotFound = errors.New("media_not_found")
var ErrMediaNotOwner = errors.New("media_not_owner")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Insert(
	ctx context.Context,
	ownerID uuid.UUID,
	kind Kind,
	mime string,
	size int64,
	path string,
	name string,
	width, height, durationMs *int,
) (objectRow, error) {
	const q = `
		INSERT INTO media_objects (
			owner_id, kind, mime_type, size_bytes, width, height, duration_ms,
			original_name, storage_path
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, owner_id, kind, mime_type, size_bytes, width, height,
		          duration_ms, original_name, storage_path, created_at
	`
	var namePtr *string
	if name != "" {
		namePtr = &name
	}
	var row objectRow
	err := r.db.QueryRow(ctx, q,
		ownerID, string(kind), mime, size, width, height, durationMs, namePtr, path,
	).Scan(
		&row.ID, &row.OwnerID, &row.Kind, &row.MimeType, &row.SizeBytes,
		&row.Width, &row.Height, &row.DurationMs, &row.OriginalName,
		&row.StoragePath, &row.CreatedAt,
	)
	return row, err
}

func (r *Repository) Get(ctx context.Context, id uuid.UUID) (objectRow, error) {
	const q = `
		SELECT id, owner_id, kind, mime_type, size_bytes, width, height,
		       duration_ms, original_name, storage_path, created_at
		FROM media_objects WHERE id = $1
	`
	var row objectRow
	err := r.db.QueryRow(ctx, q, id).Scan(
		&row.ID, &row.OwnerID, &row.Kind, &row.MimeType, &row.SizeBytes,
		&row.Width, &row.Height, &row.DurationMs, &row.OriginalName,
		&row.StoragePath, &row.CreatedAt,
	)
	return row, err
}

// CanRead checks every currently supported media audience. Chat grants point
// at messages rather than users so membership, history cutoffs, deletion and
// disappearing-message expiry are evaluated live on every request.
func (r *Repository) CanRead(ctx context.Context, id, userID uuid.UUID) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM media_objects m
			WHERE m.id = $1
			  AND m.purged_at IS NULL
			  AND (m.expires_at IS NULL OR m.expires_at > NOW())
			  AND (
			    m.owner_id = $2
			    OR EXISTS (
			      SELECT 1
			      FROM chat_media_access a
			      JOIN messages msg ON msg.id = a.message_id
			      JOIN chat_participants cp ON cp.chat_id = msg.chat_id AND cp.user_id = $2
			      WHERE a.media_id = m.id
			        AND msg.deleted_at IS NULL
			        AND (msg.expires_at IS NULL OR msg.expires_at > NOW())
			        AND (cp.history_from IS NULL OR msg.created_at >= cp.history_from)
			    )
			    OR EXISTS (
			      SELECT 1 FROM stories s
			      WHERE s.expires_at > NOW()
			        AND (
			          s.author_id = $2
			          OR s.visibility = 'public'
			          OR (
			            s.visibility = 'contacts'
			            AND EXISTS (
			              SELECT 1
			              FROM chats c
			              JOIN chat_participants author_cp
			                ON author_cp.chat_id = c.id AND author_cp.user_id = s.author_id
			              JOIN chat_participants viewer_cp
			                ON viewer_cp.chat_id = c.id AND viewer_cp.user_id = $2
			              WHERE c.type = 'direct'
			                AND c.status = 'active'
			                AND NOT EXISTS (
			                  SELECT 1 FROM blocks b
			                  WHERE (b.blocker_id = s.author_id AND b.blocked_id = $2)
			                     OR (b.blocker_id = $2 AND b.blocked_id = s.author_id)
			                )
			            )
			          )
			          -- There is no close-friends ACL yet. Fail closed instead of
			          -- treating a private audience as public.
			        )
			        AND split_part(regexp_replace(s.media_url, '^https?://[^/]+', ''), '?', 1)
			            IN ('/api/media/' || $1::text, '/api/media/' || $1::text || '/file')
			    )
			    OR EXISTS (
			      SELECT 1 FROM channels c
			      WHERE (c.visibility = 'public' OR EXISTS (
			        SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2
			      ))
			      AND (
			        split_part(regexp_replace(c.avatar_url, '^https?://[^/]+', ''), '?', 1)
			          IN ('/api/media/' || $1::text, '/api/media/' || $1::text || '/file')
			        OR split_part(regexp_replace(c.cover_url, '^https?://[^/]+', ''), '?', 1)
			          IN ('/api/media/' || $1::text, '/api/media/' || $1::text || '/file')
			        OR EXISTS (
			          SELECT 1 FROM channel_posts p
			          WHERE p.channel_id = c.id
			            AND split_part(regexp_replace(p.media_url, '^https?://[^/]+', ''), '?', 1)
			                IN ('/api/media/' || $1::text, '/api/media/' || $1::text || '/file')
			        )
			      )
			    )
			    OR EXISTS (
			      SELECT 1 FROM chats c
			      JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_id = $2
			      WHERE c.type = 'group'
			        AND split_part(regexp_replace(c.avatar_url, '^https?://[^/]+', ''), '?', 1)
			            IN ('/api/media/' || $1::text, '/api/media/' || $1::text || '/file')
			    )
			    OR EXISTS (
			      SELECT 1 FROM users u
			      WHERE split_part(regexp_replace(u.avatar_uri, '^https?://[^/]+', ''), '?', 1)
			              IN ('/api/media/' || $1::text, '/api/media/' || $1::text || '/file')
			        AND (
			          u.id = $2 OR u.photo_visibility = 'everyone'
			          OR (u.photo_visibility = 'contacts' AND EXISTS (
			            SELECT 1 FROM chats c
			            JOIN chat_participants own ON own.chat_id = c.id AND own.user_id = u.id
			            JOIN chat_participants viewer ON viewer.chat_id = c.id AND viewer.user_id = $2
			            WHERE c.type = 'direct' AND c.status = 'active'
			          ))
			        )
			    )
			    OR EXISTS (
			      SELECT 1 FROM sticker_packs p WHERE p.tray_media_id = m.id AND p.owner_id = $2
			    )
			  )
		)
	`
	var allowed bool
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&allowed)
	return allowed, err
}

func (r *Repository) Delete(ctx context.Context, id, ownerID uuid.UUID) (objectRow, error) {
	const q = `
		DELETE FROM media_objects
		WHERE id = $1 AND owner_id = $2
		RETURNING id, owner_id, kind, mime_type, size_bytes, width, height,
		          duration_ms, original_name, storage_path, created_at
	`
	var row objectRow
	err := r.db.QueryRow(ctx, q, id, ownerID).Scan(
		&row.ID, &row.OwnerID, &row.Kind, &row.MimeType, &row.SizeBytes,
		&row.Width, &row.Height, &row.DurationMs, &row.OriginalName,
		&row.StoragePath, &row.CreatedAt,
	)
	if err != nil {
		return row, err
	}
	return row, nil
}

func IsNoRows(err error) bool {
	return err != nil && err == pgx.ErrNoRows
}

// ── Retention ───────────────────────────────────────────────────────────────

// SetExpiry stamps the deadline and how many recipients must fetch the blob
// before it can be removed early.
func (r *Repository) SetExpiry(ctx context.Context, id uuid.UUID, expiresAt time.Time, recipients int) error {
	_, err := r.db.Exec(ctx, `
		UPDATE media_objects
		SET expires_at = $2, expected_recipients = $3
		WHERE id = $1
	`, id, expiresAt, recipients)
	return err
}

// MarkFetched records that a recipient downloaded the bytes. Re-fetching is
// idempotent so a retry does not skew the count.
func (r *Repository) MarkFetched(ctx context.Context, id, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO media_fetches (media_id, user_id) VALUES ($1, $2)
		ON CONFLICT (media_id, user_id) DO NOTHING
	`, id, userID)
	return err
}

// SetKeepForever exempts a blob from the sweep (server backup enabled).
func (r *Repository) SetKeepForever(ctx context.Context, id uuid.UUID, keep bool) error {
	_, err := r.db.Exec(ctx, `UPDATE media_objects SET keep_forever = $2 WHERE id = $1`, id, keep)
	return err
}

// purgeCandidate is a row whose bytes are due for deletion.
type purgeCandidate struct {
	ID          uuid.UUID
	StoragePath string
}

// DuePurge lists blobs that are past their deadline, or that every expected
// recipient has already fetched. Rows already purged and rows the uploader
// keeps are skipped.
func (r *Repository) DuePurge(ctx context.Context, limit int) ([]purgeCandidate, error) {
	const q = `
		SELECT m.id, m.storage_path
		FROM media_objects m
		WHERE m.purged_at IS NULL
		  AND NOT m.keep_forever
		  AND (
		        (m.expires_at IS NOT NULL AND m.expires_at <= NOW())
		     OR (
		          m.expected_recipients > 0
		          AND (SELECT COUNT(*) FROM media_fetches f
		               WHERE f.media_id = m.id AND f.user_id <> m.owner_id)
		              >= m.expected_recipients
		        )
		      )
		ORDER BY m.created_at
		LIMIT $1
	`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []purgeCandidate
	for rows.Next() {
		var c purgeCandidate
		if err := rows.Scan(&c.ID, &c.StoragePath); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// MarkPurged leaves the row as a tombstone so the message can still show
// "media expired" instead of a broken reference.
func (r *Repository) MarkPurged(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE media_objects SET purged_at = NOW() WHERE id = $1`, id)
	return err
}
