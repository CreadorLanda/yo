package users

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// WithClock is intended for deterministic integration tests. Production calls
// use PostgreSQL's CURRENT_TIMESTAMP as the session time authority.
func (r *Repository) WithClock(now func() time.Time) *Repository {
	r.now = now
	return r
}

const userColumns = `id, username, display_name,
	COALESCE(bio, '') AS bio,
	COALESCE(avatar_uri, '') AS avatar_uri,
	username_public, created_at, email, (email_verified_at IS NOT NULL) AS email_verified,
	last_seen_visibility, photo_visibility, read_receipts,
	ghost_mode, ghost_mode_started_at, ghost_mode_expires_at,
	ghost_mode_last_activated_at`

func scanUser(row pgx.Row) (*User, error) {
	return scanUserAt(row, time.Now().UTC())
}

func scanUserAt(row pgx.Row, now time.Time) (*User, error) {
	var u User
	if err := row.Scan(
		&u.ID, &u.Username, &u.DisplayName,
		&u.Bio, &u.AvatarURI,
		&u.UsernamePublic, &u.CreatedAt,
		&u.Email, &u.EmailVerified,
		&u.LastSeenVisibility, &u.PhotoVisibility, &u.ReadReceipts,
		&u.GhostMode, &u.GhostModeStartedAt, &u.GhostModeExpiresAt,
		&u.GhostModeLastActivatedAt,
	); err != nil {
		return nil, err
	}
	u.applyGhostModeState(now)
	return &u, nil
}

func (r *Repository) ByID(ctx context.Context, id uuid.UUID) (*User, error) {
	return scanUser(r.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

func (r *Repository) ByIDAt(ctx context.Context, id uuid.UUID, now time.Time) (*User, error) {
	return scanUserAt(r.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id), now)
}

func (r *Repository) ByUsername(ctx context.Context, username string) (*User, error) {
	return scanUser(r.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE username = $1`, strings.ToLower(username)))
}

// IsUsernameTaken returns true if SOMEONE ELSE has that username. Passing
// the caller's own id excludes them so a no-op PATCH doesn't think the
// username is taken by itself.
func (r *Repository) IsUsernameTaken(ctx context.Context, username string, exceptUser uuid.UUID) (bool, error) {
	const q = `SELECT EXISTS (SELECT 1 FROM users WHERE username = $1 AND id <> $2)`
	var taken bool
	if err := r.db.QueryRow(ctx, q, strings.ToLower(username), exceptUser).Scan(&taken); err != nil {
		return false, err
	}
	return taken, nil
}

// Patch applies a partial update; only non-nil fields move. Returns the
// fresh user row after the update.
func (r *Repository) Patch(ctx context.Context, id uuid.UUID, p PatchRequest) (*User, error) {
	setters := []string{}
	args := []any{}
	add := func(col string, v any) {
		args = append(args, v)
		setters = append(setters, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if p.Username != nil {
		add("username", strings.ToLower(*p.Username))
	}
	if p.DisplayName != nil {
		add("display_name", *p.DisplayName)
	}
	if p.Bio != nil {
		add("bio", *p.Bio)
	}
	if p.AvatarURI != nil {
		add("avatar_uri", *p.AvatarURI)
	}
	if p.UsernamePublic != nil {
		add("username_public", *p.UsernamePublic)
	}
	if p.LastSeenVisibility != nil {
		add("last_seen_visibility", string(*p.LastSeenVisibility))
	}
	if p.PhotoVisibility != nil {
		add("photo_visibility", string(*p.PhotoVisibility))
	}
	if p.ReadReceipts != nil {
		add("read_receipts", *p.ReadReceipts)
	}
	if p.GhostMode != nil {
		add("ghost_mode", *p.GhostMode)
	}
	if len(setters) == 0 {
		return r.ByID(ctx, id)
	}
	setters = append(setters, "updated_at = NOW()")
	args = append(args, id)
	q := fmt.Sprintf(
		`UPDATE users SET %s WHERE id = $%d RETURNING %s`,
		strings.Join(setters, ", "), len(args), userColumns,
	)
	return scanUser(r.db.QueryRow(ctx, q, args...))
}

func (r *Repository) ActivateGhostMode(ctx context.Context, id uuid.UUID) (*User, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var active bool
	var expiresAt, lastActivatedAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT ghost_mode, ghost_mode_expires_at, ghost_mode_last_activated_at
		FROM users WHERE id = $1 FOR UPDATE
	`, id).Scan(&active, &expiresAt, &lastActivatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var databaseNow time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&databaseNow); err != nil {
		return nil, err
	}
	now := databaseNow.UTC()
	if r.now != nil {
		now = r.now().UTC()
	}
	if active && expiresAt != nil && now.Before(expiresAt.UTC()) {
		return nil, ErrGhostAlreadyActive
	}
	if lastActivatedAt != nil && sameUTCDate(lastActivatedAt.UTC(), now) {
		return nil, ErrGhostDailyLimit
	}

	startedAt := now
	expires := startedAt.Add(GhostModeDuration)
	expiresAt = &expires
	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET ghost_mode = TRUE,
		    ghost_mode_started_at = $2,
		    ghost_mode_expires_at = $3,
		    ghost_mode_last_activated_at = $2,
		    updated_at = NOW()
		WHERE id = $1
	`, id, startedAt, expiresAt); err != nil {
		return nil, err
	}
	u, err := scanUserAt(tx.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id), now)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return u, nil
}

func (r *Repository) DeactivateGhostMode(ctx context.Context, id uuid.UUID) (*User, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var lockedID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&lockedID); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return nil, err
	}
	now = now.UTC()
	if r.now != nil {
		now = r.now().UTC()
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET ghost_mode = FALSE,
		    ghost_mode_started_at = NULL,
		    ghost_mode_expires_at = NULL,
		    updated_at = NOW()
		WHERE id = $1
	`, id); err != nil {
		return nil, err
	}
	u, err := scanUserAt(tx.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id), now)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return u, nil
}

