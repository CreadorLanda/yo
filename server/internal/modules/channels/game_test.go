package channels

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

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
