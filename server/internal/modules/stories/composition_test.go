package stories

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestValidatePollCaption(t *testing.T) {
	tests := []struct {
		name    string
		caption string
		valid   bool
	}{
		{name: "two options", caption: `{"q":"Choose","options":["A","B"]}`, valid: true},
		{name: "three options", caption: `{"q":"Choose","options":["A","B","C"]}`, valid: true},
		{name: "legacy two options", caption: `{"q":"Choose","a":"Yes","b":"No"}`, valid: true},
		{name: "missing question", caption: `{"options":["A","B"]}`},
		{name: "one option", caption: `{"q":"Choose","options":["A"]}`},
		{name: "four options", caption: `{"q":"Choose","options":["A","B","C","D"]}`},
		{name: "empty option", caption: `{"q":"Choose","options":["A"," "]}`},
		{name: "malformed", caption: `{"q":`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validatePollCaption(tt.caption); got != tt.valid {
				t.Fatalf("validatePollCaption() = %v, want %v", got, tt.valid)
			}
		})
	}
}

func TestInvalidPollIsRejectedBeforePersistence(t *testing.T) {
	svc := NewService(nil, nil)
	_, err := svc.Create(context.Background(), uuid.New(), CreateRequest{
		Kind:    KindPoll,
		Caption: `{"q":"Choose","options":["A","B","C","D"]}`,
	})
	if err != ErrInvalidPoll {
		t.Fatalf("Create() error = %v, want %v", err, ErrInvalidPoll)
	}
}

func TestPollCaptionPersistsOptions(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	owner := createUser(t, pool, "poll_"+uuid.NewString()[:8])
	caption := `{"q":"Choose","options":["A","B","C"],"position":{"x":0.5,"y":0.4}}`
	svc := NewService(NewRepository(pool), nil)
	created, err := svc.Create(ctx, owner, CreateRequest{Kind: KindPoll, Caption: caption})
	if err != nil {
		t.Fatalf("Create poll: %v", err)
	}
	loaded, err := svc.Get(ctx, created.ID, owner)
	if err != nil {
		t.Fatalf("Get poll: %v", err)
	}
	var payload struct {
		Options []string `json:"options"`
	}
	if err := json.Unmarshal([]byte(loaded.Caption), &payload); err != nil {
		t.Fatalf("unmarshal persisted caption: %v", err)
	}
	if len(payload.Options) != 3 || payload.Options[2] != "C" {
		t.Fatalf("persisted options = %#v, want [A B C]", payload.Options)
	}
}
