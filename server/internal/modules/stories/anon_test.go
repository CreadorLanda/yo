package stories

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestAnonChannelNeverNamesEitherParty is the whole point of the feature.
//
// Everything else here is convenience; this is the promise. The check is
// deliberately done on the serialised JSON rather than on struct fields,
// because the leak that matters is the one that reaches the wire — a field
// added later without a second thought would slip past a field-by-field
// assertion.
func TestAnonChannelNeverNamesEitherParty(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "sender_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "anónimo", IsAnonymous: true, Visibility: VisPublic,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := svc.WriteAnon(ctx, story.ID, sender, "quem és tu?"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}

	threads, err := svc.AnonInbox(ctx, author)
	if err != nil {
		t.Fatalf("AnonInbox: %v", err)
	}
	if len(threads) != 1 {
		t.Fatalf("expected one thread, got %d", len(threads))
	}
	thread := threads[0]

	msgs, err := svc.AnonMessages(ctx, thread.ID, author)
	if err != nil {
		t.Fatalf("AnonMessages: %v", err)
	}

	// Neither id may appear anywhere in what goes over the wire.
	payload := mustJSON(t, threads) + mustJSON(t, msgs)
	for _, id := range []uuid.UUID{author, sender} {
		if strings.Contains(payload, id.String()) {
			t.Fatalf("a participant id reached the response: %s\n%s", id, payload)
		}
	}
	for _, field := range []string{"author_id", "sender_id", "username", "avatar"} {
		if strings.Contains(payload, field) {
			t.Fatalf("identifying field %q present in the response:\n%s", field, payload)
		}
	}

	// The author can tell which side wrote what, without knowing who.
	if len(msgs) != 1 || msgs[0].FromAuthor {
		t.Fatalf("expected one inbound message, got %+v", msgs)
	}
}

func TestAnonSenderCannotReachOwnStory(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)
	author := createUser(t, pool, "self_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.WriteAnon(ctx, story.ID, author, "olá eu"); !errors.Is(err, ErrOwnStory) {
		t.Fatalf("writing to own story: got %v, want ErrOwnStory", err)
	}
}

// TestAnonBlockIsSilent guards the moderation behaviour: a blocked sender is
// not told. Telling them hands back the feedback that makes evading a block
// a game worth playing.
func TestAnonBlockIsSilent(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "pest_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.WriteAnon(ctx, story.ID, sender, "primeira"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}

	threads, _ := svc.AnonInbox(ctx, author)
	if len(threads) != 1 {
		t.Fatalf("expected one thread, got %d", len(threads))
	}
	threadID := threads[0].ID

	if err := svc.BlockAnon(ctx, threadID, author); err != nil {
		t.Fatalf("BlockAnon: %v", err)
	}

	// The sender's next message must look like it worked.
	if err := svc.WriteAnon(ctx, story.ID, sender, "segunda"); err != nil {
		t.Fatalf("blocked sender got an error, which tells them: %v", err)
	}

	// But it must not be stored, and the thread must leave the inbox.
	msgs, err := svc.AnonMessages(ctx, threadID, author)
	if err != nil {
		t.Fatalf("AnonMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("blocked message was delivered anyway: %d messages", len(msgs))
	}
	after, _ := svc.AnonInbox(ctx, author)
	if len(after) != 0 {
		t.Fatalf("blocked thread still in the inbox: %d", len(after))
	}

	// A non-author cannot block.
	other := createUser(t, pool, "other_"+uuid.NewString()[:8])
	if err := svc.BlockAnon(ctx, threadID, other); !errors.Is(err, ErrThreadNotFound) {
		t.Fatalf("outsider blocking: got %v, want ErrThreadNotFound", err)
	}
}

func TestAnonRateLimit(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "flood_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	for i := 0; i < anonMaxPerWindow; i++ {
		if err := svc.WriteAnon(ctx, story.ID, sender, "spam"); err != nil {
			t.Fatalf("message %d within the cap: %v", i, err)
		}
	}
	if err := svc.WriteAnon(ctx, story.ID, sender, "mais um"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("past the cap: got %v, want ErrRateLimited", err)
	}

	// A different person is unaffected by someone else's flooding.
	fresh := createUser(t, pool, "fresh_"+uuid.NewString()[:8])
	if err := svc.WriteAnon(ctx, story.ID, fresh, "olá"); err != nil {
		t.Fatalf("unrelated sender was rate limited: %v", err)
	}

	// One thread per person, no matter how many messages.
	threads, _ := svc.AnonInbox(ctx, author)
	if len(threads) != 2 {
		t.Fatalf("expected one thread per sender, got %d", len(threads))
	}
}

