package server

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/modules/bots"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

// TestBotChatInfoAndDirectMessages is what the SDKs (#329) rely on: a bot
// can ask whether a chat is direct or a group, and hears the messages of its
// own direct chat — once each.
func TestBotChatInfoAndDirectMessages(t *testing.T) {
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
	router, secret, _ := botEventsRouter(t, pool)

	alice := testUser(t, pool, "ci_alice")
	bob := testUser(t, pool, "ci_bob")
	group := testGroup(t, pool, alice, bob)
	asUser := func(user uuid.UUID, method, path string, body any) *httptest.ResponseRecorder {
		return do(router, method, path, body, userToken(t, secret, user))
	}
	expect := func(r *httptest.ResponseRecorder, code int, what string) {
		t.Helper()
		if r.Code != code {
			t.Fatalf("%s: status %d, body %s; want %d", what, r.Code, r.Body.String(), code)
		}
	}

	username := "ci_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{"username": username, "display_name": "Info"})
	expect(created, http.StatusCreated, "create bot")
	var out struct {
		Bot   bots.Bot          `json:"bot"`
		Token bots.CreatedToken `json:"token"`
	}
	decode(t, created, &out)
	botID, token := out.Bot.ID, out.Token.Secret
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM bots WHERE user_id = $1`, botID) })
	asBot := func(method, path string) *httptest.ResponseRecorder {
		return do(router, method, path, nil, "Bot "+token)
	}
	chatType := func(chatID uuid.UUID) string {
		t.Helper()
		r := asBot(http.MethodGet, "/api/bot/v1/chats/"+chatID.String())
		expect(r, http.StatusOK, "chat info")
		var info bots.ChatInfo
		decode(t, r, &info)
		return info.Type
	}

	dm := asUser(bob, http.MethodPost, "/api/bots/"+botID.String()+"/dm", nil)
	if dm.Code != http.StatusCreated && dm.Code != http.StatusOK {
		t.Fatalf("open dm: %d %s", dm.Code, dm.Body.String())
	}
	var chat struct {
		ChatID uuid.UUID `json:"chat_id"`
	}
	decode(t, dm, &chat)
	if got := chatType(chat.ChatID); got != "direct" {
		t.Fatalf("direct chat reported as %q", got)
	}

	expect(asBot(http.MethodGet, "/api/bot/v1/chats/"+group.String()), http.StatusNotFound, "a group the bot is not in")
	expect(asUser(alice, http.MethodPost, "/api/chats/"+group.String()+"/bots", map[string]any{
		"bot_id": botID, "scopes": []string{"messages.read.commands", "messages.send"},
	}), http.StatusCreated, "install")
	if got := chatType(group); got != "group" {
		t.Fatalf("group reported as %q", got)
	}

	// A message in the direct chat is an event for the bot, exactly once.
	expect(asUser(bob, http.MethodPost, "/api/chats/"+chat.ChatID.String()+"/messages", map[string]any{
		"content":      "soc1." + base64.RawURLEncoding.EncodeToString([]byte(`{"v":1,"ik":"aWs","n":0}`)) + ".Ym9keQ",
		"message_type": "text",
	}), http.StatusCreated, "message in the direct chat")
	var n int
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM bot_events WHERE bot_id = $1 AND chat_id = $2 AND type = 'message.created'`,
			botID, chat.ChatID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			break
		}
	}
	time.Sleep(200 * time.Millisecond)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM bot_events WHERE bot_id = $1 AND chat_id = $2 AND type = 'message.created'`, botID, chat.ChatID).Scan(&n)
	if n != 1 {
		t.Fatalf("bot got %d message.created events for one direct message, want 1", n)
	}
}
