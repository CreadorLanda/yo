package auth

import (
	"context"
	"os"
	"testing"

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
