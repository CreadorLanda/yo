package calls

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

func historyDB(t *testing.T) *pgxpool.Pool {
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
	name := "call_" + uuid.NewString()[:8]
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func mkChat(t *testing.T, pool *pgxpool.Pool, members ...uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO chats (type, created_by, status) VALUES ('group', $1, 'active') RETURNING id
	`, members[0]).Scan(&id); err != nil {
		t.Fatalf("create chat: %v", err)
	}
	for _, m := range members {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, id, m); err != nil {
			t.Fatalf("add participant: %v", err)
		}
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1`, id) })
	return id
}

func find(t *testing.T, list []Entry, callID uuid.UUID) Entry {
	t.Helper()
	for _, e := range list {
		if e.ID == callID {
			return e
		}
	}
	t.Fatalf("call %s missing from the log", callID)
	return Entry{}
}

// TestRunningCallIsJoinable is the point of the whole feature.
//
// You miss the ring, open the app, and the call is still going. Reporting it
// as "missed" would hide the one call the log could actually help with — and
// "missed" is not even knowable yet, because nobody can know it was missed
// until the call is over.
func TestRunningCallIsJoinable(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)

	callID, _, err := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	log, err := repo.History(ctx, bob, 10)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	e := find(t, log, callID)
	if e.Outcome != OutcomeRinging {
		t.Fatalf("outcome = %q, want %q — a live call must not read as missed", e.Outcome, OutcomeRinging)
	}
	if !e.Running {
		t.Fatal("a call with no end is still running")
	}

	// And it is joinable: the log entry is a button, not a record.
	id, running, err := repo.Running(ctx, chat)
	if err != nil || !running || id != callID {
		t.Fatalf("Running = %s,%v,%v; want the live call", id, running, err)
	}
}

// TestMissedOnlyAfterTheCallEnds: the outcome flips once, at the end.
func TestMissedOnlyAfterTheCallEnds(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, err := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	if err := repo.End(ctx, callID); err != nil {
		t.Fatalf("End: %v", err)
	}

	e := find(t, mustHistory(t, repo, bob), callID)
	if e.Outcome != OutcomeMissed {
		t.Fatalf("outcome = %q, want %q", e.Outcome, OutcomeMissed)
	}
	if e.Running {
		t.Fatal("an ended call still reads as running")
	}

	// The caller's own view of the same call is not "missed" — they were in it.
	mine := find(t, mustHistory(t, repo, alice), callID)
	if mine.Outcome != OutcomeAnswered || !mine.Mine {
		t.Fatalf("caller's view: outcome=%q mine=%v, want answered/true", mine.Outcome, mine.Mine)
	}
}

// TestAnsweringIsRecordedOnce: a dropped connection and a rejoin must not
// rewrite when someone answered, or the duration grows backwards.
func TestAnsweringIsRecordedOnce(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, _ := repo.Start(ctx, chat, alice, "video", []uuid.UUID{alice, bob})

	if err := repo.Join(ctx, callID, bob); err != nil {
		t.Fatalf("Join: %v", err)
	}
	var first time.Time
	if err := pool.QueryRow(ctx,
		`SELECT joined_at FROM call_participants WHERE call_id=$1 AND user_id=$2`,
		callID, bob).Scan(&first); err != nil {
		t.Fatalf("read joined_at: %v", err)
	}

	if err := repo.Join(ctx, callID, bob); err != nil {
		t.Fatalf("re-Join: %v", err)
	}
	var second time.Time
	_ = pool.QueryRow(ctx,
		`SELECT joined_at FROM call_participants WHERE call_id=$1 AND user_id=$2`,
		callID, bob).Scan(&second)
	if !first.Equal(second) {
		t.Fatal("rejoining rewrote when they answered")
	}
}

// TestSecondCallerJoinsInsteadOfStartingARival: in a group, someone pressing
// call while a call is already happening should end up in that call.
func TestSecondCallerJoinsInsteadOfStartingARival(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob, carol := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob, carol)

	first, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob, carol})
	second, _, err := repo.Start(ctx, chat, bob, "voice", []uuid.UUID{alice, bob, carol})
	if err != nil {
		t.Fatalf("second Start: %v", err)
	}
	if first != second {
		t.Fatalf("two rival calls in one chat: %s and %s", first, second)
	}

	e := find(t, mustHistory(t, repo, bob), first)
	if e.Outcome != OutcomeAnswered {
		t.Fatalf("the second caller reads as %q, want answered", e.Outcome)
	}
}

