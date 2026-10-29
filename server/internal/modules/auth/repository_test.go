package auth

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping integration test (see make docker-up-local)")
	}
	pool, err := postgres.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func createTestUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	name := "dev_" + uuid.NewString()[:8]
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// TestRegisterDeviceReusesRowForSameInstall is the point of the device key.
//
// Every sign-in used to insert a brand new device row: one real handset had
// accumulated 23 of them, ten in a single day. Each row publishes its own
// pre-key bundle, and a peer is handed whichever row was seen most recently,
// so which key answered depended on registration order rather than on which
// device the person was actually holding.
func TestRegisterDeviceReusesRowForSameInstall(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	user := createTestUser(t, pool)

	const install = "install-abc-123"
	first, err := repo.RegisterDevice(ctx, user, "mobile", "android", install, []byte{})
	if err != nil {
		t.Fatalf("first RegisterDevice: %v", err)
	}
	second, err := repo.RegisterDevice(ctx, user, "mobile", "android", install, []byte{})
	if err != nil {
		t.Fatalf("second RegisterDevice: %v", err)
	}
	if first != second {
		t.Fatalf("same install produced two device ids: %s then %s", first, second)
	}

	// A genuinely different install is a different device and must not be
	// folded into the first one.
	other, err := repo.RegisterDevice(ctx, user, "mobile", "ios", "install-xyz-789", []byte{})
	if err != nil {
		t.Fatalf("other RegisterDevice: %v", err)
	}
	if other == first {
		t.Fatal("two installs collapsed into one device row")
	}

	// An older client sends no key. It cannot be recognised, so it gets its
	// own row rather than being guessed into someone else's.
	legacyA, err := repo.RegisterDevice(ctx, user, "mobile", "android", "", []byte{})
	if err != nil {
		t.Fatalf("legacy RegisterDevice: %v", err)
	}
	legacyB, err := repo.RegisterDevice(ctx, user, "mobile", "android", "", []byte{})
	if err != nil {
		t.Fatalf("legacy RegisterDevice again: %v", err)
	}
	if legacyA == legacyB {
		t.Fatal("keyless registrations were merged; the server cannot tell them apart")
	}

	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM devices WHERE user_id = $1`, user).Scan(&rows); err != nil {
		t.Fatalf("count devices: %v", err)
	}
	// Two keyed installs plus two unrecognisable ones — not six.
	if rows != 4 {
		t.Fatalf("device rows = %d, want 4", rows)
	}
}

// TestRegisterDeviceRefreshesLastSeen matters because the pre-key bundle a
// peer receives is chosen by last_seen_at. If signing in again did not touch
// it, a stale row could keep answering for a device nobody uses.
func TestRegisterDeviceRefreshesLastSeen(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	user := createTestUser(t, pool)

	id, err := repo.RegisterDevice(ctx, user, "mobile", "android", "install-seen", []byte{})
	if err != nil {
		t.Fatalf("RegisterDevice: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE devices SET last_seen_at = NOW() - INTERVAL '30 days' WHERE id = $1`, id); err != nil {
		t.Fatalf("age the row: %v", err)
	}

	if _, err := repo.RegisterDevice(ctx, user, "mobile", "android", "install-seen", []byte{}); err != nil {
		t.Fatalf("second RegisterDevice: %v", err)
	}

	var stale bool
	if err := pool.QueryRow(ctx,
		`SELECT last_seen_at < NOW() - INTERVAL '1 day' FROM devices WHERE id = $1`, id).Scan(&stale); err != nil {
		t.Fatalf("read last_seen_at: %v", err)
	}
	if stale {
		t.Fatal("signing in again left last_seen_at untouched")
	}
}

