package blocks

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

func blockDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping integration test")
	}
	pool, err := postgres.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func mkUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	name := "blk_" + uuid.NewString()[:8]
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

type fakeDirectory struct {
	exists map[uuid.UUID]bool
	peer   map[uuid.UUID]uuid.UUID // chatID → peer
}

func (f fakeDirectory) Exists(_ context.Context, id uuid.UUID) (bool, error) {
	return f.exists[id], nil
}

func (f fakeDirectory) PeerOf(_ context.Context, chatID, _ uuid.UUID) (uuid.UUID, error) {
	p, ok := f.peer[chatID]
	if !ok {
		return uuid.Nil, errors.New("no peer")
	}
	return p, nil
}

// TestBlockingIsOneSided is the whole change.
//
// The block used to be `chats.status = 'blocked'`, set with no user_id, so it
// was symmetric: blocking someone also stopped you writing to them.
func TestBlockingIsOneSided(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	me, them := mkUser(t, pool), mkUser(t, pool)
	if err := repo.Block(ctx, me, them); err != nil {
		t.Fatalf("Block: %v", err)
	}

	mine, err := repo.Blocks(ctx, me, them)
	if err != nil || !mine {
		t.Fatalf("Blocks(me→them) = %v,%v; want true", mine, err)
	}
	theirs, err := repo.Blocks(ctx, them, me)
	if err != nil {
		t.Fatalf("Blocks: %v", err)
	}
	if theirs {
		t.Fatal("blocking someone also recorded them as having blocked you")
	}
}

// TestUnblock: this did not exist at all. Blocking by mistake was permanent —
// no route, no service method, no button anywhere in the codebase.
func TestUnblock(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	me, them := mkUser(t, pool), mkUser(t, pool)
	if err := repo.Block(ctx, me, them); err != nil {
		t.Fatalf("Block: %v", err)
	}
	if err := repo.Unblock(ctx, me, them); err != nil {
		t.Fatalf("Unblock: %v", err)
	}
	if yes, _ := repo.Blocks(ctx, me, them); yes {
		t.Fatal("unblocking left the block in place")
	}

	// And unblocking someone who was never blocked is the state you asked for.
	if err := repo.Unblock(ctx, me, them); err != nil {
		t.Fatalf("second Unblock: %v", err)
	}
}

// TestUnblockingLiftsOnlyYourHalf: mutual blocks are two decisions. Lifting
// yours must not lift theirs, or one person could undo the other's.
func TestUnblockingLiftsOnlyYourHalf(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	a, b := mkUser(t, pool), mkUser(t, pool)
	if err := repo.Block(ctx, a, b); err != nil {
		t.Fatalf("Block a→b: %v", err)
	}
	if err := repo.Block(ctx, b, a); err != nil {
		t.Fatalf("Block b→a: %v", err)
	}

	if err := repo.Unblock(ctx, a, b); err != nil {
		t.Fatalf("Unblock: %v", err)
	}
	if yes, _ := repo.Blocks(ctx, b, a); !yes {
		t.Fatal("lifting one block lifted the other person's too")
	}
	// And the channel stays shut, because one side still wants it shut.
	if yes, _ := repo.EitherWay(ctx, a, b); !yes {
		t.Fatal("the channel opened while one side still blocks the other")
	}
}

// TestEitherWayIsSymmetric: a one-to-one channel needs both sides willing, and
// which of them pressed the button must not decide who is spared.
func TestEitherWayIsSymmetric(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	a, b := mkUser(t, pool), mkUser(t, pool)
	if err := repo.Block(ctx, a, b); err != nil {
		t.Fatalf("Block: %v", err)
	}
	for _, pair := range [][2]uuid.UUID{{a, b}, {b, a}} {
		yes, err := repo.EitherWay(ctx, pair[0], pair[1])
		if err != nil || !yes {
			t.Fatalf("EitherWay(%v) = %v,%v; want true", pair, yes, err)
		}
	}

	// Someone uninvolved is not caught by it.
	c := mkUser(t, pool)
	if yes, _ := repo.EitherWay(ctx, a, c); yes {
		t.Fatal("an unrelated person reads as blocked")
	}
}

