package stories

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRestrictedStoryDoesNotUseGroupMembershipAsContact(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	repo := NewRepository(db)
	author := createUser(t, db, "story_author_"+uuid.NewString()[:8])
	viewer := createUser(t, db, "story_viewer_"+uuid.NewString()[:8])

	var chatID uuid.UUID
	if err := db.QueryRow(ctx, `
		INSERT INTO chats (type, created_by) VALUES ('group', $1) RETURNING id
	`, author).Scan(&chatID); err != nil {
		t.Fatalf("create group: %v", err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)
	`, chatID, author, viewer); err != nil {
		t.Fatalf("add group members: %v", err)
	}

	story, err := NewService(repo, nil).Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "private", Visibility: VisContacts,
	})
	if err != nil {
		t.Fatalf("create story: %v", err)
	}
	if _, err := repo.Get(ctx, story.ID, viewer); err == nil {
		t.Fatal("group membership exposed a contacts story")
	}
	feed, err := repo.Feed(ctx, viewer)
	if err != nil {
		t.Fatalf("feed: %v", err)
	}
	for _, item := range feed {
		if item.ID == story.ID {
			t.Fatal("group membership exposed a contacts story in feed")
		}
	}

	pendingChat := insertStoryTestChat(t, db, author, viewer, "pending")
	pendingStory, err := NewService(repo, nil).Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "pending", Visibility: VisContacts,
	})
	if err != nil {
		t.Fatalf("create pending story: %v", err)
	}
	if _, err := repo.Get(ctx, pendingStory.ID, viewer); err == nil {
		t.Fatal("pending friend request exposed a contacts story")
	}
	if _, err := db.Exec(ctx, `DELETE FROM chats WHERE id = $1`, pendingChat); err != nil {
		t.Fatalf("delete pending chat: %v", err)
	}

	blockedChat := insertStoryTestChat(t, db, author, viewer, "active")
	if _, err := db.Exec(ctx, `
		INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)
	`, author, viewer); err != nil {
		t.Fatalf("block viewer: %v", err)
	}
	blockedStory, err := NewService(repo, nil).Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "blocked", Visibility: VisContacts,
	})
	if err != nil {
		t.Fatalf("create blocked story: %v", err)
	}
	if _, err := repo.Get(ctx, blockedStory.ID, viewer); err == nil {
		t.Fatal("blocked user accessed a contacts story")
	}
	if _, err := db.Exec(ctx, `DELETE FROM chats WHERE id = $1`, blockedChat); err != nil {
		t.Fatalf("delete blocked chat: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, author, viewer); err != nil {
		t.Fatalf("unblock test users: %v", err)
	}

	activeChat := insertStoryTestChat(t, db, author, viewer, "active")
	contactStory, err := NewService(repo, nil).Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "contact", Visibility: VisContacts,
	})
	if err != nil {
		t.Fatalf("create contact story: %v", err)
	}
	if _, err := repo.Get(ctx, contactStory.ID, viewer); err != nil {
		t.Fatalf("active direct contact could not access story: %v", err)
	}
	closeStory, err := NewService(repo, nil).Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "close", Visibility: VisClose,
	})
	if err != nil {
		t.Fatalf("create close story: %v", err)
	}
	if _, err := repo.Get(ctx, closeStory.ID, viewer); err == nil {
		t.Fatal("ordinary contact accessed a close-friends story")
	}
	if _, err := db.Exec(ctx, `DELETE FROM chats WHERE id = $1`, activeChat); err != nil {
		t.Fatalf("delete active chat: %v", err)
	}
}

func insertStoryTestChat(t *testing.T, db *pgxpool.Pool, author, viewer uuid.UUID, status string) uuid.UUID {
	t.Helper()
	var chatID uuid.UUID
	// This helper is intentionally kept local to the integration test: story
	// visibility must be tested against the database's real chat state.
	if err := db.QueryRow(context.Background(), `
		INSERT INTO chats (type, created_by, status) VALUES ('direct', $1, $2) RETURNING id
	`, author, status).Scan(&chatID); err != nil {
		t.Fatalf("create direct chat: %v", err)
	}
	if _, err := db.Exec(context.Background(), `
		INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)
	`, chatID, author, viewer); err != nil {
		t.Fatalf("add direct participants: %v", err)
	}
	return chatID
}