// TestSweepClosesAbandonedCalls: the client cannot be trusted to report the
// end — whoever hangs up may close the app or lose signal. Without a sweep, a
// dead call stays "running" and the log offers to join an empty room.
func TestSweepClosesAbandonedCalls(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice := mkUser(t, pool)
	chat := mkChat(t, pool, alice)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice})

	if _, err := pool.Exec(ctx,
		`UPDATE calls SET started_at = NOW() - INTERVAL '5 hours' WHERE id = $1`, callID); err != nil {
		t.Fatalf("age the call: %v", err)
	}

	n, err := repo.SweepStale(ctx, 4*time.Hour)
	if err != nil {
		t.Fatalf("SweepStale: %v", err)
	}
	if n == 0 {
		t.Fatal("the sweep closed nothing")
	}
	if _, running, _ := repo.Running(ctx, chat); running {
		t.Fatal("an abandoned call is still offered as joinable")
	}
}

func mustHistory(t *testing.T, repo *HistoryRepo, user uuid.UUID) []Entry {
	t.Helper()
	list, err := repo.History(context.Background(), user, 20)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	return list
}

// TestInvitingSomeoneDoesNotGrowTheChat is the whole point of separating the
// room from the conversation.
//
// The room used to be named after the chat, so pulling someone into a call
// meant adding them to the chat — which is not what anyone means by "add to
// the call". They would gain access to the entire conversation.
func TestInvitingSomeoneDoesNotGrowTheChat(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob, carol := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob) // carol is deliberately not in it
	callID, _, err := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	before := participantCount(t, pool, chat)

	added, err := repo.Invite(ctx, callID, []uuid.UUID{carol})
	if err != nil {
		t.Fatalf("Invite: %v", err)
	}
	if len(added) != 1 || added[0] != carol {
		t.Fatalf("Invite reported %v, want carol alone", added)
	}

	if after := participantCount(t, pool, chat); after != before {
		t.Fatalf("the chat grew from %d to %d — inviting to a call must not add to the conversation",
			before, after)
	}

	// She can join the call she was invited to.
	if ok, _ := repo.MayJoin(ctx, callID, carol); !ok {
		t.Fatal("an invited person cannot join the call")
	}

	// And someone invited to nothing still cannot.
	dave := mkUser(t, pool)
	if ok, _ := repo.MayJoin(ctx, callID, dave); ok {
		t.Fatal("someone never invited can join the call")
	}
}

// TestInviteReportsOnlyRealAdditions: someone already in the call must not
// have their phone ring again.
func TestInviteReportsOnlyRealAdditions(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})

	added, err := repo.Invite(ctx, callID, []uuid.UUID{bob})
	if err != nil {
		t.Fatalf("Invite: %v", err)
	}
	if len(added) != 0 {
		t.Fatalf("inviting someone already in the call reported %d additions", len(added))
	}
}

