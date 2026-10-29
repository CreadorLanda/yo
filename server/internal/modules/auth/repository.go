package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrCredentialConflict   = errors.New("credential_unavailable")
	ErrVerificationInvalid  = errors.New("verification_invalid")
	ErrVerificationExpired  = errors.New("verification_expired")
	ErrVerificationAttempts = errors.New("verification_attempts_exceeded")
)

// SessionRow is the slice of the sessions table the auth service needs.
// Revoked rows are still returned so the service can spot a replay.
type SessionRow struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	DeviceID  uuid.UUID
	FamilyID  uuid.UUID
	ExpiresAt time.Time
	Revoked   bool
}

// Repository owns SQL access for this module. Queries live next to each
// other so a reviewer can see "all auth SQL" in one file.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// UserByPhoneHash returns the user by hashed phone, or pgx.ErrNoRows.
func (r *Repository) UserByPhoneHash(ctx context.Context, hash []byte) (*User, error) {
	const q = `
		SELECT id, username, display_name, created_at, email, email_verified_at, pending_email
		FROM users
		WHERE phone_hash = $1
	`
	row := r.db.QueryRow(ctx, q, hash)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt, &u.Email, &u.EmailVerifiedAt, &u.PendingEmail); err != nil {
		return nil, err
	}
	return &u, nil
}

// CreateUser inserts a fresh user, returning the populated row.
func (r *Repository) CreateUser(ctx context.Context, phoneHash []byte, username, displayName, email string) (*User, error) {
	id := uuid.New()
	const q = `
		INSERT INTO users (id, phone_hash, username, display_name, email)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''))
		RETURNING id, username, display_name, created_at, email, email_verified_at, pending_email
	`
	row := r.db.QueryRow(ctx, q, id, phoneHash, username, displayName, email)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt, &u.Email, &u.EmailVerifiedAt, &u.PendingEmail); err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) UserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	row := r.db.QueryRow(ctx, `
		SELECT id, username, display_name, created_at, email, email_verified_at, pending_email
		FROM users WHERE id = $1
	`, id)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt, &u.Email, &u.EmailVerifiedAt, &u.PendingEmail); err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) PhoneHashByUser(ctx context.Context, id uuid.UUID) ([]byte, error) {
	var hash []byte
	err := r.db.QueryRow(ctx, `SELECT phone_hash FROM users WHERE id = $1`, id).Scan(&hash)
	return hash, err
}

