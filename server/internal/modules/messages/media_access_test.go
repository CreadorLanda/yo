package messages

import (
	"context"
	"errors"
	"testing"

	"github.com/CreadorLanda/yo/server/internal/modules/media"
	"github.com/google/uuid"
)

type mediaAccessStub struct {
	allowed bool
}

func (s mediaAccessStub) CanRead(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return s.allowed, nil
}

func TestSendMessageCreatesMediaGrantOnlyAfterAuthorization(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	alice := createTestUser(t, pool, "media_owner_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "media_peer_"+uuid.NewString()[:8])
	svc := newTestService(pool)
	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptChat(ctx, chat.ID, bob); err != nil {
		t.Fatal(err)
	}

	mediaRow, err := media.NewRepository(pool).Insert(ctx, alice, media.KindImage,
		"application/octet-stream", 1, alice.String()+"/"+uuid.NewString(), "", nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := SendMessageRequest{
		Content:  testDirectEnvelope("encrypted media message"),
		MediaIDs: []uuid.UUID{mediaRow.ID},
	}
	svc.WithMediaAccess(mediaAccessStub{allowed: false})
	if _, err := svc.SendMessage(ctx, chat.ID, alice, request); !errors.Is(err, ErrInvalidMediaReference) {
		t.Fatalf("unauthorized media reference error = %v, want ErrInvalidMediaReference", err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM chat_media_access WHERE media_id = $1`, mediaRow.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("unauthorized media created %d grants", count)
	}

	svc.WithMediaAccess(mediaAccessStub{allowed: true})
	msg, err := svc.SendMessage(ctx, chat.ID, alice, request)
	if err != nil {
		t.Fatalf("authorized SendMessage: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM chat_media_access WHERE message_id = $1 AND media_id = $2`, msg.ID, mediaRow.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("message has %d media grants, want 1", count)
	}
}