func participantCount(t *testing.T, pool *pgxpool.Pool, chat uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_participants WHERE chat_id = $1`, chat).Scan(&n); err != nil {
		t.Fatalf("count participants: %v", err)
	}
	return n
}

// TestHangingUpEndsTheCall is the fault this file previously had no opinion
// about.
//
// Nothing ever called End. The client disconnected from the SFU and told the
// server nothing, so the only thing that ever closed a call was the four-hour
// sweep. In production, four real calls recorded durations of 242, 246, 248
// and 249 minutes; every one of them lasted seconds.
func TestHangingUpEndsTheCall(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	if err := repo.Join(ctx, callID, bob); err != nil {
		t.Fatalf("Join: %v", err)
	}

	// One of two leaving does not end anything — the other is still talking.
	ended, err := repo.Leave(ctx, callID, bob)
	if err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if ended {
		t.Fatal("one person leaving ended a call the other is still in")
	}
	if _, running, _ := repo.Running(ctx, chat); !running {
		t.Fatal("the call ended while someone was still in it")
	}

	// The last one out closes it.
	ended, err = repo.Leave(ctx, callID, alice)
	if err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if !ended {
		t.Fatal("the last person leaving did not end the call")
	}
	if _, running, _ := repo.Running(ctx, chat); running {
		t.Fatal("an empty call is still offered as joinable")
	}

	// And the duration is the call, not the sweep interval.
	e := find(t, mustHistory(t, repo, alice), callID)
	if e.Running {
		t.Fatal("an ended call still reads as running")
	}
	if e.DurationSec > 60 {
		t.Fatalf("duration = %ds for a call that lasted milliseconds", e.DurationSec)
	}
}

// TestUnansweredCallEndsWhenTheCallerGivesUp: nobody answered, so nobody but
// the caller is in the room. Their hang-up is the end of it.
func TestUnansweredCallEndsWhenTheCallerGivesUp(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})

	// Bob is the phone still ringing, and the only one worth telling.
	ringing, err := repo.Ringing(ctx, callID)
	if err != nil {
		t.Fatalf("Ringing: %v", err)
	}
	if len(ringing) != 1 || ringing[0] != bob {
		t.Fatalf("Ringing = %v, want [bob]", ringing)
	}

	ended, err := repo.Leave(ctx, callID, alice)
	if err != nil || !ended {
		t.Fatalf("Leave = %v,%v; the caller giving up must end an unanswered call", ended, err)
	}

	// And Bob's log says missed, not ringing.
	e := find(t, mustHistory(t, repo, bob), callID)
	if e.Outcome != OutcomeMissed {
		t.Fatalf("outcome = %q, want %q", e.Outcome, OutcomeMissed)
	}
}

// TestRejoiningKeepsTheCallAlive: leaving and coming back is common on a
// patchy connection. If left_at stayed set, the next person's hang-up would
// end a call this person is sitting in.
func TestRejoiningKeepsTheCallAlive(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	_ = repo.Join(ctx, callID, bob)

	if _, err := repo.Leave(ctx, callID, bob); err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if err := repo.Join(ctx, callID, bob); err != nil {
		t.Fatalf("re-Join: %v", err)
	}

	ended, err := repo.Leave(ctx, callID, alice)
	if err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if ended {
		t.Fatal("the call ended while the person who rejoined was still in it")
	}
}

// TestHangingUpTwiceIsNotAnError: the client sends this on its way out and
// cannot wait to see how it went, so it may well arrive twice.
func TestHangingUpTwiceIsNotAnError(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice := mkUser(t, pool)
	chat := mkChat(t, pool, alice)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice})

	first, err := repo.Leave(ctx, callID, alice)
	if err != nil || !first {
		t.Fatalf("first Leave = %v,%v", first, err)
	}
	second, err := repo.Leave(ctx, callID, alice)
	if err != nil {
		t.Fatalf("second Leave: %v", err)
	}
	if second {
		t.Fatal("hanging up twice reported ending the call twice — the other phones would be told twice")
	}
}

// TestModeOfTheRunningCall: someone pulled into a video call must be rung as
// video. They were rung as voice regardless of what was happening.
func TestModeOfTheRunningCall(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice := mkUser(t, pool)
	chat := mkChat(t, pool, alice)
	callID, _, _ := repo.Start(ctx, chat, alice, "video", []uuid.UUID{alice})

	mode, err := repo.ModeOf(ctx, callID)
	if err != nil {
		t.Fatalf("ModeOf: %v", err)
	}
	if mode != "video" {
		t.Fatalf("mode = %q, want video", mode)
	}
}

// TestGuestCannotRingTheWholeChat covers the one path the fake-only tests
// cannot reach: a guest is not in the chat, so `invited` requires a real
// guest list.
//
// Ringing was guarded by `ring` alone while starting a call was guarded by
// `ring && inChat`. Someone pulled into a one-to-one call could therefore make
// every member of a conversation they are not part of ring.
func TestGuestCannotRingTheWholeChat(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob, carol := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob) // carol is not in the conversation
	callID, _, err := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := repo.Invite(ctx, callID, []uuid.UUID{carol}); err != nil {
		t.Fatalf("Invite: %v", err)
	}

	ringer := &fakeRinger{}
	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{alice: true, bob: true}},
		fakeUsers{name: "Carol"},
		ringer,
		repo,
		nil,
	)

	// She may join — that is the whole point of the guest list.
	grant, err := svc.TokenFor(ctx, chat, carol, true, "voice")
	if err != nil {
		t.Fatalf("TokenFor(guest): %v", err)
	}
	if grant.Room != callID.String() {
		t.Fatalf("room = %q, want the call %s", grant.Room, callID)
	}

	// But asking to ring must do nothing: she is not in this conversation.
	if ringer.rang != 0 {
		t.Fatalf("a guest rang the chat %d times", ringer.rang)
	}
}

// TestGuestCanDeclineAndHangUp: the guest list is the permission for every
// verb, not just joining. Declining was gated on chat membership, so a guest
// whose phone was ringing could not say no.
func TestGuestCanDeclineAndHangUp(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()
	repo := NewHistoryRepo(pool)

	alice, bob, carol := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	callID, _, _ := repo.Start(ctx, chat, alice, "voice", []uuid.UUID{alice, bob})
	if _, err := repo.Invite(ctx, callID, []uuid.UUID{carol}); err != nil {
		t.Fatalf("Invite: %v", err)
	}

	if err := repo.Decline(ctx, callID, carol); err != nil {
		t.Fatalf("Decline: %v", err)
	}
	e := find(t, mustHistory(t, repo, carol), callID)
	if e.Outcome != OutcomeDeclined {
		t.Fatalf("outcome = %q, want %q", e.Outcome, OutcomeDeclined)
	}

	// And a guest who joined can hang up like anyone else.
	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{alice: true, bob: true}},
		fakeUsers{name: "Carol"},
		&fakeRinger{},
		repo,
		nil,
	)
	if err := repo.Join(ctx, callID, carol); err != nil {
		t.Fatalf("Join: %v", err)
	}
	if err := svc.Hangup(ctx, chat, carol); err != nil {
		t.Fatalf("Hangup(guest): %v", err)
	}

	// Someone with no part in the call cannot end other people's calls.
	dave := mkUser(t, pool)
	if err := svc.Hangup(ctx, chat, dave); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("Hangup(stranger) = %v, want ErrNotAllowed", err)
	}
	if _, running, _ := repo.Running(ctx, chat); !running {
		t.Fatal("a stranger ended the call")
	}
}

// TestBlockedPersonCannotRingYou is the gap blocking left wide open.
//
// The calls module asked one question — are you a participant — and never
// looked at blocking at all. Someone you blocked could still make your phone
// ring, and you could answer.
func TestBlockedPersonCannotRingYou(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)

	ringer := &fakeRinger{}
	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{alice: true, bob: true}},
		fakeUsers{name: "Bob"},
		ringer,
		NewHistoryRepo(pool),
		nil,
	).WithBlocks(testBlocks{pool: pool, peers: map[uuid.UUID][2]uuid.UUID{chat: {alice, bob}}})

	// Alice blocks Bob.
	if _, err := pool.Exec(ctx,
		`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, alice, bob); err != nil {
		t.Fatalf("block: %v", err)
	}

	// Bob cannot start the call.
	if _, err := svc.TokenFor(ctx, chat, bob, true, "voice"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("TokenFor(blocked caller) = %v, want ErrNotAllowed", err)
	}
	if ringer.rang != 0 {
		t.Fatalf("a blocked person rang the phone %d times", ringer.rang)
	}

	// And Alice cannot ring Bob either. The channel is shut, not one-way:
	// calling someone you blocked is not a thing to offer.
	if _, err := svc.TokenFor(ctx, chat, alice, true, "voice"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("TokenFor(blocker) = %v, want ErrNotAllowed", err)
	}
}