func TestVerifyEmailRejectsAttemptsThenAllowsReplacementChallenge(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	user := createTestUser(t, pool)

	wrongHash := []byte("wrong-code-hash")
	correctHash := []byte("correct-code-hash")
	if err := repo.SetEmailChallenge(ctx, user, "first@example.com", correctHash, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("SetEmailChallenge: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, err := repo.VerifyEmail(ctx, user, wrongHash, time.Now()); !errors.Is(err, ErrVerificationInvalid) {
			t.Fatalf("wrong attempt %d: got %v, want ErrVerificationInvalid", i+1, err)
		}
	}
	if _, err := repo.VerifyEmail(ctx, user, wrongHash, time.Now()); !errors.Is(err, ErrVerificationAttempts) {
		t.Fatalf("sixth wrong attempt: got %v, want ErrVerificationAttempts", err)
	}

	replacementHash := []byte("replacement-code-hash")
	if err := repo.SetEmailChallenge(ctx, user, "replacement@example.com", replacementHash, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("replace email challenge: %v", err)
	}
	verified, err := repo.VerifyEmail(ctx, user, replacementHash, time.Now())
	if err != nil {
		t.Fatalf("VerifyEmail replacement: %v", err)
	}
	if verified.Email == nil || *verified.Email != "replacement@example.com" || verified.EmailVerifiedAt == nil {
		t.Fatalf("replacement email was not verified: %+v", verified)
	}

	var consumed int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_verifications WHERE user_id = $1 AND consumed_at IS NOT NULL`, user).Scan(&consumed); err != nil {
		t.Fatalf("count consumed email challenges: %v", err)
	}
	if consumed != 2 {
		t.Fatalf("consumed email challenges = %d, want 2", consumed)
	}
}

func TestEmailChallengeConflictAndPendingEmailRollback(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	owner := createTestUser(t, pool)
	other := createTestUser(t, pool)

	ownerHash := []byte("owner-email-code")
	if err := repo.SetEmailChallenge(ctx, owner, "owner@example.com", ownerHash, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("set owner email challenge: %v", err)
	}
	if _, err := repo.VerifyEmail(ctx, owner, ownerHash, time.Now()); err != nil {
		t.Fatalf("verify owner email: %v", err)
	}

	conflictHash := []byte("conflict-email-code")
	if err := repo.SetEmailChallenge(ctx, other, "owner@example.com", conflictHash, time.Now().Add(10*time.Minute)); !errors.Is(err, ErrCredentialConflict) {
		t.Fatalf("email conflict: got %v, want ErrCredentialConflict", err)
	}

	pendingHash := []byte("pending-email-code")
	if err := repo.SetEmailChallenge(ctx, owner, "pending@example.com", pendingHash, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("set pending email: %v", err)
	}
	otherHash := []byte("other-email-code")
	if err := repo.SetEmailChallenge(ctx, other, "pending@example.com", otherHash, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("claim pending email before verification: %v", err)
	}
	if _, err := repo.VerifyEmail(ctx, other, otherHash, time.Now()); err != nil {
		t.Fatalf("verify competing email: %v", err)
	}

	if _, err := repo.VerifyEmail(ctx, owner, pendingHash, time.Now()); !errors.Is(err, ErrCredentialConflict) {
		t.Fatalf("pending email race: got %v, want ErrCredentialConflict", err)
	}
	current, err := repo.UserByID(ctx, owner)
	if err != nil {
		t.Fatalf("read owner after conflict: %v", err)
	}
	if current.Email == nil || *current.Email != "owner@example.com" || current.PendingEmail == nil || *current.PendingEmail != "pending@example.com" {
		t.Fatalf("conflicting verification changed owner state: %+v", current)
	}
}

func TestCompletePhoneChangeRevokesSessionsAndRollsBackOnConflict(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	user := createTestUser(t, pool)
	other := createTestUser(t, pool)

	device, err := repo.RegisterDevice(ctx, user, "mobile", "android", "phone-change-test", []byte{})
	if err != nil {
		t.Fatalf("RegisterDevice: %v", err)
	}
	if _, _, err := repo.CreateSession(ctx, user, device, []byte("access"), []byte("refresh")); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, _, err := repo.CreateSession(ctx, user, device, []byte("access-2"), []byte("refresh-2")); err != nil {
		t.Fatalf("CreateSession second: %v", err)
	}

	newPhoneHash := []byte("new-phone-hash")
	if err := repo.CreatePhoneChange(ctx, user, newPhoneHash, []byte("phone-code"), time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("CreatePhoneChange: %v", err)
	}
	if err := repo.CompletePhoneChange(ctx, user, []byte("phone-code"), time.Now()); err != nil {
		t.Fatalf("CompletePhoneChange: %v", err)
	}
	var stored []byte
	if err := pool.QueryRow(ctx, `SELECT phone_hash FROM users WHERE id = $1`, user).Scan(&stored); err != nil {
		t.Fatalf("read changed phone: %v", err)
	}
	if string(stored) != string(newPhoneHash) {
		t.Fatalf("phone hash = %x, want %x", stored, newPhoneHash)
	}
	var live int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, user).Scan(&live); err != nil {
		t.Fatalf("count live sessions: %v", err)
	}
	if live != 0 {
		t.Fatalf("live sessions after phone change = %d, want 0", live)
	}

	var otherPhoneHash []byte
	if err := pool.QueryRow(ctx, `SELECT phone_hash FROM users WHERE id = $1`, other).Scan(&otherPhoneHash); err != nil {
		t.Fatalf("read other phone: %v", err)
	}
	conflictCode := []byte("conflict-phone-code")
	if err := repo.CreatePhoneChange(ctx, user, otherPhoneHash, conflictCode, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("CreatePhoneChange conflict: %v", err)
	}
	if err := repo.CompletePhoneChange(ctx, user, conflictCode, time.Now()); !errors.Is(err, ErrCredentialConflict) {
		t.Fatalf("phone conflict: got %v, want ErrCredentialConflict", err)
	}
	var consumed bool
	if err := pool.QueryRow(ctx, `SELECT consumed_at IS NOT NULL FROM phone_change_challenges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, user).Scan(&consumed); err != nil {
		t.Fatalf("read conflict challenge: %v", err)
	}
	if consumed {
		t.Fatal("conflicting phone change consumed its challenge")
	}
}

func TestVerificationExpiryIsClosedAtExactBoundary(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	user := createTestUser(t, pool)
	now := time.Now().UTC().Truncate(time.Microsecond)
	if err := repo.SetEmailChallenge(ctx, user, "expired@example.com", []byte("expired-code"), now); err != nil {
		t.Fatalf("SetEmailChallenge: %v", err)
	}
	if _, err := repo.VerifyEmail(ctx, user, []byte("expired-code"), now); !errors.Is(err, ErrVerificationExpired) {
		t.Fatalf("exact expiry: got %v, want ErrVerificationExpired", err)
	}
}
