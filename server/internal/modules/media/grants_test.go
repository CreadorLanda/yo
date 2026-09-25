package media

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/CreadorLanda/yo/server/internal/platform/postgres"
)

func TestMediaGrantToChatIsOwnerBound(t *testing.T) {
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping media grant integration test")
	}
	ctx := context.Background()
	db, err := postgres.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	owner := seedUser(ctx, t, db)
	recipient := seedUser(ctx, t, db)
	outsider := seedUser(ctx, t, db)
	repo := NewRepository(db)
	media, err := repo.Insert(ctx, owner, KindImage, "image/png", 4,
		owner.String()+"/object.png", "object.png", nil, nil, nil)
	if err != nil {
		t.Fatalf("insert media: %v", err)
	}

	var chatID uuid.UUID
	if err := db.QueryRow(ctx, `
		INSERT INTO chats (type, created_by, status) VALUES ('direct', $1, 'active') RETURNING id
	`, owner).Scan(&chatID); err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)
	`, chatID, owner, recipient); err != nil {
		t.Fatalf("add participants: %v", err)
	}

	if err := repo.GrantToChat(ctx, media.ID, chatID, owner); err != nil {
		t.Fatalf("grant media: %v", err)
	}
	if _, err := repo.GetForUser(ctx, media.ID, recipient); err != nil {
		t.Fatalf("recipient cannot read granted media: %v", err)
	}
	if _, err := repo.GetForUser(ctx, media.ID, outsider); err == nil {
		t.Fatal("outsider read media without a grant")
	} else if err != pgx.ErrNoRows {
		t.Fatalf("outsider error = %v, want not found", err)
	}
	if err := repo.GrantToChat(ctx, media.ID, chatID, outsider); err != ErrMediaNotOwner {
		t.Fatalf("non-owner grant error = %v, want %v", err, ErrMediaNotOwner)
	}
}
