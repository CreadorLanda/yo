package users

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

func deleteDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping integration test")
	}
	pool, err := postgres.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func mkUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	name := "del_" + uuid.NewString()[:8]
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

// TestDeletingAnAccountThatWasUsed is the whole bug.
//
// `DELETE FROM users` was refused for anyone who had started a conversation or
// sent a message: chats.created_by and messages.sender_id were the only two of
// forty foreign keys pointing at users without ON DELETE. The endpoint existed
// and returned 500 for every real account.
func TestDeletingAnAccountThatWasUsed(t *testing.T) {
	pool := deleteDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	leaving, staying := mkUser(t, pool), mkUser(t, pool)

	var chatID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO chats (type, created_by, status)
		VALUES ('direct', $1, 'active') RETURNING id
	`, leaving).Scan(&chatID); err != nil {
		t.Fatalf("create chat: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1`, chatID) })

	for _, u := range []uuid.UUID{leaving, staying} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, chatID, u); err != nil {
			t.Fatalf("add participant: %v", err)
		}
	}
	for _, sender := range []uuid.UUID{leaving, staying} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO messages (chat_id, sender_id, content, message_type)
			VALUES ($1, $2, 'soc1.body', 'text')
		`, chatID, sender); err != nil {
			t.Fatalf("insert message: %v", err)
		}
	}

	if err := repo.Delete(ctx, leaving); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// The account is gone.
	var stillThere bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, leaving).Scan(&stillThere); err != nil {
		t.Fatalf("check user: %v", err)
	}
	if stillThere {
		t.Fatal("the account survived its own deletion")
	}

	// The other person's conversation is not.
	var total, unattributed int
	if err := pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE sender_id IS NULL)
		FROM messages WHERE chat_id = $1
	`, chatID).Scan(&total, &unattributed); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if total != 2 {
		t.Fatalf("%d messages left in the chat, want 2 — deleting an account "+
			"must not retract what was sent to other people", total)
	}
	if unattributed != 1 {
		t.Fatalf("%d unattributed messages, want 1", unattributed)
	}

	// And the chat outlives whoever created it.
	var creatorGone bool
	if err := pool.QueryRow(ctx,
		`SELECT created_by IS NULL FROM chats WHERE id = $1`, chatID).Scan(&creatorGone); err != nil {
		t.Fatalf("the chat went with its creator: %v", err)
	}
	if !creatorGone {
		t.Fatal("created_by still points at a user that no longer exists")
	}
}

// TestDeletingAnAccountRemovesWhatIsOnlyYours: the anonymising is deliberate
// and narrow. Everything that is purely the account's own still goes.
func TestDeletingAnAccountRemovesWhatIsOnlyYours(t *testing.T) {
	pool := deleteDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	user := mkUser(t, pool)
	if _, err := pool.Exec(ctx, `
		INSERT INTO devices (user_id, name, platform, signal_identity)
		VALUES ($1, 'test device', 'android', gen_random_bytes(32))
	`, user); err != nil {
		t.Fatalf("register device: %v", err)
	}

	if err := repo.Delete(ctx, user); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var devices int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM devices WHERE user_id = $1`, user).Scan(&devices); err != nil {
		t.Fatalf("count devices: %v", err)
	}
	if devices != 0 {
		t.Fatalf("%d push tokens outlived the account", devices)
	}
}

// TestDeletingAnAccountThatNeverExisted still reports not-found, so the
// controller keeps returning 404 rather than a silent 204.
func TestDeletingAnAccountThatNeverExisted(t *testing.T) {
	pool := deleteDB(t)
	repo := NewRepository(pool)
	if err := repo.Delete(context.Background(), uuid.New()); !IsNoRows(err) {
		t.Fatalf("Delete(unknown) = %v, want a no-rows error", err)
	}
}
