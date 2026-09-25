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

func (r *Repository) GetForUser(ctx context.Context, id, userID uuid.UUID) (objectRow, error) {
	const q = `
		SELECT m.id, m.owner_id, m.kind, m.mime_type, m.size_bytes, m.width, m.height,
		       m.duration_ms, m.original_name, m.storage_path, m.created_at
		FROM media_objects m
		WHERE m.id = $1
		  AND (
		    m.owner_id = $2
		    OR EXISTS (
		      SELECT 1 FROM media_grants g
		      WHERE g.media_id = m.id AND g.user_id = $2
		    )
		  )
	`
	var row objectRow
	err := r.db.QueryRow(ctx, q, id, userID).Scan(
		&row.ID, &row.OwnerID, &row.Kind, &row.MimeType, &row.SizeBytes,
		&row.Width, &row.Height, &row.DurationMs, &row.OriginalName,
		&row.StoragePath, &row.CreatedAt,
	)
	return row, err
}

// GrantToChat gives every current participant except the uploader access to
// an attachment. The owner check is server-side so a caller cannot turn a
// leaked UUID into access for another account.
func (r *Repository) GrantToChat(ctx context.Context, mediaID, chatID, ownerID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var actualOwner uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT owner_id FROM media_objects WHERE id = $1 FOR SHARE`, mediaID,
	).Scan(&actualOwner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMediaNotFound
		}
		return err
	}
	if actualOwner != ownerID {
		return ErrMediaNotOwner
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO media_grants (media_id, user_id)
		SELECT $1, cp.user_id
		FROM chat_participants cp
		WHERE cp.chat_id = $2 AND cp.user_id <> $3
		ON CONFLICT (media_id, user_id) DO NOTHING
	`, mediaID, chatID, ownerID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE media_objects m
		SET expected_recipients = (
			SELECT COUNT(*) FROM media_grants g
			WHERE g.media_id = m.id AND g.user_id <> m.owner_id
		)
		WHERE m.id = $1
	`, mediaID); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
