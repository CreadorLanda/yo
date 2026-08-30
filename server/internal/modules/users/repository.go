package users

import (
	"context"
	"errors"
	"fmt"
	"strings"

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

const userColumns = `id, username, display_name,
	COALESCE(bio, '') AS bio,
	COALESCE(avatar_uri, '') AS avatar_uri,
	username_public, created_at,
	last_seen_visibility, photo_visibility, read_receipts, ghost_mode`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	if err := row.Scan(
		&u.ID, &u.Username, &u.DisplayName,
		&u.Bio, &u.AvatarURI,
		&u.UsernamePublic, &u.CreatedAt,
		&u.LastSeenVisibility, &u.PhotoVisibility, &u.ReadReceipts, &u.GhostMode,
	); err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) ByID(ctx context.Context, id uuid.UUID) (*User, error) {
	return scanUser(r.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id))
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

// Search finds users whose username or display_name matches the query.
// Only returns users with username_public = true. Limited to 20 results.
func (r *Repository) Search(ctx context.Context, query string, callerID uuid.UUID) ([]User, error) {
	const q = `
		SELECT ` + userColumns + `
		FROM users
		WHERE (username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')
		  AND id <> $2
		  AND username_public = TRUE
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