// TestBlockingIsIdempotent: pressing block twice is one block, not an error
// the app has to explain.
func TestBlockingIsIdempotent(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	me, them := mkUser(t, pool), mkUser(t, pool)
	for i := range 2 {
		if err := repo.Block(ctx, me, them); err != nil {
			t.Fatalf("Block #%d: %v", i+1, err)
		}
	}
	list, err := repo.List(ctx, me)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("blocked the same person %d times", len(list))
	}
}

// TestCannotBlockYourself.
func TestCannotBlockYourself(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	me := mkUser(t, pool)
	svc := NewService(NewRepo(pool), fakeDirectory{exists: map[uuid.UUID]bool{me: true}})

	if err := svc.Block(ctx, me, me); !errors.Is(err, ErrSelf) {
		t.Fatalf("Block(self) = %v, want ErrSelf", err)
	}
}

// TestCannotBlockSomeoneWhoDoesNotExist keeps the list joinable: a row
// pointing at nobody would drop out of List and read as "not blocked".
func TestCannotBlockSomeoneWhoDoesNotExist(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	me := mkUser(t, pool)
	svc := NewService(NewRepo(pool), fakeDirectory{exists: map[uuid.UUID]bool{me: true}})

	if err := svc.Block(ctx, me, uuid.New()); !errors.Is(err, ErrNoUser) {
		t.Fatalf("Block(ghost) = %v, want ErrNoUser", err)
	}
}

// TestBlockingThroughAChatBlocksThePerson: installed builds call
// POST /chats/:id/block, and it has to write the same thing as the new route.
func TestBlockingThroughAChatBlocksThePerson(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	me, them := mkUser(t, pool), mkUser(t, pool)
	chatID := uuid.New()
	svc := NewService(repo, fakeDirectory{
		exists: map[uuid.UUID]bool{me: true, them: true},
		peer:   map[uuid.UUID]uuid.UUID{chatID: them},
	})

	if err := svc.BlockChatPeer(ctx, chatID, me); err != nil {
		t.Fatalf("BlockChatPeer: %v", err)
	}
	if yes, _ := repo.Blocks(ctx, me, them); !yes {
		t.Fatal("blocking through a chat did not block the person")
	}

	// A group has no single peer, so there is nobody to block. The report that
	// usually accompanies it still stands; this must not guess.
	group := uuid.New()
	if err := svc.BlockChatPeer(ctx, group, me); !errors.Is(err, ErrNoUser) {
		t.Fatalf("BlockChatPeer(group) = %v, want ErrNoUser", err)
	}
}

// TestListShowsWhoYouBlocked, with enough to draw a row and unblock them.
func TestListShowsWhoYouBlocked(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	me, them := mkUser(t, pool), mkUser(t, pool)
	if err := repo.Block(ctx, me, them); err != nil {
		t.Fatalf("Block: %v", err)
	}

	list, err := repo.List(ctx, me)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 || list[0].UserID != them {
		t.Fatalf("List = %+v, want the one person blocked", list)
	}
	if list[0].Username == "" || list[0].DisplayName == "" {
		t.Fatal("the list cannot draw a row: no username, no name")
	}

	// The other person's list is their own, and it is empty.
	theirs, err := repo.List(ctx, them)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(theirs) != 0 {
		t.Fatalf("being blocked put %d entries in their own block list", len(theirs))
	}
}

// TestDeletingAnAccountClearsItsBlocks — the rows point at users on both
// sides, and a block naming nobody would sit in the table forever.
func TestDeletingAnAccountClearsItsBlocks(t *testing.T) {
	pool := blockDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	me, them := mkUser(t, pool), mkUser(t, pool)
	if err := repo.Block(ctx, me, them); err != nil {
		t.Fatalf("Block: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, them); err != nil {
		t.Fatalf("delete account: %v", err)
	}

	list, err := repo.List(ctx, me)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("%d blocks outlived the account they named", len(list))
	}
}
