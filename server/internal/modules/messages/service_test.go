package messages

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/yo/server/internal/modules/blocks"
	"github.com/CreadorLanda/yo/server/internal/modules/users"
	"github.com/CreadorLanda/yo/server/internal/platform/postgres"
)

// testDB connects to a Postgres instance that already has the schema
// migrated (`make docker-up-local && make migrate-up`). Skips instead of
// failing when no test database is configured, so `go test ./...` stays
// DB-free in environments without Docker/Postgres.
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

// createTestUser inserts a minimal user row directly. The auth module's
// OTP/registration flow isn't relevant to the chat-status logic under test.
func createTestUser(t *testing.T, pool *pgxpool.Pool, username string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1)
		RETURNING id
	`, username).Scan(&id)
	if err != nil {
		t.Fatalf("create test user %q: %v", username, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func newTestService(pool *pgxpool.Pool) *Service {
	usersRepo := users.NewRepository(pool)
	return NewService(NewRepository(pool, ""), usersRepo, nil, nil).
		WithBlocks(blocks.NewRepo(pool))
}

// TestDirectChatFriendRequestFlow exercises the whole pending → accept
// lifecycle: a fresh direct chat is a "friend request" that caps the
// requester at one message until the recipient accepts, after which the
// conversation must be unlimited in both directions.
func TestDirectChatFriendRequestFlow(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if chat.Status != ChatStatusPending {
		t.Fatalf("status = %q, want %q", chat.Status, ChatStatusPending)
	}

	if _, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("hi")}); err != nil {
		t.Fatalf("first message while pending: %v", err)
	}
	if _, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("hi again")}); !errors.Is(err, ErrPendingChatLimit) {
		t.Fatalf("expected pending_chat_limit on second message, got %v", err)
	}

	// Creator cannot accept their own request.
	if _, err := svc.AcceptChat(ctx, chat.ID, alice); !errors.Is(err, ErrCannotAcceptOwn) {
		t.Fatalf("expected cannot_accept_own, got %v", err)
	}

	accepted, err := svc.AcceptChat(ctx, chat.ID, bob)
	if err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}
	if accepted.Status != ChatStatusActive {
		t.Fatalf("status after accept = %q, want %q", accepted.Status, ChatStatusActive)
	}

	// Regression guard: before the fix, the 1-message cap applied forever,
	// not just while pending — active chats must allow unlimited messages.
	for i := 0; i < 3; i++ {
		if _, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("after accept")}); err != nil {
			t.Fatalf("message %d from alice after accept: %v", i, err)
		}
	}
	if _, err := svc.SendMessage(ctx, chat.ID, bob, SendMessageRequest{Content: testDirectEnvelope("reply")}); err != nil {
		t.Fatalf("bob's reply after accept: %v", err)
	}
}

// TestBlockedChatRejectsMessages guards against the opposite regression:
// a blocked person must be rejected outright, not just capped at one message.
//
// The block is directional now and lives on the person, so the test blocks a
// person rather than setting a status on the conversation.
func TestBlockedChatRejectsMessages(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if err := blocks.NewRepo(pool).Block(ctx, bob, alice); err != nil {
		t.Fatalf("Block: %v", err)
	}
	if _, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("hello?")}); !errors.Is(err, ErrChatBlocked) {
		t.Fatalf("expected chat_blocked, got %v", err)
	}
}

// TestNonParticipantCannotAccessChat ensures accept/block/list/send
// reject callers who are not members (IDOR guard).
func TestNonParticipantCannotAccessChat(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])
	eve := createTestUser(t, pool, "eve_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}

	if _, err := svc.AcceptChat(ctx, chat.ID, eve); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("AcceptChat by non-participant: got %v", err)
	}
	if _, err := svc.SendMessage(ctx, chat.ID, eve, SendMessageRequest{Content: "nope"}); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("SendMessage by non-participant: got %v", err)
	}
	if _, err := svc.ListMessages(ctx, chat.ID, eve, 10, 0); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("ListMessages by non-participant: got %v", err)
	}
}

// TestListMessagesCarriesReceiptCounts locks in the tick state the sender
// sees after reopening a chat.
//
// The Message struct always had DeliveredTo/ReadBy fields, but no query ever
// populated them: they were serialized as zero on every history load, so a
// reloaded thread showed a single tick even for messages the peer had read.
// Only the live WebSocket receipt event moved the ticks, and that is gone the
// moment the screen unmounts.
func TestListMessagesCarriesReceiptCounts(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("read this")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	untouched, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("ignore this")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	find := func(msgs []Message, id int64) Message {
		t.Helper()
		for _, m := range msgs {
			if m.ID == id {
				return m
			}
		}
		t.Fatalf("message %d missing from history", id)
		return Message{}
	}

	// Nothing acknowledged yet: both must read as merely sent.
	msgs, err := svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if m := find(msgs, sent.ID); m.DeliveredTo != 0 || m.ReadBy != 0 {
		t.Fatalf("before any receipt: delivered=%d read=%d, want 0/0", m.DeliveredTo, m.ReadBy)
	}

	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptDelivered,
	}); err != nil {
		t.Fatalf("SetReceipts delivered: %v", err)
	}

	msgs, err = svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages after delivered: %v", err)
	}
	if m := find(msgs, sent.ID); m.DeliveredTo != 1 || m.ReadBy != 0 {
		t.Fatalf("after delivered: delivered=%d read=%d, want 1/0", m.DeliveredTo, m.ReadBy)
	}

	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("SetReceipts read: %v", err)
	}

	msgs, err = svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages after read: %v", err)
	}
	// DeliveredTo must still count the row now that it says 'read'. The
	// receipt is upserted in place, so a query that only matched the literal
	// 'delivered' status would drop this back to zero and flicker the ticks.
	if m := find(msgs, sent.ID); m.DeliveredTo != 1 || m.ReadBy != 1 {
		t.Fatalf("after read: delivered=%d read=%d, want 1/1", m.DeliveredTo, m.ReadBy)
	}
	// The untouched message must not inherit its neighbour's receipts.
	if m := find(msgs, untouched.ID); m.DeliveredTo != 0 || m.ReadBy != 0 {
		t.Fatalf("untouched message: delivered=%d read=%d, want 0/0", m.DeliveredTo, m.ReadBy)
	}
}

// TestVoteOnAnotherUsersPoll is the case that used to be impossible.
//
// Voting was implemented as an edit of the message carrying the poll, and
// editing is restricted to its author — so every vote on someone else's poll
// came back 403. Votes now live in their own table, which also keeps the
// message body opaque to the server.
func TestVoteOnAnotherUsersPoll(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	game, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{
		Content:     testDirectEnvelope(`{"kind":"game","game":"truth-or-dare"}`),
		MessageType: MsgGame,
	})
	if err != nil || game.MessageType != MsgGame {
		t.Fatalf("SendMessage(game): message=%+v err=%v", game, err)
	}

	// Alice posts the poll; the body stays opaque to the server.
	poll, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{
		Content:     testDirectEnvelope(`{"kind":"poll","question":"?","options":[{"id":"o0"},{"id":"o1"}]}`),
		MessageType: MsgPoll,
	})
	if err != nil {
		t.Fatalf("SendMessage(poll): %v", err)
	}

	// The regression: editing someone else's message must still be refused.
	if _, err := svc.EditMessage(ctx, chat.ID, bob, poll.ID, "hijacked"); !errors.Is(err, ErrNotSender) {
		t.Fatalf("non-owner edit error = %v, want %v", err, ErrNotSender)
	}

	// But voting must succeed.
	tally, err := svc.VotePoll(ctx, chat.ID, bob, poll.ID, []string{"o1"})
	if err != nil {
		t.Fatalf("bob voting on alice's poll: %v", err)
	}
	if tally.Counts["o1"] != 1 || len(tally.Mine) != 1 || tally.Mine[0] != "o1" {
		t.Fatalf("after bob votes: counts=%v mine=%v", tally.Counts, tally.Mine)
	}

	// Alice votes for the same option; the tally is shared, hers is separate.
	tally, err = svc.VotePoll(ctx, chat.ID, alice, poll.ID, []string{"o1"})
	if err != nil {
		t.Fatalf("alice voting: %v", err)
	}
	if tally.Counts["o1"] != 2 {
		t.Fatalf("both voted o1: counts=%v, want 2", tally.Counts)
	}

	// Changing a single-choice vote must replace, not accumulate.
	tally, err = svc.VotePoll(ctx, chat.ID, bob, poll.ID, []string{"o0"})
	if err != nil {
		t.Fatalf("bob changing vote: %v", err)
	}
	if tally.Counts["o0"] != 1 || tally.Counts["o1"] != 1 {
		t.Fatalf("after bob switches: counts=%v, want o0=1 o1=1", tally.Counts)
	}

	// Withdrawing leaves nothing behind.
	if _, err := svc.VotePoll(ctx, chat.ID, bob, poll.ID, nil); err != nil {
		t.Fatalf("bob withdrawing: %v", err)
	}

	// A history load must carry the tally: nothing in the body holds it.
	msgs, err := svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	var seen *Message
	for i := range msgs {
		if msgs[i].ID == poll.ID {
			seen = &msgs[i]
		}
	}
	if seen == nil {
		t.Fatal("poll missing from history")
	}
	if seen.PollVotes == nil {
		t.Fatal("poll came back with no tally — a reload would show zero votes")
	}
	if seen.PollVotes.Counts["o1"] != 1 || seen.PollVotes.Counts["o0"] != 0 {
		t.Fatalf("tally on reload: %v, want o1=1 and no o0", seen.PollVotes.Counts)
	}
	if len(seen.PollVotes.Mine) != 1 || seen.PollVotes.Mine[0] != "o1" {
		t.Fatalf("alice's own selection on reload: %v", seen.PollVotes.Mine)
	}

	// Non-participants cannot vote.
	eve := createTestUser(t, pool, "eve_"+uuid.NewString()[:8])
	if _, err := svc.VotePoll(ctx, chat.ID, eve, poll.ID, []string{"o0"}); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("outsider voting: got %v, want ErrNotParticipant", err)
	}
}

// TestForwardCountCannotBeLaundered is the rule that makes the label mean
// something.
//
// "Forwarded many times" is a warning, and a warning a sender can switch off
// by claiming a lower number is not a warning. The server always stores one
// more than the count it was handed.
func TestForwardCountCannotBeLaundered(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	count := func(id int64) int {
		t.Helper()
		msgs, err := svc.ListMessages(ctx, chat.ID, alice, 50, 0)
		if err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
		for _, m := range msgs {
			if m.ID == id {
				return m.ForwardCount
			}
		}
		t.Fatalf("message %d not found", id)
		return -1
	}

	// Written here, not forwarded.
	fresh, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("original")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if got := count(fresh.ID); got != 0 {
		t.Fatalf("a new message reported %d hops, want 0", got)
	}

	// Forwarding something that had already made one hop makes two.
	one := 1
	fwd, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{
		Content: testDirectEnvelope("passed along"), ForwardCount: &one,
	})
	if err != nil {
		t.Fatalf("SendMessage(forward): %v", err)
	}
	if got := count(fwd.ID); got != 2 {
		t.Fatalf("forwarding a 1-hop message gave %d, want 2", got)
	}

	// Zero means "the thing I am forwarding had made no hops" — a channel
	// post, say — so the result is one, not zero. Omitting the field is how
	// a message says it was written here.
	zero := 0
	firstHop, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{
		Content: testDirectEnvelope("from a channel"), ForwardCount: &zero,
	})
	if err != nil {
		t.Fatalf("SendMessage(zero): %v", err)
	}
	if got := count(firstHop.ID); got != 1 {
		t.Fatalf("forwarding a 0-hop source gave %d, want 1", got)
	}

	// A high count survives and keeps climbing — this is what drives the
	// "forwarded many times" label.
	many := 6
	heavy, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{
		Content: testDirectEnvelope("chain letter"), ForwardCount: &many,
	})
	if err != nil {
		t.Fatalf("SendMessage(many): %v", err)
	}
	if got := count(heavy.ID); got != 7 {
		t.Fatalf("forwarding a 6-hop message gave %d, want 7", got)
	}
}

// TestReadReceiptsAreReciprocal is the rule that makes the setting honest:
// turning yours off also stops you seeing anyone else's.
//
// A switch that only hides your own is a way to take without giving, and
// people would rightly stop trusting the tick.
func TestReadReceiptsAreReciprocal(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	usersRepo := users.NewRepository(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("olá")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	readBy := func(viewer uuid.UUID) int {
		t.Helper()
		msgs, err := svc.ListMessages(ctx, chat.ID, viewer, 50, 0)
		if err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
		for _, m := range msgs {
			if m.ID == sent.ID {
				return m.ReadBy
			}
		}
		t.Fatal("message missing")
		return -1
	}

	// With receipts on, a read is recorded and Alice sees it.
	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("SetReceipts: %v", err)
	}
	if got := readBy(alice); got != 1 {
		t.Fatalf("read not recorded: %d", got)
	}

	// Alice turns hers off. She stops seeing Bob's.
	off := false
	if _, err := usersRepo.Patch(ctx, alice, users.PatchRequest{ReadReceipts: &off}); err != nil {
		t.Fatalf("patch alice: %v", err)
	}
	if got := readBy(alice); got != 0 {
		t.Fatalf("alice still sees read receipts with hers off: %d", got)
	}
	// Bob, who kept his on, is unaffected.
	if got := readBy(bob); got != 1 {
		t.Fatalf("bob lost sight of a receipt he did not opt out of: %d", got)
	}

	// And Alice's own reads stop being recorded as reads.
	fromBob, err := svc.SendMessage(ctx, chat.ID, bob, SendMessageRequest{Content: testDirectEnvelope("e tu")})
	if err != nil {
		t.Fatalf("SendMessage(bob): %v", err)
	}
	if err := svc.SetReceipts(ctx, chat.ID, alice, ReceiptRequest{
		MessageIDs: []int64{fromBob.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("SetReceipts(alice): %v", err)
	}
	msgs, _ := svc.ListMessages(ctx, chat.ID, bob, 50, 0)
	for _, m := range msgs {
		if m.ID == fromBob.ID {
			if m.ReadBy != 0 {
				t.Fatalf("alice sent a read receipt with hers off: %d", m.ReadBy)
			}
			// Delivered still counts — knowing it arrived is not the same
			// as knowing it was read, and only the second is opted out of.
			if m.DeliveredTo != 1 {
				t.Fatalf("delivery was suppressed too: %d", m.DeliveredTo)
			}
		}
	}
}

// TestDisappearingStartsOnRead is the decision this feature turns on.
//
// A timer that starts at send can expire a message before it was ever seen,
// which is not privacy — it is loss. Starting at read makes the window mean
// the same thing for both people.
func TestDisappearingStartsOnRead(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	// Only the offered durations are accepted — a wrong value here destroys
	// messages sooner than agreed, so it is refused rather than clamped.
	if err := svc.SetDisappearing(ctx, chat.ID, alice, 12345); !errors.Is(err, ErrInvalidTTL) {
		t.Fatalf("odd duration: got %v, want ErrInvalidTTL", err)
	}
	if err := svc.SetDisappearing(ctx, chat.ID, alice, 3600); err != nil {
		t.Fatalf("SetDisappearing: %v", err)
	}

	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("efémera")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	expiry := func() *time.Time {
		t.Helper()
		msgs, err := svc.ListMessages(ctx, chat.ID, alice, 50, 0)
		if err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
		for _, m := range msgs {
			if m.ID == sent.ID {
				return m.ExpiresAt
			}
		}
		t.Fatal("message missing")
		return nil
	}

	// Sending does not start the clock.
	if got := expiry(); got != nil {
		t.Fatalf("clock started at send: %v", got)
	}

	// Delivered is not read, and does not start it either.
	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptDelivered,
	}); err != nil {
		t.Fatalf("SetReceipts(delivered): %v", err)
	}
	if got := expiry(); got != nil {
		t.Fatalf("delivery started the clock: %v", got)
	}

	// Reading does.
	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("SetReceipts(read): %v", err)
	}
	first := expiry()
	if first == nil {
		t.Fatal("reading did not start the clock")
	}
	if d := time.Until(*first); d < 55*time.Minute || d > 61*time.Minute {
		t.Fatalf("deadline is %v away, want about an hour", d)
	}

	// A second read must not push the deadline out — otherwise the last
	// person to open a group chat decides how long everyone keeps it.
	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("second read: %v", err)
	}
	if second := expiry(); second == nil || !second.Equal(*first) {
		t.Fatalf("deadline moved: %v then %v", first, second)
	}
}

// TestExpiredMessagesAreHiddenThenSwept: a past deadline stops being served
// immediately, and the row goes on the next sweep.
func TestExpiredMessagesAreHiddenThenSwept(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, _ := svc.CreateDirectChat(ctx, alice, bob)
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}
	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("ida")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	keep, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("fica")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	// Backdate one deadline rather than wait an hour.
	if _, err := pool.Exec(ctx,
		`UPDATE messages SET expires_at = NOW() - interval '1 minute' WHERE id = $1`,
		sent.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	msgs, err := svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	for _, m := range msgs {
		if m.ID == sent.ID {
			t.Fatal("an expired message was served before the sweep ran")
		}
	}

	n, err := svc.SweepExpired(ctx)
	if err != nil {
		t.Fatalf("SweepExpired: %v", err)
	}
	if n < 1 {
		t.Fatalf("sweep removed %d rows", n)
	}

	// The message without a deadline is untouched.
	msgs, _ = svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	var found bool
	for _, m := range msgs {
		if m.ID == keep.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("the sweep took a message that had no deadline")
	}
}

// TestDisappearingAnnouncesItself: changing the timer writes a notice into
// the conversation.
//
// The other person did not ask for the change and it governs everything they
// write afterwards — they find out in the thread or they do not find out.
func TestDisappearingAnnouncesItself(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, _ := svc.CreateDirectChat(ctx, alice, bob)
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	notices := func() []Message {
		t.Helper()
		msgs, err := svc.ListMessages(ctx, chat.ID, bob, 50, 0)
		if err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
		var out []Message
		for _, m := range msgs {
			if m.MessageType == MsgSystem {
				out = append(out, m)
			}
		}
		return out
	}

	if err := svc.SetDisappearing(ctx, chat.ID, alice, 3600); err != nil {
		t.Fatalf("SetDisappearing: %v", err)
	}
	got := notices()
	if len(got) != 1 {
		t.Fatalf("expected one notice, got %d", len(got))
	}
	// Machine-readable, so the client renders it in the reader's language
	// and names the actor from their own contacts.
	want := "disappearing:3600:" + alice.String()
	if got[0].Content != want {
		t.Fatalf("notice body = %q, want %q", got[0].Content, want)
	}
	if got[0].SenderID == nil || *got[0].SenderID != alice {
		t.Fatalf("notice attributed to %v, want %s", got[0].SenderID, alice)
	}

	// Setting the same value again is not an event, and must not fill the
	// thread with announcements of nothing happening.
	if err := svc.SetDisappearing(ctx, chat.ID, alice, 3600); err != nil {
		t.Fatalf("re-set: %v", err)
	}
	if n := len(notices()); n != 1 {
		t.Fatalf("a no-op change was announced: %d notices", n)
	}

	// The other side may turn off what the first turned on, and that is
	// announced too.
	if err := svc.SetDisappearing(ctx, chat.ID, bob, 0); err != nil {
		t.Fatalf("bob turning it off: %v", err)
	}
	got = notices()
	if len(got) != 2 {
		t.Fatalf("expected two notices, got %d", len(got))
	}
	// Checked by content rather than position: the list is newest-first, and
	// an index assumption here would only be testing the ordering.
	var foundOff bool
	for _, m := range got {
		if m.Content == "disappearing:0:"+bob.String() {
			foundOff = true
		}
	}
	if !foundOff {
		t.Fatalf("no notice for turning it off: %+v", got)
	}

	// And it only governs this conversation.
	other, _ := svc.CreateDirectChat(ctx, alice, createTestUser(t, pool, "carol_"+uuid.NewString()[:8]))
	sec, err := svc.repo.DisappearSeconds(ctx, other.ID)
	if err != nil {
		t.Fatalf("DisappearSeconds: %v", err)
	}
	if sec != 0 {
		t.Fatalf("another chat inherited the timer: %d", sec)
	}
}

// TestLimitedViewSurvivesReload is the whole point of a view-once message:
// that it is spent for good.
//
// It was not. The limit went into the database on send and no read path ever
// reported it — ListMessages did not select view_limit, so every history load
// rebuilt the message as unopened, and the client had nothing to render a
// spent one from. Opening it burned a view server-side that nobody could see.
func TestLimitedViewSurvivesReload(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	once := 1
	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{
		Content: testDirectEnvelope("for your eyes only"), ViewLimit: &once,
	})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	find := func(msgs []Message, id int64) Message {
		t.Helper()
		for _, m := range msgs {
			if m.ID == id {
				return m
			}
		}
		t.Fatalf("message %d missing from history", id)
		return Message{}
	}

	// Listing must describe the limit without spending it: a thread that
	// burns a view for every scroll past is a thread nobody can reread.
	msgs, err := svc.ListMessages(ctx, chat.ID, bob, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	m := find(msgs, sent.ID)
	if m.ViewLimit == nil || *m.ViewLimit != 1 {
		t.Fatalf("view_limit before opening: %v, want 1", m.ViewLimit)
	}
	if m.ViewsLeft == nil || *m.ViewsLeft != 1 {
		t.Fatalf("views_left before opening: %v, want 1", m.ViewsLeft)
	}

	if _, _, err := svc.OpenLimitedMessage(ctx, chat.ID, sent.ID, bob); err != nil {
		t.Fatalf("OpenLimitedMessage: %v", err)
	}

	// Reload: the state has to come back from the server, not from whatever
	// the client happened to remember.
	msgs, err = svc.ListMessages(ctx, chat.ID, bob, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages after open: %v", err)
	}
	if m := find(msgs, sent.ID); m.ViewsLeft == nil || *m.ViewsLeft != 0 {
		t.Fatalf("views_left after opening: %v, want 0", m.ViewsLeft)
	}

	if _, _, err := svc.OpenLimitedMessage(ctx, chat.ID, sent.ID, bob); !errors.Is(err, ErrViewsExhausted) {
		t.Fatalf("second open: got %v, want ErrViewsExhausted", err)
	}

	// Alice never opened it, so her own copy is untouched. Views are per
	// person: the sender's screen must not go blank because the recipient
	// looked.
	msgs, err = svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages as sender: %v", err)
	}
	if m := find(msgs, sent.ID); m.ViewsLeft == nil || *m.ViewsLeft != 1 {
		t.Fatalf("sender's views_left: %v, want 1", m.ViewsLeft)
	}
}

// TestReactionsSurviveReload is why reactions appeared to "not work".
//
// They were stored correctly and broadcast correctly, but no read path ever
// returned them: the client's map started empty on every chat open and only
// the live websocket event refilled it. React, leave, come back — gone.
func TestReactionsSurviveReload(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}
	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("olá")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	if _, err := svc.React(ctx, chat.ID, bob, sent.ID, "❤️", false); err != nil {
		t.Fatalf("AddReaction: %v", err)
	}

	// The reload. This is the path that was silent.
	msgs, err := svc.ListMessages(ctx, chat.ID, alice, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	var found *Message
	for i := range msgs {
		if msgs[i].ID == sent.ID {
			found = &msgs[i]
		}
	}
	if found == nil {
		t.Fatal("message missing from history")
	}
	if len(found.Reactions) != 1 {
		t.Fatalf("history returned %d reactions, want 1 — reopening the chat loses them",
			len(found.Reactions))
	}
	if found.Reactions[0].Emoji != "❤️" {
		t.Fatalf("emoji = %q, want ❤️", found.Reactions[0].Emoji)
	}
	if found.Reactions[0].UserID != bob {
		t.Fatalf("reaction attributed to %s, want bob", found.Reactions[0].UserID)
	}
}

// TestGhostModeIsReciprocal holds ghost mode to the same bargain read
// receipts have been on since 0029: with it on you neither send these
// signals nor see anyone else's.
//
// It is the wider switch — read receipts, typing and the recording indicator
// at once — so it has to imply the narrower one even for someone who left
// read_receipts on.
func TestGhostModeIsReciprocal(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	usersRepo := users.NewRepository(pool)

	alice := createTestUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_"+uuid.NewString()[:8])

	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}

	sent, err := svc.SendMessage(ctx, chat.ID, alice, SendMessageRequest{Content: testDirectEnvelope("olá")})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	readBy := func(viewer uuid.UUID, id int64) int {
		t.Helper()
		msgs, err := svc.ListMessages(ctx, chat.ID, viewer, 50, 0)
		if err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
		for _, m := range msgs {
			if m.ID == id {
				return m.ReadBy
			}
		}
		t.Fatal("message missing")
		return -1
	}

	if err := svc.SetReceipts(ctx, chat.ID, bob, ReceiptRequest{
		MessageIDs: []int64{sent.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("SetReceipts: %v", err)
	}
	if got := readBy(alice, sent.ID); got != 1 {
		t.Fatalf("read not recorded before ghost mode: %d", got)
	}

	// Alice goes ghost. Note she never touched read_receipts — the wider
	// switch has to cover the narrower one on its own.
	on := true
	if _, err := usersRepo.Patch(ctx, alice, users.PatchRequest{GhostMode: &on}); err != nil {
		t.Fatalf("patch alice: %v", err)
	}

	if got := readBy(alice, sent.ID); got != 0 {
		t.Fatalf("ghost alice still sees read receipts: %d", got)
	}
	if got := readBy(bob, sent.ID); got != 1 {
		t.Fatalf("bob lost a receipt he did not opt out of: %d", got)
	}

	// And her own reads stop being recorded as reads.
	fromBob, err := svc.SendMessage(ctx, chat.ID, bob, SendMessageRequest{Content: testDirectEnvelope("e tu")})
	if err != nil {
		t.Fatalf("SendMessage(bob): %v", err)
	}
	if err := svc.SetReceipts(ctx, chat.ID, alice, ReceiptRequest{
		MessageIDs: []int64{fromBob.ID}, Status: ReceiptRead,
	}); err != nil {
		t.Fatalf("SetReceipts(alice): %v", err)
	}
	if got := readBy(bob, fromBob.ID); got != 0 {
		t.Fatalf("ghost alice sent a read receipt: %d", got)
	}

	// Typing is refused outright rather than broadcast to nobody, and a
	// ghost is not among the recipients of anyone else's.
	if err := svc.Typing(ctx, chat.ID, alice, true, "typing"); err != nil {
		t.Fatalf("Typing(ghost alice): %v", err)
	}
	ids, err := svc.repo.NonGhostParticipantIDs(ctx, chat.ID)
	if err != nil {
		t.Fatalf("NonGhostParticipantIDs: %v", err)
	}
	for _, id := range ids {
		if id == alice {
			t.Fatal("ghost alice would still be delivered a typing indicator")
		}
	}
	if len(ids) != 1 || ids[0] != bob {
		t.Fatalf("typing recipients wrong: %v", ids)
	}
}
