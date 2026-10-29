package calls

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/livekit/protocol/auth"
)

type fakeChats struct {
	members map[uuid.UUID]bool
	err     error
}

func (f fakeChats) IsParticipant(_ context.Context, _, userID uuid.UUID) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.members[userID], nil
}

func (f fakeChats) MemberIDs(context.Context, uuid.UUID) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(f.members))
	for id := range f.members {
		out = append(out, id)
	}
	return out, nil
}

type fakeRinger struct{ rang, rangUsers, stopped int }

func (f *fakeRinger) Ring(context.Context, uuid.UUID, uuid.UUID, string, string) { f.rang++ }

func (f *fakeRinger) RingUsers(context.Context, uuid.UUID, []uuid.UUID, string, string) {
	f.rangUsers++
}

func (f *fakeRinger) Stopped(context.Context, uuid.UUID, []uuid.UUID) { f.stopped++ }

type fakeUsers struct{ name string }

func (f fakeUsers) DisplayName(context.Context, uuid.UUID) (string, error) {
	return f.name, nil
}

type fakePrivacy struct {
	allowed bool
}

func (f fakePrivacy) CanCall(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return f.allowed, nil
}

const (
	testKey    = "devkey"
	testSecret = "a-secret-long-enough-to-sign-with"
)

func newTestService(members ...uuid.UUID) (*Service, fakeChats) {
	set := map[uuid.UUID]bool{}
	for _, m := range members {
		set[m] = true
	}
	chats := fakeChats{members: set}
	return NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		chats,
		fakeUsers{name: "Alice"},
		&fakeRinger{},
		nil,
		nil,
	), chats
}

// TestOnlyParticipantsGetTokens is the whole security model of this module.
//
// Rooms are named after the chat id, so anyone who can guess or obtain a chat
// id knows a room name. This check is the only thing between that id and
// someone else's call.
func TestOnlyParticipantsGetTokens(t *testing.T) {
	alice, eve := uuid.New(), uuid.New()
	chat := uuid.New()
	svc, _ := newTestService(alice)

	grant, err := svc.TokenFor(context.Background(), chat, alice, false, "voice")
	if err != nil {
		t.Fatalf("TokenFor(participant): %v", err)
	}
	if grant.Token == "" || grant.Room != chat.String() {
		t.Fatalf("bad grant: %+v", grant)
	}

	if _, err := svc.TokenFor(context.Background(), chat, eve, false, "voice"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("TokenFor(outsider) = %v, want ErrNotAllowed", err)
	}
}

func TestPrivacyBlocksCallTokenBeforeRing(t *testing.T) {
	alice := uuid.New()
	ringer := &fakeRinger{}
	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{alice: true}},
		fakeUsers{name: "Alice"},
		ringer,
		nil,
		nil,
	).WithPrivacy(fakePrivacy{allowed: false})

	if _, err := svc.TokenFor(context.Background(), uuid.New(), alice, true, "voice"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("restricted call token = %v, want ErrNotAllowed", err)
	}
	if ringer.rang != 0 {
		t.Fatalf("restricted call rang %d times, want 0", ringer.rang)
	}
}

// TestTokenGrantsOneRoomOnly: a token must not be a key to the building.
func TestTokenGrantsOneRoomOnly(t *testing.T) {
	alice := uuid.New()
	chat := uuid.New()
	svc, _ := newTestService(alice)

	grant, err := svc.TokenFor(context.Background(), chat, alice, false, "voice")
	if err != nil {
		t.Fatalf("TokenFor: %v", err)
	}

	verifier, err := auth.ParseAPIToken(grant.Token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	_, claims, err := verifier.Verify(testSecret)
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}

	if claims.Identity != alice.String() {
		t.Fatalf("identity = %q, want %s", claims.Identity, alice)
	}
	v := claims.Video
	if v.Room != chat.String() {
		t.Fatalf("room = %q, want %s", v.Room, chat)
	}
	if !v.RoomJoin {
		t.Fatal("token does not grant joining the room it names")
	}
	// Administration must stay on the server. A participant who could create
	// rooms or evict others would be an admin of every call they join.
	if v.RoomAdmin || v.RoomCreate || v.RoomList {
		t.Fatalf("token carries admin rights: admin=%v create=%v list=%v",
			v.RoomAdmin, v.RoomCreate, v.RoomList)
	}
}