func (r *Repository) ClearEmail(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE users SET email = NULL, pending_email = NULL, email_verified_at = NULL, updated_at = NOW() WHERE id = $1`, id)
	return err
}

func (r *Repository) SetEmailChallenge(ctx context.Context, userID uuid.UUID, email string, codeHash []byte, expiresAt time.Time) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var owned bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2)`, email, userID).Scan(&owned); err != nil {
		return err
	}
	if owned {
		return ErrCredentialConflict
	}
	var currentEmail *string
	var verifiedAt *time.Time
	if err := tx.QueryRow(ctx, `SELECT email, email_verified_at FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&currentEmail, &verifiedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCredentialConflict
		}
		return err
	}
	if currentEmail == nil || verifiedAt == nil {
		if _, err := tx.Exec(ctx, `UPDATE users SET email = $2, email_verified_at = NULL, pending_email = NULL, updated_at = NOW() WHERE id = $1`, userID, email); err != nil {
			return err
		}
	} else if !strings.EqualFold(*currentEmail, email) {
		if _, err := tx.Exec(ctx, `UPDATE users SET pending_email = $2, updated_at = NOW() WHERE id = $1`, userID, email); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE email_verifications SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO email_verifications (user_id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)`, userID, email, codeHash, expiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) VerifyEmail(ctx context.Context, userID uuid.UUID, codeHash []byte, now time.Time) (*User, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	var email string
	var stored []byte
	var expiresAt time.Time
	var attempts int
	err = tx.QueryRow(ctx, `
		SELECT id, email, code_hash, expires_at, attempts
		FROM email_verifications
		WHERE user_id = $1 AND consumed_at IS NULL
		ORDER BY created_at DESC LIMIT 1 FOR UPDATE
	`, userID).Scan(&id, &email, &stored, &expiresAt, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVerificationExpired
	}
	if err != nil {
		return nil, err
	}
	if !now.Before(expiresAt) {
		return nil, ErrVerificationExpired
	}
	if attempts >= 5 {
		return nil, ErrVerificationAttempts
	}
	if len(stored) != len(codeHash) || subtle.ConstantTimeCompare(stored, codeHash) != 1 {
		if _, err := tx.Exec(ctx, `UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1`, id); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, ErrVerificationInvalid
	}
	var u User
	if err := tx.QueryRow(ctx, `
		UPDATE users SET email = $2, pending_email = NULL, email_verified_at = $3, updated_at = NOW()
		WHERE id = $1
		RETURNING id, username, display_name, created_at, email, email_verified_at, pending_email
	`, userID, email, now).Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt, &u.Email, &u.EmailVerifiedAt, &u.PendingEmail); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrCredentialConflict
		}
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE email_verifications SET consumed_at = NOW() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) CreatePhoneChange(ctx context.Context, userID uuid.UUID, destinationHash, codeHash []byte, expiresAt time.Time) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE phone_change_challenges
		SET consumed_at = NOW()
		WHERE user_id = $1 AND consumed_at IS NULL
	`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO phone_change_challenges (user_id, destination_phone_hash, destination_code_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, userID, destinationHash, codeHash, expiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) CompletePhoneChange(ctx context.Context, userID uuid.UUID, codeHash []byte, now time.Time) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	var destinationHash, stored []byte
	var expiresAt time.Time
	var attempts int
	err = tx.QueryRow(ctx, `
		SELECT id, destination_phone_hash, destination_code_hash, expires_at, attempts
		FROM phone_change_challenges
		WHERE user_id = $1 AND consumed_at IS NULL
		ORDER BY created_at DESC LIMIT 1 FOR UPDATE
	`, userID).Scan(&id, &destinationHash, &stored, &expiresAt, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrVerificationExpired
	}
	if err != nil {
		return err
	}
	if !now.Before(expiresAt) {
		return ErrVerificationExpired
	}
	if attempts >= 5 {
		return ErrVerificationAttempts
	}
	if len(stored) != len(codeHash) || subtle.ConstantTimeCompare(stored, codeHash) != 1 {
		if _, err := tx.Exec(ctx, `UPDATE phone_change_challenges SET attempts = attempts + 1 WHERE id = $1`, id); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return ErrVerificationInvalid
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET phone_hash = $2, updated_at = NOW() WHERE id = $1`, userID, destinationHash); err != nil {
		if isUniqueViolation(err) {
			return ErrCredentialConflict
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE phone_change_challenges SET consumed_at = NOW() WHERE id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// CreateSession persists a (hashed) session and starts a new refresh-token
// family. Returns (sessionID, familyID) so callers can record both.
//
// Tokens are hashed before storage — the bearer keeps the originals.
func (r *Repository) CreateSession(ctx context.Context, userID, deviceID uuid.UUID, tokenHash, refreshHash []byte) (uuid.UUID, uuid.UUID, error) {
	id := uuid.New()
	family := uuid.New()
	const q = `
		INSERT INTO sessions (id, user_id, device_id, token_hash, refresh_hash, expires_at, family_id)
		VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days', $6)
	`
	_, err := r.db.Exec(ctx, q, id, userID, deviceID, tokenHash, refreshHash, family)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return id, family, nil
}

// SessionByRefreshHash looks up a session by the hashed refresh token,
// *including* revoked rows. The service uses the Revoked flag to spot a
// replay (the only legitimate caller has the live token, not a revoked
// one — anyone presenting a revoked token has stolen it).
func (r *Repository) SessionByRefreshHash(ctx context.Context, refreshHash []byte) (*SessionRow, error) {
	const q = `
		SELECT id, user_id, device_id, family_id, expires_at, revoked_at IS NOT NULL
		FROM sessions
		WHERE refresh_hash = $1
	`
	row := r.db.QueryRow(ctx, q, refreshHash)
	var s SessionRow
	if err := row.Scan(&s.ID, &s.UserID, &s.DeviceID, &s.FamilyID, &s.ExpiresAt, &s.Revoked); err != nil {
		return nil, err
	}
	return &s, nil
}

// RotateSession atomically marks the parent session revoked and inserts a
// new session row with fresh hashes in the same family. Returns the new
// session id. If the parent is already revoked or gone, no rows are
// affected and ErrAlreadyRevoked is returned — the service translates
// that to a "replay detected" path.
func (r *Repository) RotateSession(
	ctx context.Context,
	parent SessionRow,
	tokenHash, refreshHash []byte,
) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	ct, err := tx.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = NOW()
		WHERE id = $1 AND revoked_at IS NULL
	`, parent.ID)
	if err != nil {
		return uuid.Nil, err
	}
	if ct.RowsAffected() == 0 {
		return uuid.Nil, ErrAlreadyRevoked
	}

	newID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO sessions
		    (id, user_id, device_id, token_hash, refresh_hash, expires_at, family_id, parent_id)
		VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days', $6, $7)
	`, newID, parent.UserID, parent.DeviceID, tokenHash, refreshHash, parent.FamilyID, parent.ID); err != nil {
		return uuid.Nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return newID, nil
}

// RevokeFamily marks every live session in a family revoked. Idempotent —
// already-revoked rows are left alone. Used both on logout (single device)
// and on replay detection (all devices in that family).
func (r *Repository) RevokeFamily(ctx context.Context, familyID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = NOW()
		WHERE family_id = $1 AND revoked_at IS NULL
	`, familyID)
	return err
}

// RegisterDevice returns the id of the caller's device, reusing the row for a
// device that has signed in before.
//
// The comment here used to claim it inserted or updated; it only ever
// inserted, with a fresh uuid every time. Combined with a client that sent
// the constant "mobile" as its name, one handset ended up with 23 rows —
// each publishing its own pre-key bundle, of which only the most recently
// seen is ever handed out.
//
// deviceKey empty means an older client that cannot identify itself. Those
// still get a new row, because the alternative — guessing which existing row
// belongs to them — would hand someone else's device id to whoever asked.
func (r *Repository) RegisterDevice(ctx context.Context, userID uuid.UUID, name, platform, deviceKey string, signalIdentity []byte) (uuid.UUID, error) {
	if deviceKey != "" {
		const upsert = `
			INSERT INTO devices (id, user_id, name, platform, device_key, signal_identity)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (user_id, device_key) WHERE device_key IS NOT NULL
			DO UPDATE SET name = excluded.name,
			              platform = excluded.platform,
			              last_seen_at = NOW()
			RETURNING id
		`
		var out uuid.UUID
		err := r.db.QueryRow(ctx, upsert,
			uuid.New(), userID, name, platform, deviceKey, signalIdentity).Scan(&out)
		if err != nil {
			return uuid.Nil, err
		}
		return out, nil
	}

	const q = `
		INSERT INTO devices (id, user_id, name, platform, signal_identity)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`
	row := r.db.QueryRow(ctx, q, uuid.New(), userID, name, platform, signalIdentity)
	var out uuid.UUID
	if err := row.Scan(&out); err != nil {
		return uuid.Nil, err
	}
	return out, nil
}

// ErrAlreadyRevoked is returned by RotateSession when the parent row was
// already revoked (or removed). The service treats it as a replay signal.
var ErrAlreadyRevoked = errors.New("session_already_revoked")

// IsNoRows is a small helper so callers don't import pgx just to test it.
func IsNoRows(err error) bool { return err != nil && errors.Is(err, pgx.ErrNoRows) }
