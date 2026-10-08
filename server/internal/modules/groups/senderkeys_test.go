package groups

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

func createTestUser(t *testing.T, pool *pgxpool.Pool, username string) uuid.UUID {
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

func epochOf(t *testing.T, svc *Service, chatID, user uuid.UUID) int {
	t.Helper()
	_, epoch, err := svc.MySenderKeys(context.Background(), chatID, user)
	if err != nil {
		t.Fatalf("MySenderKeys: %v", err)
	}
	return epoch
}

// TestSenderKeysAreMemberOnly guards the one thing the server is trusted with
// here: it cannot read a sender key, so all it can get wrong is who receives
// one. A blob addressed to a non-member must not be stored, or the group
// becomes a way to deliver data to arbitrary users, and a non-member must not
// be able to read the group's keys at all.
func TestSenderKeysAreMemberOnly(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])
	eve := createTestUser(t, pool, "eve_"+uuid.NewString()[:8])

	g, err := svc.Create(ctx, alice, CreateGroupRequest{
		Title:     "cifra",
		MemberIDs: []uuid.UUID{bob},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	err = svc.DistributeSenderKey(ctx, g.ID, alice, DistributeRequest{
		Epoch: epochOf(t, svc, g.ID, alice),
		Entries: []SenderKeyUpload{
			{UserID: bob, Ciphertext: "soc1.para-bob"},
			{UserID: eve, Ciphertext: "soc1.para-eve"},
		},
	})
	if err != nil {
		t.Fatalf("DistributeSenderKey: %v", err)
	}

	bobKeys, _, err := svc.MySenderKeys(ctx, g.ID, bob)
	if err != nil {
		t.Fatalf("MySenderKeys(bob): %v", err)
	}
	if len(bobKeys) != 1 || bobKeys[0].Ciphertext != "soc1.para-bob" {
		t.Fatalf("bob received %d keys: %+v", len(bobKeys), bobKeys)
	}
	if bobKeys[0].UserID != alice {
		t.Fatalf("key attributed to %s, want alice", bobKeys[0].UserID)
	}

	if _, _, err := svc.MySenderKeys(ctx, g.ID, eve); !errors.Is(err, ErrNotMember) {
		t.Fatalf("MySenderKeys(eve) = %v, want ErrNotMember", err)
	}
	var forEve int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM group_sender_keys WHERE chat_id = $1 AND recipient_id = $2`,
		g.ID, eve).Scan(&forEve); err != nil {
		t.Fatalf("count rows for eve: %v", err)
	}
	if forEve != 0 {
		t.Fatalf("stored %d sender keys for a non-member", forEve)
	}
}

// TestSenderKeysRotateOnMembershipChange is what makes leaving a group mean
// something. A member who is removed still holds every key that was current
// while they were there — nothing can take that back — so the keys have to
// stop being current instead.
func TestSenderKeysRotateOnMembershipChange(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])
	carol := createTestUser(t, pool, "carol_"+uuid.NewString()[:8])

	g, err := svc.Create(ctx, alice, CreateGroupRequest{
		Title:     "rotação",
		MemberIDs: []uuid.UUID{bob, carol},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	start := epochOf(t, svc, g.ID, alice)

	if _, err := svc.RemoveMember(ctx, g.ID, alice, carol); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	afterRemoval := epochOf(t, svc, g.ID, alice)
	if afterRemoval <= start {
		t.Fatalf("epoch %d after removal, was %d — the removed member keeps reading", afterRemoval, start)
	}

	// Joining rotates too, so a new member cannot open what was said before
	// they arrived.
	if _, err := svc.AddMembers(ctx, g.ID, alice, []uuid.UUID{carol}, true); err != nil {
		t.Fatalf("AddMembers: %v", err)
	}
	if afterJoin := epochOf(t, svc, g.ID, alice); afterJoin <= afterRemoval {
		t.Fatalf("epoch %d after join, was %d — new member can read history", afterJoin, afterRemoval)
	}
}

// TestSenderKeysSurviveRotationForHistory: keys are handed back for every
// epoch, not only the current one. Rotating must not make yesterday's
// messages unreadable for the people who were there.
func TestSenderKeysSurviveRotationForHistory(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])
	carol := createTestUser(t, pool, "carol_"+uuid.NewString()[:8])

	g, err := svc.Create(ctx, alice, CreateGroupRequest{
		Title:     "história",
		MemberIDs: []uuid.UUID{bob, carol},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	first := epochOf(t, svc, g.ID, alice)
	if err := svc.DistributeSenderKey(ctx, g.ID, alice, DistributeRequest{
		Epoch:   first,
		Entries: []SenderKeyUpload{{UserID: bob, Ciphertext: "soc1.epoca-antiga"}},
	}); err != nil {
		t.Fatalf("distribute first: %v", err)
	}

	if _, err := svc.RemoveMember(ctx, g.ID, alice, carol); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}

	second := epochOf(t, svc, g.ID, alice)
	if err := svc.DistributeSenderKey(ctx, g.ID, alice, DistributeRequest{
		Epoch:   second,
		Entries: []SenderKeyUpload{{UserID: bob, Ciphertext: "soc1.epoca-nova"}},
	}); err != nil {
		t.Fatalf("distribute second: %v", err)
	}

	keys, epoch, err := svc.MySenderKeys(ctx, g.ID, bob)
	if err != nil {
		t.Fatalf("MySenderKeys: %v", err)
	}
	if epoch != second {
		t.Fatalf("reported epoch %d, want %d", epoch, second)
	}
	if len(keys) != 2 {
		t.Fatalf("got %d keys, want both epochs: %+v", len(keys), keys)
	}
	// Oldest first, so a client can replay them in order.
	if keys[0].Epoch >= keys[1].Epoch {
		t.Fatalf("keys not ordered by epoch: %d then %d", keys[0].Epoch, keys[1].Epoch)
	}
}

// TestNoNoticeWhenNothingHappened: a group notice should describe something
// that occurred.
//
// The notice and the key rotation both fired unconditionally — adding someone
// already in the group, or sending an empty list, still wrote "members added"
// into the thread and still retired everyone's sender key.
func TestNoNoticeWhenNothingHappened(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	g, err := svc.Create(ctx, alice, CreateGroupRequest{Title: "avisos", MemberIDs: []uuid.UUID{bob}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	countNotices := func() int {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM messages
			WHERE chat_id = $1 AND message_type = 'system' AND content LIKE '%members_added%'
		`, g.ID).Scan(&n); err != nil {
			t.Fatalf("count notices: %v", err)
		}
		return n
	}

	before := countNotices()
	epochBefore := epochOf(t, svc, g.ID, alice)

	// Bob is already a member. Nothing changes.
	if _, err := svc.AddMembers(ctx, g.ID, alice, []uuid.UUID{bob}, true); err != nil {
		t.Fatalf("AddMembers(existing): %v", err)
	}
	if got := countNotices(); got != before {
		t.Fatalf("adding an existing member wrote %d notices, want %d", got, before)
	}
	if got := epochOf(t, svc, g.ID, alice); got != epochBefore {
		t.Fatalf("adding an existing member rotated the keys: %d → %d", epochBefore, got)
	}

	// An empty list changes nothing either.
	if _, err := svc.AddMembers(ctx, g.ID, alice, []uuid.UUID{}, true); err != nil {
		t.Fatalf("AddMembers(empty): %v", err)
	}
	if got := countNotices(); got != before {
		t.Fatalf("an empty add wrote a notice")
	}

	// A real addition does announce, and does rotate.
	carol := createTestUser(t, pool, "carol_"+uuid.NewString()[:8])
	if _, err := svc.AddMembers(ctx, g.ID, alice, []uuid.UUID{carol}, false); err != nil {
		t.Fatalf("AddMembers(new): %v", err)
	}
	if got := countNotices(); got != before+1 {
		t.Fatalf("a real addition wrote %d notices, want %d", got, before+1)
	}
	if got := epochOf(t, svc, g.ID, alice); got <= epochBefore {
		t.Fatal("a real addition did not rotate the keys")
	}
}