// TestBlockingDoesNotReachGroupCalls is the deliberate limit.
//
// A group is a place with other people in it. One member's decision about
// another is not a reason to keep them out of the room — the app shows who in
// it they blocked instead.
func TestBlockingDoesNotReachGroupCalls(t *testing.T) {
	pool := historyDB(t)
	ctx := context.Background()

	alice, bob, carol := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	group := mkChat(t, pool, alice, bob, carol)

	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{alice: true, bob: true, carol: true}},
		fakeUsers{name: "Bob"},
		&fakeRinger{},
		NewHistoryRepo(pool),
		nil,
		// No peer for a group: PeerOf fails, which is how the rule stays
		// one-to-one without the module having to know what a group is.
	).WithBlocks(testBlocks{pool: pool})

	if _, err := pool.Exec(ctx,
		`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, alice, bob); err != nil {
		t.Fatalf("block: %v", err)
	}

	if _, err := svc.TokenFor(ctx, group, bob, true, "voice"); err != nil {
		t.Fatalf("a blocked member cannot join a group call: %v", err)
	}
	if _, err := svc.TokenFor(ctx, group, alice, false, "voice"); err != nil {
		t.Fatalf("the blocker cannot join their own group call: %v", err)
	}
}

// testBlocks is the seam the calls module declares, backed by the real table.
type testBlocks struct {
	pool  *pgxpool.Pool
	peers map[uuid.UUID][2]uuid.UUID
}

func (b testBlocks) EitherWay(ctx context.Context, x, y uuid.UUID) (bool, error) {
	var exists bool
	err := b.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM blocks
		  WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))
	`, x, y).Scan(&exists)
	return exists, err
}

func (b testBlocks) PeerOf(_ context.Context, chatID, userID uuid.UUID) (uuid.UUID, error) {
	pair, ok := b.peers[chatID]
	if !ok {
		return uuid.Nil, errors.New("no peer")
	}
	if pair[0] == userID {
		return pair[1], nil
	}
	return pair[0], nil
}