// TestAnonRevealNeedsBothSides: one side willing is not enough.
func TestAnonRevealNeedsBothSides(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "sender_"+uuid.NewString()[:8])

	story, _ := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err := svc.WriteAnon(ctx, story.ID, sender, "olá"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}
	threads, _ := svc.AnonInbox(ctx, author)
	threadID := threads[0].ID

	if _, err := svc.RevealAnon(ctx, threadID, author); err != nil {
		t.Fatalf("RevealAnon(author): %v", err)
	}
	threads, _ = svc.AnonInbox(ctx, author)
	if !threads[0].AuthorRevealed || threads[0].SenderRevealed {
		t.Fatalf("revealing one side set the other: %+v", threads[0])
	}

	if _, err := svc.RevealAnon(ctx, threadID, sender); err != nil {
		t.Fatalf("RevealAnon(sender): %v", err)
	}
	threads, _ = svc.AnonInbox(ctx, author)
	if !threads[0].AuthorRevealed || !threads[0].SenderRevealed {
		t.Fatalf("both revealed, but flags say otherwise: %+v", threads[0])
	}

	// An outsider cannot reveal anyone.
	other := createUser(t, pool, "other_"+uuid.NewString()[:8])
	if _, err := svc.RevealAnon(ctx, threadID, other); !errors.Is(err, ErrThreadNotFound) {
		t.Fatalf("outsider revealing: got %v, want ErrThreadNotFound", err)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// TestAnonInboxServesBothSides: whoever wrote in must be able to read the
// reply, or the channel only works one way.
//
// It also pins the asymmetry a block creates: the thread leaves the author's
// list and stays in the sender's, because removing it there would tell them
// they were blocked.
func TestAnonInboxServesBothSides(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "sender_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "x", IsAnonymous: true, Visibility: VisPublic,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.WriteAnon(ctx, story.ID, sender, "olá"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}

	// Both sides see the thread, each labelled with their own role.
	mine, err := svc.AnonInbox(ctx, author)
	if err != nil {
		t.Fatalf("AnonInbox(author): %v", err)
	}
	if len(mine) != 1 || mine[0].Role != AnonRoleAuthor {
		t.Fatalf("author's listing: %+v", mine)
	}
	theirs, err := svc.AnonInbox(ctx, sender)
	if err != nil {
		t.Fatalf("AnonInbox(sender): %v", err)
	}
	if len(theirs) != 1 || theirs[0].Role != AnonRoleSender {
		t.Fatalf("sender's listing: %+v", theirs)
	}
	threadID := mine[0].ID

	// The role must not leak the other party.
	payload := mustJSON(t, mine) + mustJSON(t, theirs)
	for _, id := range []uuid.UUID{author, sender} {
		if strings.Contains(payload, id.String()) {
			t.Fatalf("listing leaked a participant id: %s", id)
		}
	}

	// The author replies; the sender can read it.
	if _, err := svc.ReplyAnon(ctx, threadID, author, "obrigado"); err != nil {
		t.Fatalf("ReplyAnon: %v", err)
	}
	msgs, err := svc.AnonMessages(ctx, threadID, sender)
	if err != nil {
		t.Fatalf("sender reading the thread: %v", err)
	}
	if len(msgs) != 2 || !msgs[1].FromAuthor || msgs[1].Body != "obrigado" {
		t.Fatalf("reply not visible to the sender: %+v", msgs)
	}

	// Unread counts each side's inbound only.
	theirs, _ = svc.AnonInbox(ctx, sender)
	if theirs[0].Unread != 1 {
		t.Fatalf("sender should have 1 inbound, got %d", theirs[0].Unread)
	}

	// After a block: gone for the author, still there for the sender.
	if err := svc.BlockAnon(ctx, threadID, author); err != nil {
		t.Fatalf("BlockAnon: %v", err)
	}
	mine, _ = svc.AnonInbox(ctx, author)
	if len(mine) != 0 {
		t.Fatalf("blocked thread still in the author's list: %d", len(mine))
	}
	theirs, _ = svc.AnonInbox(ctx, sender)
	if len(theirs) != 1 {
		t.Fatalf("blocked thread vanished for the sender, which tells them: %d", len(theirs))
	}
}

// TestAnonThreadCarriesStoryContext: the inbox needs to say which story a
// thread is about, and must do it without naming the story's author.
//
// The author is the exact thing at stake — an anonymous story whose inbox
// names its own author to the sender would give the game away from the one
// place built to protect it.
func TestAnonThreadCarriesStoryContext(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "sender_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "a minha pergunta", IsAnonymous: true, Visibility: VisPublic,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.WriteAnon(ctx, story.ID, sender, "olá"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}

	for _, who := range []struct {
		name string
		id   uuid.UUID
	}{{"author", author}, {"sender", sender}} {
		list, err := svc.AnonInbox(ctx, who.id)
		if err != nil {
			t.Fatalf("AnonInbox(%s): %v", who.name, err)
		}
		if len(list) != 1 {
			t.Fatalf("%s: expected one thread, got %d", who.name, len(list))
		}
		th := list[0]
		if th.StoryCaption != "a minha pergunta" {
			t.Fatalf("%s: caption missing: %q", who.name, th.StoryCaption)
		}
		if th.StoryKind != string(KindText) {
			t.Fatalf("%s: kind missing: %q", who.name, th.StoryKind)
		}
		if th.StoryExpired {
			t.Fatalf("%s: a live story reported as expired", who.name)
		}
		// And still no identities.
		payload := mustJSON(t, list)
		for _, id := range []uuid.UUID{author, sender} {
			if strings.Contains(payload, id.String()) {
				t.Fatalf("%s: story context leaked a participant id", who.name)
			}
		}
		if strings.Contains(payload, "author_name") || strings.Contains(payload, "author_username") {
			t.Fatalf("%s: story context carried an author field:\n%s", who.name, payload)
		}
	}
}

// fakeOpener stands in for the messages module. Records the pair it was
// asked about so the test can check who ended up in the chat.
type fakeOpener struct {
	chatID uuid.UUID
	a, b   uuid.UUID
	calls  int
	fail   error
}

func (f *fakeOpener) OpenDirectChat(_ context.Context, a, b uuid.UUID) (uuid.UUID, error) {
	f.calls++
	if f.fail != nil {
		return uuid.Nil, f.fail
	}
	f.a, f.b = a, b
	return f.chatID, nil
}

// TestAnonThreadGraduates covers the moment a blind thread becomes a real
// conversation, and the deliberate loss that comes with it.
func TestAnonThreadGraduates(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	opener := &fakeOpener{chatID: uuid.New()}
	svc := NewService(NewRepository(pool), opener)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "sender_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "x", IsAnonymous: true, Visibility: VisPublic,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.WriteAnon(ctx, story.ID, sender, "olá"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}
	threads, _ := svc.AnonInbox(ctx, author)
	threadID := threads[0].ID

	// One side agreeing changes nothing outward.
	chatID, err := svc.RevealAnon(ctx, threadID, author)
	if err != nil {
		t.Fatalf("RevealAnon(author): %v", err)
	}
	if chatID != uuid.Nil {
		t.Fatalf("graduated on one agreement: %s", chatID)
	}
	if opener.calls != 0 {
		t.Fatalf("a chat was opened too early: %d calls", opener.calls)
	}
	if list, _ := svc.AnonInbox(ctx, author); len(list) != 1 {
		t.Fatal("the thread vanished before both agreed")
	}

	// The second agreement graduates it.
	chatID, err = svc.RevealAnon(ctx, threadID, sender)
	if err != nil {
		t.Fatalf("RevealAnon(sender): %v", err)
	}
	if chatID != opener.chatID {
		t.Fatalf("chat id not returned: got %s, want %s", chatID, opener.chatID)
	}
	if opener.calls != 1 {
		t.Fatalf("expected one open, got %d", opener.calls)
	}
	if !((opener.a == author && opener.b == sender) || (opener.a == sender && opener.b == author)) {
		t.Fatalf("wrong pair sent to the chat opener: %s / %s", opener.a, opener.b)
	}

	// The blind thread is gone for both sides, messages included.
	for _, who := range []uuid.UUID{author, sender} {
		if list, _ := svc.AnonInbox(ctx, who); len(list) != 0 {
			t.Fatalf("thread still listed for %s", who)
		}
	}
	if _, err := svc.AnonMessages(ctx, threadID, author); !errors.Is(err, ErrThreadNotFound) {
		t.Fatalf("messages survived: %v", err)
	}
	var left int
	pool.QueryRow(ctx, `SELECT count(*) FROM story_anon_messages WHERE thread_id = $1`,
		threadID).Scan(&left)
	if left != 0 {
		t.Fatalf("%d messages left behind", left)
	}
}

// TestAnonGraduationKeepsThreadWhenChatFails: a failed chat open must not
// take the conversation with it. Losing both would leave two people who just
// agreed to meet with nothing at all.
func TestAnonGraduationKeepsThreadWhenChatFails(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	opener := &fakeOpener{fail: errors.New("boom")}
	svc := NewService(NewRepository(pool), opener)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	sender := createUser(t, pool, "sender_"+uuid.NewString()[:8])

	story, _ := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err := svc.WriteAnon(ctx, story.ID, sender, "olá"); err != nil {
		t.Fatalf("WriteAnon: %v", err)
	}
	threads, _ := svc.AnonInbox(ctx, author)
	threadID := threads[0].ID

	if _, err := svc.RevealAnon(ctx, threadID, author); err != nil {
		t.Fatalf("RevealAnon(author): %v", err)
	}
	if _, err := svc.RevealAnon(ctx, threadID, sender); err == nil {
		t.Fatal("expected the chat failure to surface")
	}

	msgs, err := svc.AnonMessages(ctx, threadID, author)
	if err != nil {
		t.Fatalf("thread destroyed despite the failure: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected the message to survive, got %d", len(msgs))
	}
}
