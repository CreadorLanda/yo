package posts

import (
	"context"
	"errors"
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

func createUser(t *testing.T, db *pgxpool.Pool, prefix string) uuid.UUID {
	t.Helper()
	name := prefix + "_" + uuid.NewString()[:8]
	var id uuid.UUID
	if err := db.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create user %q: %v", name, err)
	}
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func createMedia(t *testing.T, db *pgxpool.Pool, owner uuid.UUID, kind string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRow(context.Background(), `
		INSERT INTO media_objects (owner_id, kind, mime_type, size_bytes, storage_path)
		VALUES ($1, $2, 'application/octet-stream', 1, $3) RETURNING id
	`, owner, kind, "test/"+uuid.NewString()).Scan(&id); err != nil {
		t.Fatalf("create media: %v", err)
	}
	return id
}

func directChat(t *testing.T, db *pgxpool.Pool, a, b uuid.UUID, status string) uuid.UUID {
	t.Helper()
	var chatID uuid.UUID
	if err := db.QueryRow(context.Background(), `
		INSERT INTO chats (type, created_by, status) VALUES ('direct', $1, $2) RETURNING id
	`, a, status).Scan(&chatID); err != nil {
		t.Fatalf("create direct chat: %v", err)
	}
	if _, err := db.Exec(context.Background(), `
		INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)
	`, chatID, a, b); err != nil {
		t.Fatalf("add participants: %v", err)
	}
	return chatID
}

func TestPostAudience(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	repo := NewRepository(db)
	svc := NewService(repo)

	author := createUser(t, db, "post_author")
	contact := createUser(t, db, "post_contact")
	pending := createUser(t, db, "post_pending")
	stranger := createUser(t, db, "post_stranger")
	blocked := createUser(t, db, "post_blocked")
	directChat(t, db, author, contact, "active")
	directChat(t, db, author, pending, "pending")
	directChat(t, db, author, blocked, "active")
	if _, err := db.Exec(ctx, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, author, blocked); err != nil {
		t.Fatalf("block: %v", err)
	}

	private, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindPost, Visibility: VisContacts,
		MediaIDs: []uuid.UUID{createMedia(t, db, author, "image"), createMedia(t, db, author, "video")},
	})
	if err != nil {
		t.Fatalf("create contacts post: %v", err)
	}
	public, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindReel, Visibility: VisPublic,
		MediaIDs: []uuid.UUID{createMedia(t, db, author, "video")},
	})
	if err != nil {
		t.Fatalf("create public reel: %v", err)
	}

	cases := []struct {
		name        string
		viewer      uuid.UUID
		seesPrivate bool
		seesPublic  bool
	}{
		{"author", author, true, true},
		{"contact", contact, true, true},
		// A request not yet accepted is not a relationship.
		{"pending request", pending, false, true},
		{"stranger", stranger, false, true},
		// A block hides everything, public included.
		{"blocked contact", blocked, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, want := range []struct {
				post Post
				sees bool
			}{{private, tc.seesPrivate}, {public, tc.seesPublic}} {
				_, err := svc.Get(ctx, want.post.ID, tc.viewer)
				if got := err == nil; got != want.sees {
					t.Errorf("get %s %s: visible = %v, want %v (err %v)",
						want.post.Visibility, want.post.Kind, got, want.sees, err)
				}
				if err != nil && !errors.Is(err, ErrNotFound) {
					t.Errorf("a hidden post must read as missing, got %v", err)
				}
			}

			grid, err := svc.ListByAuthor(ctx, tc.viewer, ListQuery{Author: author})
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			want := 0
			if tc.seesPrivate {
				want++
			}
			if tc.seesPublic {
				want++
			}
			if len(grid) != want {
				t.Fatalf("grid has %d posts, want %d", len(grid), want)
			}
		})
	}

	// Newest first, slides in the order they were published, and the kind
	// filter narrows the grid.
	grid, err := svc.ListByAuthor(ctx, author, ListQuery{Author: author})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if grid[0].ID != public.ID || grid[1].ID != private.ID {
		t.Errorf("grid is not newest first")
	}
	if len(grid[1].Media) != 2 || grid[1].Media[0].Kind != "image" || grid[1].Media[1].Kind != "video" {
		t.Errorf("carousel slides came back as %+v", grid[1].Media)
	}
	reels, err := svc.ListByAuthor(ctx, author, ListQuery{Author: author, Kind: KindReel})
	if err != nil {
		t.Fatalf("list reels: %v", err)
	}
	if len(reels) != 1 || reels[0].ID != public.ID {
		t.Errorf("kind filter returned %d posts", len(reels))
	}
	older, err := svc.ListByAuthor(ctx, author, ListQuery{Author: author, Before: public.CreatedAt})
	if err != nil {
		t.Fatalf("list before: %v", err)
	}
	if len(older) != 1 || older[0].ID != private.ID {
		t.Errorf("paging before the newest returned %d posts", len(older))
	}
}

