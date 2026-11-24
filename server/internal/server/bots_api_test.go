package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/bots"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/keys"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/media"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/messages"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/users"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

// TestBotAPIEndToEnd drives the bot platform through HTTP the way an owner,
// a group admin and a bot would, on the same routes production mounts.
func TestBotAPIEndToEnd(t *testing.T) {
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping integration test (see make docker-up-local)")
	}
	ctx := context.Background()
	pool, err := postgres.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(pool.Close)

	secret := []byte("bot-api-test-secret")
	usersRepo := users.NewRepository(pool)
	msgSvc := messages.NewService(messages.NewRepository(pool, ""), usersRepo, nil, nil)
	msgCtl := messages.NewController(msgSvc, nil, secret)
	keysCtl := keys.NewController(keys.NewService(keys.NewRepository(pool), usersRepo))
	mediaCtl := media.NewController(media.NewService(media.NewRepository(pool), t.TempDir(), 1<<20, time.Hour))
	botsSvc := bots.NewService(bots.NewRepository(pool))
	botsCtl := bots.NewController(botsSvc)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	authed := api.Group("")
	authed.Use(middleware.Auth(secret))
	bots.Register(authed, botsCtl)
	messages.Register(authed, msgCtl)
	mountBotAPI(api, botsSvc, botsCtl, botAPIHandlers{keys: keysCtl, media: mediaCtl, messages: msgCtl}, nil)

	alice := testUser(t, pool, "bot_alice")
	bob := testUser(t, pool, "bot_bob")
	group := testGroup(t, pool, alice, bob)

	asUser := func(user uuid.UUID, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		tok, err := tokens.Sign(secret, tokens.Claims{
			UserID: user, DeviceID: uuid.New(), Type: tokens.TypeAccess,
			IssuedAt: time.Now(), Expires: time.Now().Add(time.Minute),
		})
		if err != nil {
			t.Fatalf("sign: %v", err)
		}
		return do(router, method, path, body, "Bearer "+tok)
	}
	asBot := func(token, method, path string, body any) *httptest.ResponseRecorder {
		return do(router, method, path, body, "Bot "+token)
	}
	expect := func(r *httptest.ResponseRecorder, code int, what string) {
		t.Helper()
		if r.Code != code {
			t.Fatalf("%s: status %d, body %s; want %d", what, r.Code, r.Body.String(), code)
		}
	}

	// Owner creates a bot; the token comes back once.
	username := "e2e_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	expect(asUser(alice, http.MethodPost, "/api/bots", map[string]string{
		"username": "notabotname", "display_name": "Nope",
	}), http.StatusBadRequest, "username without bot suffix")
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{
		"username": username, "display_name": "Reminder", "description": "Reminds people",
	})
	expect(created, http.StatusCreated, "create bot")
	var out struct {
		Bot   bots.Bot          `json:"bot"`
		Token bots.CreatedToken `json:"token"`
	}
	decode(t, created, &out)
	botID, botToken := out.Bot.ID, out.Token.Secret
	if !strings.HasPrefix(botToken, bots.TokenPrefix) || !out.Bot.PrivacyMode {
		t.Fatalf("token %q / privacy %v: want zsb_ token and privacy mode on", out.Token.Prefix, out.Bot.PrivacyMode)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM bots WHERE user_id = $1`, botID) })
	expect(asUser(alice, http.MethodPost, "/api/bots", map[string]string{
		"username": username, "display_name": "Again",
	}), http.StatusConflict, "duplicate username")
	expect(asUser(bob, http.MethodPatch, "/api/bots/"+botID.String(), map[string]string{
		"display_name": "Mine now",
	}), http.StatusNotFound, "someone else's bot")

	// Bot auth.
	expect(asBot(botToken, http.MethodGet, "/api/bot/v1/me", nil), http.StatusOK, "bot me")
	expect(asBot("zsb_"+strings.Repeat("A", 43), http.MethodGet, "/api/bot/v1/me", nil), http.StatusUnauthorized, "unknown token")
	expect(do(router, http.MethodGet, "/api/bot/v1/me", nil, ""), http.StatusUnauthorized, "no token")

	// Only an admin installs; the bot cannot act before it is installed.
	gPath := "/api/chats/" + group.String()
	envelope := groupEnvelope(botID)
	expect(asBot(botToken, http.MethodPost, "/api/bot/v1/chats/"+group.String()+"/messages", map[string]string{
		"content": envelope,
	}), http.StatusNotFound, "send before install")
	expect(asUser(bob, http.MethodPost, gPath+"/bots", map[string]any{"bot_id": botID}), http.StatusForbidden, "member installs")
	expect(asUser(alice, http.MethodPost, gPath+"/bots", map[string]any{"bot_id": botID}), http.StatusCreated, "admin installs")
	expect(asUser(alice, http.MethodPost, gPath+"/bots", map[string]any{"bot_id": botID}), http.StatusConflict, "install twice")
	if n := systemMessages(t, pool, group, "bot:added:"); n != 1 {
		t.Fatalf("bot:added system messages = %d, want 1", n)
	}
	expect(asUser(bob, http.MethodGet, gPath+"/bots", nil), http.StatusOK, "member lists bots")

	// The bot sends an encrypted message; plaintext is refused like a person's.
	expect(asBot(botToken, http.MethodPost, "/api/bot/v1/chats/"+group.String()+"/messages", map[string]string{
		"content": envelope,
	}), http.StatusCreated, "bot sends")
	expect(asBot(botToken, http.MethodPost, "/api/bot/v1/chats/"+group.String()+"/messages", map[string]string{
		"content": "hello in the clear",
	}), http.StatusBadRequest, "bot sends plaintext")
	members := asBot(botToken, http.MethodGet, "/api/bot/v1/chats/"+group.String()+"/members", nil)
	expect(members, http.StatusOK, "bot lists members")
	var list []bots.Member
	decode(t, members, &list)
	if len(list) != 3 {
		t.Fatalf("members = %d, want alice, bob and the bot", len(list))
	}

	// Taking messages.send away stops sending; full read is announced.
	expect(asUser(alice, http.MethodPatch, gPath+"/bots/"+botID.String(), map[string]any{
		"scopes": []string{"messages.read.commands", "messages.read.all"},
	}), http.StatusOK, "re-scope")
	expect(asBot(botToken, http.MethodPost, "/api/bot/v1/chats/"+group.String()+"/messages", map[string]string{
		"content": envelope,
	}), http.StatusForbidden, "send without scope")
	if n := systemMessages(t, pool, group, "bot:read_all:"); n != 1 {
		t.Fatalf("full-read system messages = %d, want 1", n)
	}

	// Rotating revokes the old secret.
	rot := asUser(alice, http.MethodPost, "/api/bots/"+botID.String()+"/tokens", nil)
	expect(rot, http.StatusCreated, "rotate")
	var newTok bots.CreatedToken
	decode(t, rot, &newTok)
	expect(asBot(botToken, http.MethodGet, "/api/bot/v1/me", nil), http.StatusUnauthorized, "old token after rotate")
	expect(asBot(newTok.Secret, http.MethodGet, "/api/bot/v1/me", nil), http.StatusOK, "new token")

	// A person opens a DM with the bot; asking again returns the same chat.
	dm := asUser(bob, http.MethodPost, "/api/bots/"+botID.String()+"/dm", nil)
	expect(dm, http.StatusCreated, "open dm")
	again := asUser(bob, http.MethodPost, "/api/bots/"+botID.String()+"/dm", nil)
	expect(again, http.StatusOK, "open dm again")
	if dm.Body.String() != again.Body.String() {
		t.Fatalf("second dm %s differs from first %s", again.Body.String(), dm.Body.String())
	}

	// Uninstall, then delete: the account goes with the bot.
	expect(asUser(alice, http.MethodDelete, gPath+"/bots/"+botID.String(), nil), http.StatusNoContent, "uninstall")
	expect(asUser(alice, http.MethodDelete, "/api/bots/"+botID.String(), nil), http.StatusNoContent, "delete bot")
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, botID).Scan(&exists); err != nil || exists {
		t.Fatalf("bot user still exists after delete (err %v)", err)
	}
	expect(asBot(newTok.Secret, http.MethodGet, "/api/bot/v1/me", nil), http.StatusUnauthorized, "token after delete")
}

func do(router http.Handler, method, path string, body any, auth string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, r *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %s: %v", r.Body.String(), err)
	}
}

// groupEnvelope is a well-formed soc1g. envelope from `sender`. The body is
// noise: the server checks shape, never content.
func groupEnvelope(sender uuid.UUID) string {
	header, _ := json.Marshal(map[string]any{"v": 1, "s": sender.String(), "e": 1, "n": 1})
	return "soc1g." + base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString([]byte("ciphertext-placeholder"))
}

func testUser(t *testing.T, pool *pgxpool.Pool, prefix string) uuid.UUID {
	t.Helper()
	name := fmt.Sprintf("%s_%s", prefix, uuid.NewString()[:8])
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func testGroup(t *testing.T, pool *pgxpool.Pool, admin, member uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO chats (type, title, created_by, status) VALUES ('group', 'Bots e2e', $1, 'active')
		RETURNING id
	`, admin).Scan(&id); err != nil {
		t.Fatalf("create group: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')
	`, id, admin, member); err != nil {
		t.Fatalf("add members: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM chats WHERE id = $1`, id) })
	return id
}

func systemMessages(t *testing.T, pool *pgxpool.Pool, chat uuid.UUID, prefix string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM messages WHERE chat_id = $1 AND message_type = 'system' AND content LIKE $2
	`, chat, prefix+"%").Scan(&n); err != nil {
		t.Fatalf("count system messages: %v", err)
	}
	return n
}
