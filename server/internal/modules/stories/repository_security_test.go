package stories

import (
	"context"
	"testing"

	"github.com/google/uuid"
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
}
