package users

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSearchRespectsContactsVisibility(t *testing.T) {
	pool := ghostTestDB(t)
	ctx := context.Background()
	callerID := createContactsVisibilityTestUser(t, pool, "caller_"+uuid.NewString()[:8], true)
	searchTerm := "dsc_" + uuid.NewString()[:8]
	visibleID := createContactsVisibilityTestUser(t, pool, searchTerm+"_yes", true)
	hiddenID := createContactsVisibilityTestUser(t, pool, searchTerm+"_no", false)

	results, err := NewService(NewRepository(pool)).Search(ctx, callerID, searchTerm)
	if err != nil {
		t.Fatalf("search users: %v", err)
	}

	found := make(map[uuid.UUID]bool, len(results))
	for _, user := range results {
		found[user.ID] = true
	}
	if !found[visibleID] {
		t.Fatalf("user with contact discovery enabled was omitted from search: %s", visibleID)
	}
	if found[hiddenID] {
		t.Fatalf("user with contact discovery disabled appeared in search: %s", hiddenID)
	}
}

func createContactsVisibilityTestUser(t *testing.T, pool *pgxpool.Pool, username string, visible bool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name, username_public, contacts_visible)
		VALUES (gen_random_bytes(32), $1, $1, TRUE, $2)
		RETURNING id
	`, username, visible).Scan(&id)
	if err != nil {
		t.Fatalf("create contacts visibility test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}
