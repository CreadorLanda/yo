package stories

import (
	"context"
	"errors"
	"math"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/yo/server/internal/platform/postgres"
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

func createUser(t *testing.T, pool *pgxpool.Pool, username string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, username).Scan(&id)
	if err != nil {
		t.Fatalf("create user %q: %v", username, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// TestViewersIsAuthorOnly is the point of the endpoint, and the part worth
// guarding: who watched a story is as private as what they watched, so a
// viewer must not be able to read the audience of a story merely because
// they were allowed to see it.
func TestViewersIsAuthorOnly(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	watcher := createUser(t, pool, "watcher_"+uuid.NewString()[:8])
	other := createUser(t, pool, "other_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "olá"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Nobody has watched yet.
	list, err := svc.Viewers(ctx, story.ID, author)
	if err != nil {
		t.Fatalf("Viewers (empty): %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected no viewers, got %d", len(list))
	}

	if _, err := svc.View(ctx, story.ID, watcher); err != nil {
		t.Fatalf("View: %v", err)
	}

	list, err = svc.Viewers(ctx, story.ID, author)
	if err != nil {
		t.Fatalf("Viewers: %v", err)
	}
	if len(list) != 1 || list[0].UserID != watcher {
		t.Fatalf("expected the watcher, got %+v", list)
	}
	if list[0].Emoji != "" {
		t.Fatalf("no reaction was left, but got %q", list[0].Emoji)
	}

	// A reaction shows up against the viewer who left it.
	if _, err := svc.React(ctx, story.ID, watcher, single("🔥")); err != nil {
		t.Fatalf("React: %v", err)
	}
	list, err = svc.Viewers(ctx, story.ID, author)
	if err != nil {
		t.Fatalf("Viewers after react: %v", err)
	}
	if len(list) != 1 || list[0].Emoji != "🔥" {
		t.Fatalf("reaction missing from the viewer row: %+v", list)
	}

	// Reacting must not create a second row for the same person.
	if _, err := svc.React(ctx, story.ID, watcher, single("😂")); err != nil {
		t.Fatalf("React again: %v", err)
	}
	list, _ = svc.Viewers(ctx, story.ID, author)
	if len(list) != 1 {
		t.Fatalf("changing a reaction duplicated the viewer: %d rows", len(list))
	}
	// The single-emoji form replaces rather than adds, so the earlier 🔥 is
	// gone. A client sending one emoji behaves exactly as it did before.
	if len(list[0].Emojis) != 1 || list[0].Emojis[0] != "😂" {
		t.Fatalf("single-emoji react did not replace: %+v", list[0].Emojis)
	}

	// The guard: a viewer cannot read the audience.
	if _, err := svc.Viewers(ctx, story.ID, watcher); !errors.Is(err, ErrNotAuthor) {
		t.Fatalf("watcher reading the viewer list: got %v, want ErrNotAuthor", err)
	}
	if _, err := svc.Viewers(ctx, story.ID, other); !errors.Is(err, ErrNotAuthor) {
		t.Fatalf("outsider reading the viewer list: got %v, want ErrNotAuthor", err)
	}
}

// TestDeleteIsAuthorOnly guards the delete path, including what it reveals.
//
// A non-author gets "not found" rather than "not yours": telling them the
// story exists but is not theirs is itself a disclosure, and they had no
// business knowing either way.
func TestDeleteIsAuthorOnly(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	other := createUser(t, pool, "other_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "apaga-me"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := svc.Delete(ctx, story.ID, other); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider deleting: got %v, want ErrNotFound", err)
	}
	// And it must still be there.
	if _, err := svc.Get(ctx, story.ID, author); err != nil {
		t.Fatalf("story gone after a refused delete: %v", err)
	}

	if err := svc.Delete(ctx, story.ID, author); err != nil {
		t.Fatalf("author deleting own story: %v", err)
	}
	if _, err := svc.Get(ctx, story.ID, author); !errors.Is(err, ErrNotFound) {
		t.Fatalf("story readable after delete: %v", err)
	}
	// Deleting twice is not an error the UI should have to distinguish.
	if err := svc.Delete(ctx, story.ID, author); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: got %v, want ErrNotFound", err)
	}
}

// TestStoryTTLBounds pins the lifetime a story is given.
//
// Out-of-range values are clamped rather than rejected: the bound is a
// product decision, and losing an upload the author waited on because a
// number was too big is a worse outcome than a story living 72 hours
// instead of 200.
func TestStoryTTLBounds(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)
	author := createUser(t, pool, "ttl_"+uuid.NewString()[:8])

	hoursUntil := func(at time.Time) float64 {
		return math.Round(time.Until(at).Hours()*10) / 10
	}

	cases := []struct {
		name  string
		asked int
		want  float64
	}{
		{"zero means default", 0, StoryTTLDefaultHours},
		{"negative means default", -5, StoryTTLDefaultHours},
		{"the minimum", 1, StoryTTLMinHours},
		{"below the minimum clamps up", 0, StoryTTLDefaultHours},
		{"a middling value is honoured", 12, 12},
		{"the maximum", 72, StoryTTLMaxHours},
		{"above the maximum clamps down", 500, StoryTTLMaxHours},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st, err := svc.Create(ctx, author, CreateRequest{
				Kind: KindText, Caption: "x", TTLHours: c.asked,
			})
			if err != nil {
				t.Fatalf("Create(ttl=%d): %v", c.asked, err)
			}
			got := hoursUntil(st.ExpiresAt)
			// A tenth of an hour of slack for the round trip.
			if math.Abs(got-c.want) > 0.2 {
				t.Fatalf("ttl=%d expired in %.1fh, want %.1fh", c.asked, got, c.want)
			}
		})
	}

	// The bound the UI offers has to be the bound the server enforces.
	if StoryTTLMinHours != 1 || StoryTTLMaxHours != 72 {
		t.Fatalf("bounds drifted: min=%d max=%d", StoryTTLMinHours, StoryTTLMaxHours)
	}
}
