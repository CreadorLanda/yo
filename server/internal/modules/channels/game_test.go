package channels

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type recordingBroadcaster struct {
	users   []uuid.UUID
	typ     string
	chatID  string
	payload any
}

func (r *recordingBroadcaster) PublishJSON(users []uuid.UUID, typ, chatID string, payload any) {
	r.users = append([]uuid.UUID(nil), users...)
	r.typ, r.chatID, r.payload = typ, chatID, payload
}

func TestGamePostBroadcastsOnlyAfterPersistence(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	broadcast := &recordingBroadcaster{}
	svc := NewService(NewRepository(pool)).WithBroadcaster(broadcast)
	owner := createUser(t, pool, "broadcast_owner_"+uuid.NewString()[:8])
	viewer := createUser(t, pool, "broadcast_viewer_"+uuid.NewString()[:8])
	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Broadcast channel", Handle: "broadcast_" + uuid.NewString()[:8], WhoCanPost: PostAdmins,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	join(t, svc, ch.ID, viewer)
	payload, _ := json.Marshal(map[string]any{
		"kind": "game", "game": "truth-or-dare", "action": "start",
		"seed": "stable-seed", "maxRounds": 5, "playerId": owner.String(),
	})
	post, err := svc.CreatePost(ctx, ch.ID, owner, CreatePostRequest{PostType: PostGame, GamePayload: payload})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	if broadcast.typ != "channel.post.new" || broadcast.chatID != ch.ID.String() {
		t.Fatalf("unexpected event: type=%q channel=%q", broadcast.typ, broadcast.chatID)
	}
	hasOwner, hasViewer := false, false
	for _, id := range broadcast.users {
		hasOwner = hasOwner || id == owner
		hasViewer = hasViewer || id == viewer
	}
	if len(broadcast.users) != 2 || !hasOwner || !hasViewer {
		t.Fatalf("event audience does not include owner and viewer: %+v", broadcast.users)
	}
	eventPost, ok := broadcast.payload.(Post)
	if !ok || eventPost.ID != post.ID || eventPost.PostType != PostGame {
		t.Fatalf("event payload was not the persisted post: %#v", broadcast.payload)
	}
}

func TestGamePostsAreImmutable(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))
	owner := createUser(t, pool, "immutable_owner_"+uuid.NewString()[:8])
	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Immutable games", Handle: "immutable_" + uuid.NewString()[:8], WhoCanPost: PostAdmins,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	payload, _ := json.Marshal(map[string]any{
		"kind": "game", "game": "truth-or-dare", "action": "start",
		"seed": "immutable-seed", "maxRounds": 5, "playerId": owner.String(),
	})
	post, err := svc.CreatePost(ctx, ch.ID, owner, CreatePostRequest{PostType: PostGame, GamePayload: payload})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	if err := svc.EditPost(ctx, post.ID, owner, "changed"); !errors.Is(err, ErrImmutableGame) {
		t.Fatalf("EditPost: got %v, want ErrImmutableGame", err)
	}
	if err := svc.DeletePost(ctx, post.ID, owner); !errors.Is(err, ErrImmutableGame) {
		t.Fatalf("DeletePost: got %v, want ErrImmutableGame", err)
	}
}

func TestGamePostUsesChannelPostPermission(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))
	owner := createUser(t, pool, "game_owner_"+uuid.NewString()[:8])
	member := createUser(t, pool, "game_member_"+uuid.NewString()[:8])
	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Game channel", Handle: "game_" + uuid.NewString()[:8], WhoCanPost: PostAdmins,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	join(t, svc, ch.ID, member)

	start := func(user uuid.UUID) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{
			"kind": "game", "game": "truth-or-dare", "action": "start",
			"seed": "channel-seed", "maxRounds": 5, "playerId": user.String(),
		})
		return raw
	}
	if _, err := svc.CreatePost(ctx, ch.ID, member, CreatePostRequest{
		PostType: PostGame, GamePayload: start(member),
	}); !errors.Is(err, ErrCannotPost) {
		t.Fatalf("member game post: got %v, want ErrCannotPost", err)
	}
	post, err := svc.CreatePost(ctx, ch.ID, owner, CreatePostRequest{
		PostType: PostGame, GamePayload: start(owner),
	})
	if err != nil {
		t.Fatalf("owner game post: %v", err)
	}
	if len(post.GamePayload) == 0 || post.PostType != PostGame {
		t.Fatalf("game payload was not persisted: %+v", post)
	}
}

func TestValidateGamePayloadAttributionAndShape(t *testing.T) {
	user := uuid.New()
	valid := func(v any) json.RawMessage {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}

	tests := []struct {
		name    string
		payload json.RawMessage
		wantErr bool
	}{
		{
			name: "start is attributable",
			payload: valid(map[string]any{
				"kind": "game", "game": "truth-or-dare", "action": "start",
				"seed": "seed", "maxRounds": 5, "playerId": user.String(),
			}),
		},
		{
			name: "turn cannot be forged for another player",
			payload: valid(map[string]any{
				"kind": "game", "game": "truth-or-dare", "action": "done",
				"playerId": uuid.New().String(),
			}),
			wantErr: true,
		},
		{
			name: "unknown action is rejected",
			payload: valid(map[string]any{
				"kind": "game", "game": "truth-or-dare", "action": "roll",
				"playerId": user.String(),
			}),
			wantErr: true,
		},
		{
			name: "invalid round count is rejected",
			payload: valid(map[string]any{
				"kind": "game", "game": "truth-or-dare", "action": "start",
				"seed": "seed", "maxRounds": 99, "playerId": user.String(),
			}),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateGamePayload(tt.payload, user)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateGamePayload() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