func sameUTCDate(a, b time.Time) bool {
	a, b = a.UTC(), b.UTC()
	return a.Year() == b.Year() && a.YearDay() == b.YearDay()
}

// Search finds users whose username or display_name matches the query.
// Only returns users with username_public = true. Limited to 20 results.
func (r *Repository) Search(ctx context.Context, query string, callerID uuid.UUID) ([]User, error) {
	const q = `
		SELECT ` + userColumns + `
		FROM users
		WHERE (username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')
		  AND id <> $2
		  AND username_public = TRUE
		  AND contacts_visible = TRUE
		ORDER BY
			CASE WHEN username ILIKE $1 || '%' THEN 0
			     WHEN display_name ILIKE $1 || '%' THEN 1
			     ELSE 2
			END,
			display_name ASC
		LIMIT 20
	`
	rows, err := r.db.Query(ctx, q, query, callerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

// IsNoRows mirrors the helper in auth — keeps the pgx import out of callers.
func IsNoRows(err error) bool { return err != nil && errors.Is(err, pgx.ErrNoRows) }

// Delete removes an account and everything that hangs off it.
//
// Immediate and irreversible, with no grace period: a "deleted" account that
// quietly still exists is a lie told to someone who asked to be gone. Every
// table that references users cascades, so this one statement takes the
// messages, keys, memberships, stories and devices with it.
func (r *Repository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SharedChatIDs narrows a set of user ids to those the viewer has a chat
// with — the closest thing this app has to a contact list.
//
// One query for the whole set, not one per result: a search returns twenty
// rows and this decides whether each may show a photo, which is exactly the
// shape that turns into twenty round trips if written the obvious way.
func (r *Repository) SharedChatIDs(
	ctx context.Context,
	viewerID uuid.UUID,
	candidates []uuid.UUID,
) (map[uuid.UUID]bool, error) {
	shared := make(map[uuid.UUID]bool, len(candidates))
	if len(candidates) == 0 {
		return shared, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT theirs.user_id
		FROM chat_participants mine
		JOIN chat_participants theirs ON theirs.chat_id = mine.chat_id
		WHERE mine.user_id = $1 AND theirs.user_id = ANY($2)
	`, viewerID, candidates)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		shared[id] = true
	}
	return shared, rows.Err()
}