func TestPublishingRefusesMediaThatIsNotYours(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(db))
	author := createUser(t, db, "post_thief")
	victim := createUser(t, db, "post_victim")

	theirs := createMedia(t, db, victim, "image")
	if _, err := svc.Create(ctx, author, CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{theirs}}); !errors.Is(err, ErrMediaNotOwned) {
		t.Fatalf("someone else's media: err = %v, want %v", err, ErrMediaNotOwned)
	}

	// Already past its deadline: the sweeper is about to remove the bytes.
	gone := createMedia(t, db, author, "image")
	if _, err := db.Exec(ctx, `UPDATE media_objects SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, gone); err != nil {
		t.Fatalf("set expiry: %v", err)
	}
	if _, err := svc.Create(ctx, author, CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{gone}}); !errors.Is(err, ErrMediaNotOwned) {
		t.Fatalf("expired media: err = %v, want %v", err, ErrMediaNotOwned)
	}
}

// Every upload is stamped with the relay's deadline, after which the sweeper
// deletes the bytes. A post is permanent, so publishing has to take its media
// off that deadline, and deleting the post has to put it back.
//
// This is the test the first version of the module did not have: it refused
// any media with a deadline, which is every real upload, so nothing could be
// published at all.
func TestPublishingPinsMediaAndDeletingReleasesIt(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(db))
	author := createUser(t, db, "post_pin")

	state := func(id uuid.UUID) (keep, sweepable bool) {
		t.Helper()
		if err := db.QueryRow(ctx, `
			SELECT keep_forever,
			       NOT keep_forever AND expires_at IS NOT NULL AND expires_at <= NOW()
			FROM media_objects WHERE id = $1
		`, id).Scan(&keep, &sweepable); err != nil {
			t.Fatalf("media state: %v", err)
		}
		return keep, sweepable
	}
	upload := func() uuid.UUID {
		t.Helper()
		id := createMedia(t, db, author, "image")
		// What media.Service.Upload does to every new object.
		if _, err := db.Exec(ctx, `UPDATE media_objects SET expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`, id); err != nil {
			t.Fatalf("stamp deadline: %v", err)
		}
		return id
	}

	shared, only := upload(), upload()
	first, err := svc.Create(ctx, author, CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{shared, only}})
	if err != nil {
		t.Fatalf("publish a fresh upload: %v", err)
	}
	second, err := svc.Create(ctx, author, CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{shared}})
	if err != nil {
		t.Fatalf("publish again: %v", err)
	}
	for _, id := range []uuid.UUID{shared, only} {
		if keep, sweepable := state(id); !keep || sweepable {
			t.Fatalf("published media is still on a deadline (keep=%v sweepable=%v)", keep, sweepable)
		}
	}

	if err := svc.Delete(ctx, first.ID, author); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if keep, sweepable := state(only); keep || !sweepable {
		t.Errorf("media of a deleted post is not released (keep=%v sweepable=%v)", keep, sweepable)
	}
	// Still shown by the second post, so it must stay.
	if keep, sweepable := state(shared); !keep || sweepable {
		t.Errorf("media another post still shows was released (keep=%v sweepable=%v)", keep, sweepable)
	}
	if err := svc.Delete(ctx, second.ID, author); err != nil {
		t.Fatalf("delete second: %v", err)
	}
	if keep, sweepable := state(shared); keep || !sweepable {
		t.Errorf("media was not released once its last post went (keep=%v sweepable=%v)", keep, sweepable)
	}
}
