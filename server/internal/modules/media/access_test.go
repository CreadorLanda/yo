package media

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCanReadUsesCurrentAudience(t *testing.T) {
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping media access integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	owner := seedAccessUser(t, pool)
	member := seedAccessUser(t, pool)
	stranger := seedAccessUser(t, pool)
	repo := NewRepository(pool)

	chatID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO chats (id, type, created_by) VALUES ($1, 'group', $2)`, chatID, owner); err != nil {
		t.Fatal(err)
	}
	for _, userID := range []uuid.UUID{owner, member} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, chatID, userID); err != nil {
			t.Fatal(err)
		}
	}
	mediaID := seedAccessMedia(t, ctx, pool, repo, owner)
	var messageID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO messages (chat_id, sender_id, content, message_type)
		VALUES ($1, $2, 'ciphertext', 'image') RETURNING id
	`, chatID, owner).Scan(&messageID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chat_media_access (message_id, media_id) VALUES ($1, $2)`, messageID, mediaID); err != nil {
		t.Fatal(err)
	}
	assertCanRead := func(userID uuid.UUID, want bool, label string) {
		t.Helper()
		got, err := repo.CanRead(ctx, mediaID, userID)
		if err != nil {
			t.Fatalf("CanRead %s: %v", label, err)
		}
		if got != want {
			t.Fatalf("CanRead %s = %v, want %v", label, got, want)
		}
	}

	assertCanRead(owner, true, "owner")
	assertCanRead(member, true, "current chat member")
	assertCanRead(stranger, false, "unrelated signed-in user")
	if _, err := pool.Exec(ctx, `UPDATE chat_participants SET history_from = NOW() + interval '1 hour' WHERE chat_id = $1 AND user_id = $2`, chatID, member); err != nil {
		t.Fatal(err)
	}
	assertCanRead(member, false, "member whose history starts after the attachment")
	if _, err := pool.Exec(ctx, `UPDATE chat_participants SET history_from = NULL WHERE chat_id = $1 AND user_id = $2`, chatID, member); err != nil {
		t.Fatal(err)
	}
	assertCanRead(member, true, "member after history is shared")
	if _, err := pool.Exec(ctx, `UPDATE messages SET expires_at = NOW() - interval '1 second' WHERE id = $1`, messageID); err != nil {
		t.Fatal(err)
	}
	assertCanRead(member, false, "expired disappearing message")
	if _, err := pool.Exec(ctx, `UPDATE messages SET expires_at = NULL, deleted_at = NOW() WHERE id = $1`, messageID); err != nil {
		t.Fatal(err)
	}
	assertCanRead(member, false, "deleted message")
	if _, err := pool.Exec(ctx, `DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2`, chatID, member); err != nil {
		t.Fatal(err)
	}
	groupAvatar := seedAccessMedia(t, ctx, pool, repo, owner)
	if _, err := pool.Exec(ctx, `UPDATE chats SET avatar_url = $2 WHERE id = $1`, chatID, "/api/media/"+groupAvatar.String()+"/file"); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, groupAvatar, stranger); err != nil || allowed {
		t.Fatalf("group avatar access for non-member = %v, err %v; want denied", allowed, err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, chatID, member); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, groupAvatar, member); err != nil || !allowed {
		t.Fatalf("group avatar access for current member = %v, err %v; want allowed", allowed, err)
	}

	storyMedia := seedAccessMedia(t, ctx, pool, repo, owner)
	if _, err := pool.Exec(ctx, `
		INSERT INTO stories (author_id, kind, media_url, visibility, expires_at)
		VALUES ($1, 'image', $2, 'public', NOW() + interval '1 hour')
	`, owner, "/api/media/"+storyMedia.String()+"/file"); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, storyMedia, stranger); err != nil || !allowed {
		t.Fatalf("public active story access = %v, err %v; want allowed", allowed, err)
	}

	channelMedia := seedAccessMedia(t, ctx, pool, repo, owner)
	var channelID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO channels (owner_id, name, handle, visibility) VALUES ($1, 'Private', $2, 'private') RETURNING id
	`, owner, "private_"+uuid.NewString()[:8]).Scan(&channelID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO channel_posts (channel_id, author_id, media_url) VALUES ($1, $2, $3)
	`, channelID, owner, "/api/media/"+channelMedia.String()+"/file"); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, channelMedia, stranger); err != nil || allowed {
		t.Fatalf("private channel access before membership = %v, err %v; want denied", allowed, err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, channelID, stranger); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, channelMedia, stranger); err != nil || !allowed {
		t.Fatalf("private channel access after membership = %v, err %v; want allowed", allowed, err)
	}

	profileMedia := seedAccessMedia(t, ctx, pool, repo, owner)
	if _, err := pool.Exec(ctx, `UPDATE users SET avatar_uri = $2, photo_visibility = 'nobody' WHERE id = $1`, owner, "/api/media/"+profileMedia.String()+"/file"); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, profileMedia, stranger); err != nil || allowed {
		t.Fatalf("private profile photo access = %v, err %v; want denied", allowed, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET photo_visibility = 'contacts' WHERE id = $1`, owner); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.CanRead(ctx, profileMedia, stranger); err != nil || allowed {
		t.Fatalf("contacts-only profile photo without shared chat = %v, err %v; want denied", allowed, err)
	}
	directID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO chats (id, type, created_by) VALUES ($1, 'direct', $2)`, directID, owner); err != nil {
		t.Fatal(err)
	}
	for _, userID := range []uuid.UUID{owner, stranger} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, directID, userID); err != nil {
			t.Fatal(err)
		}
	}
	if allowed, err := repo.CanRead(ctx, profileMedia, stranger); err != nil || !allowed {
		t.Fatalf("contacts-only profile photo with shared chat = %v, err %v; want allowed", allowed, err)
	}
}

func seedAccessUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name) VALUES (gen_random_bytes(32), $1, 'Test') RETURNING id
	`, "media_"+uuid.NewString()[:12]).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func seedAccessMedia(t *testing.T, ctx context.Context, pool *pgxpool.Pool, repo *Repository, owner uuid.UUID) uuid.UUID {
	t.Helper()
	row, err := repo.Insert(ctx, owner, KindImage, "application/octet-stream", 1, owner.String()+"/"+uuid.NewString(), "", nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetExpiry(ctx, row.ID, time.Now().Add(time.Hour), 0); err != nil {
		t.Fatal(err)
	}
	return row.ID
}
