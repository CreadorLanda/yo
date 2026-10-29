package users

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

func ghostTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping Ghost Mode integration test")
	}
	pool, err := postgres.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func ghostTestUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	name := "ghost_" + uuid.NewString()[:12]
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1)
		RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create ghost test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestGhostModeDailyQuotaExpiryUTCAndConcurrentDevices(t *testing.T) {
	pool := ghostTestDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	base := time.Date(2026, time.January, 1, 1, 0, 0, 0, time.UTC)

	expiryUser := ghostTestUser(t, pool)
	clock := base
	svc := NewService(repo).WithClock(func() time.Time { return clock })
	active, err := svc.ActivateGhostMode(ctx, expiryUser)
	if err != nil {
		t.Fatalf("activate at UTC boundary: %v", err)
	}
	if !active.GhostMode || active.GhostModeExpiresAt == nil || !active.GhostModeExpiresAt.Equal(base.Add(GhostModeDuration)) {
		t.Fatalf("activation window = %+v", active)
	}
	if active.GhostModeNextActivationAt == nil || !active.GhostModeNextActivationAt.Equal(time.Date(2026, time.January, 2, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("next activation = %v, want next UTC midnight", active.GhostModeNextActivationAt)
	}

	clock = base.Add(GhostModeDuration)
	expired, err := repo.ByIDAt(ctx, expiryUser, clock)
	if err != nil {
		t.Fatalf("read after expiry: %v", err)
	}
	if expired.GhostMode {
		t.Fatal("Ghost Mode remained active after the server expiry")
	}

	clock = base.Add(GhostModeDuration + time.Hour)
	if _, err := svc.ActivateGhostMode(ctx, expiryUser); !errors.Is(err, ErrGhostDailyLimit) {
		t.Fatalf("same UTC day reactivation = %v, want ErrGhostDailyLimit", err)
	}

	boundaryUser := ghostTestUser(t, pool)
	clock = time.Date(2026, time.January, 1, 23, 59, 0, 0, time.UTC)
	boundarySvc := NewService(repo).WithClock(func() time.Time { return clock })
	if _, err := boundarySvc.ActivateGhostMode(ctx, boundaryUser); err != nil {
		t.Fatalf("boundary activation: %v", err)
	}
	clock = clock.Add(30 * time.Second)
	if _, err := boundarySvc.DeactivateGhostMode(ctx, boundaryUser); err != nil {
		t.Fatalf("deactivate before UTC boundary: %v", err)
	}
	clock = time.Date(2026, time.January, 2, 0, 0, 0, 0, time.UTC)
	if _, err := boundarySvc.ActivateGhostMode(ctx, boundaryUser); err != nil {
		t.Fatalf("activation at next UTC day: %v", err)
	}

	concurrentUser := ghostTestUser(t, pool)
	concurrentClock := base.Add(48 * time.Hour)
	concurrentSvc := NewService(repo).WithClock(func() time.Time { return concurrentClock })
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := concurrentSvc.ActivateGhostMode(ctx, concurrentUser)
			results <- err
		}()
	}
	wg.Wait()
	close(results)

	var successes, failures int
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		failures++
		if !errors.Is(err, ErrGhostAlreadyActive) && !errors.Is(err, ErrGhostDailyLimit) {
			t.Fatalf("concurrent activation error = %v", err)
		}
	}
	if successes != 1 || failures != 1 {
		t.Fatalf("concurrent activations = %d successes, %d failures; want one each", successes, failures)
	}
}

func TestGhostModePatchRejectsMixedUpdates(t *testing.T) {
	pool := ghostTestDB(t)
	ctx := context.Background()
	userID := ghostTestUser(t, pool)
	repo := NewRepository(pool)
	svc := NewService(repo)

	name := "must_not_persist"
	enabled := true
	if _, err := svc.Patch(ctx, userID, PatchRequest{DisplayName: &name, GhostMode: &enabled}); !errors.Is(err, ErrMixedGhostPatch) {
		t.Fatalf("mixed patch error = %v, want ErrMixedGhostPatch", err)
	}
	u, err := repo.ByID(ctx, userID)
	if err != nil {
		t.Fatalf("read after rejected mixed patch: %v", err)
	}
	if u.DisplayName == name || u.GhostMode {
		t.Fatalf("mixed patch partially persisted: %+v", u)
	}
}