// TestDisabledWithoutConfig: no SFU means no token. Handing one out anyway
// would look like a working call until the moment it failed to connect.
func TestDisabledWithoutConfig(t *testing.T) {
	alice := uuid.New()
	svc := NewService(Config{}, fakeChats{members: map[uuid.UUID]bool{alice: true}}, fakeUsers{}, &fakeRinger{}, nil, nil)

	if _, err := svc.TokenFor(context.Background(), uuid.New(), alice, false, "voice"); !errors.Is(err, ErrCallsDisabled) {
		t.Fatalf("TokenFor without config = %v, want ErrCallsDisabled", err)
	}

	// Partial configuration counts as disabled — a URL with no signing key
	// produces tokens the SFU rejects.
	partial := NewService(
		Config{URL: "wss://calls.example"},
		fakeChats{members: map[uuid.UUID]bool{alice: true}},
		fakeUsers{},
		&fakeRinger{},
		nil,
		nil,
	)
	if _, err := partial.TokenFor(context.Background(), uuid.New(), alice, false, "voice"); !errors.Is(err, ErrCallsDisabled) {
		t.Fatalf("TokenFor with partial config = %v, want ErrCallsDisabled", err)
	}
}

// TestTokenExpires: the token is fetched just before joining, so it has no
// reason to outlive that. A long-lived one sits in every log the request
// touched, still valid.
func TestTokenExpires(t *testing.T) {
	alice := uuid.New()
	svc, _ := newTestService(alice)

	chat := uuid.New()
	g, err := svc.TokenFor(context.Background(), chat, alice, false, "voice")
	if err != nil {
		t.Fatalf("TokenFor: %v", err)
	}
	if TokenTTL > 15*time.Minute {
		t.Fatalf("TokenTTL is %v — too long for a join credential", TokenTTL)
	}
	if g.ExpiresAt.IsZero() {
		t.Fatal("grant does not tell the client when its token dies")
	}
}

// TestOnlyTheCallerRings: both sides fetch a token — the caller to start and
// the callee to answer. Ringing on every token request would make the phone
// ring in the hand of the person picking it up.
func TestOnlyTheCallerRings(t *testing.T) {
	alice := uuid.New()
	chat := uuid.New()
	ringer := &fakeRinger{}
	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{alice: true}},
		fakeUsers{name: "Alice"},
		ringer,
		nil,
		nil,
	)

	if _, err := svc.TokenFor(context.Background(), chat, alice, false, "voice"); err != nil {
		t.Fatalf("answering: %v", err)
	}
	if ringer.rang != 0 {
		t.Fatalf("answering rang %d times, want 0", ringer.rang)
	}

	if _, err := svc.TokenFor(context.Background(), chat, alice, true, "video"); err != nil {
		t.Fatalf("calling: %v", err)
	}
	if ringer.rang != 1 {
		t.Fatalf("calling rang %d times, want 1", ringer.rang)
	}
}

// A refused caller must not ring anyone. Otherwise a guessed chat id becomes
// a way to make a stranger's phone ring.
func TestRefusedCallerDoesNotRing(t *testing.T) {
	eve := uuid.New()
	ringer := &fakeRinger{}
	svc := NewService(
		Config{URL: "wss://calls.example", APIKey: testKey, APISecret: testSecret},
		fakeChats{members: map[uuid.UUID]bool{}},
		fakeUsers{name: "Eve"},
		ringer,
		nil,
		nil,
	)
	if _, err := svc.TokenFor(context.Background(), uuid.New(), eve, true, "voice"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("got %v, want ErrNotAllowed", err)
	}
	if ringer.rang != 0 {
		t.Fatal("a refused caller made someone's phone ring")
	}
}
