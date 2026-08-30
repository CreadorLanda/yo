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
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const userColumns = `id, username, display_name,
	COALESCE(bio, '') AS bio,
	COALESCE(avatar_uri, '') AS avatar_uri,
	username_public, created_at,
	last_seen_visibility, photo_visibility, read_receipts, ghost_mode,
	last_seen_frozen, is_premium, last_seen_at`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	if err := row.Scan(
		&u.ID, &u.Username, &u.DisplayName,
		&u.Bio, &u.AvatarURI,
		&u.UsernamePublic, &u.CreatedAt,
		&u.LastSeenVisibility, &u.PhotoVisibility, &u.ReadReceipts, &u.GhostMode,
		&u.LastSeenFrozen, &u.IsPremium, &u.LastSeenAt,
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
	if p.LastSeenFrozen != nil {
		add("last_seen_frozen", *p.LastSeenFrozen)
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

// TouchLastSeen records that a user was here, unless they have frozen it.
//
// The freeze is applied in the WHERE clause rather than by the caller, so
// there is no read path or write path that can forget it: a frozen row
// simply stops moving, which is what "frozen at a chosen moment" means.
func (r *Repository) TouchLastSeen(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE users SET last_seen_at = NOW() WHERE id = $1 AND NOT last_seen_frozen`, id)
	return err
}

// Presence is what one viewer may learn about one other person.
//
// `Online` and `LastSeenAt` are both nil when the viewer may not know — and
// `LastSeenAt` is nil on its own for an account nobody has ever seen, which
// is not the same thing and is why this is a struct rather than two loose
// values.
type Presence struct {
	Online     *bool      `json:"online,omitempty"`
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
}

// CanSeePresence answers whether viewer may see subject's presence at all.
//
// Three gates, and they are all the subject's or the viewer's own doing:
//
//   - Ghost mode hides the subject outright. It is the switch for leaving no
//     trace, and presence is a trace.
//   - Reciprocity: a viewer who has frozen their own last seen, or gone
//     ghost, stops seeing everyone else's. Premium buys the exception — that
//     is the only thing it buys, and it is checked here rather than trusted
//     from a client.
//   - `last_seen_visibility`, which has been a column since 0029 and until
//     now governed nothing.
//
// `contacts` is read as "someone I have a chat with", which is the closest
// thing this app has to a contact list.
func CanSeePresence(viewer, subject *User, share bool) bool {
	if viewer == nil || subject == nil {
		return false
	}
	if subject.GhostMode {
		return false
	}
	if (viewer.LastSeenFrozen || viewer.GhostMode) && !viewer.IsPremium {
		return false
	}
	switch subject.LastSeenVisibility {
	case VisNobody:
		return false
	case VisContacts:
		return share
	default:
		return true
	}
}
