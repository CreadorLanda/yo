package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/modules/bots"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

// TestBotInteractions is #325's server side: a click in a direct chat with a
// bot reaches it, and a bot's ephemeral reply goes to members only.
func TestBotInteractions(t *testing.T) {
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

	alice := testUser(t, pool, "ia_alice")
	bob := testUser(t, pool, "ia_bob")
	outsider := testUser(t, pool, "ia_out")
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

	username := "ia_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{"username": username, "display_name": "Buttons"})
	expect(created, http.StatusCreated, "create bot")
	var out struct {
		Bot   bots.Bot          `json:"bot"`
		Token bots.CreatedToken `json:"token"`
	}
	decode(t, created, &out)
	botID, token := out.Bot.ID, out.Token.Secret
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM bots WHERE user_id = $1`, botID) })
	asBot := func(method, path string, body any) *httptest.ResponseRecorder {
		return do(router, method, path, body, "Bot "+token)
	}
	envelope := directEnvelope()

	// A direct chat with the bot: a click reaches it without any installation.
	dm := asUser(bob, http.MethodPost, "/api/bots/"+botID.String()+"/dm", nil)
	if dm.Code != http.StatusCreated && dm.Code != http.StatusOK {
		t.Fatalf("open dm: %d %s", dm.Code, dm.Body.String())
	}
	var chat struct {
		ChatID uuid.UUID `json:"chat_id"`
	}
	decode(t, dm, &chat)
	expect(asUser(bob, http.MethodPost, "/api/chats/"+chat.ChatID.String()+"/bots/"+botID.String()+"/updates", map[string]any{
		"kind": "interaction", "content": envelope,
	}), http.StatusCreated, "interaction in a direct chat")
	expect(asBot(http.MethodPost, "/api/bot/v1/chats/"+chat.ChatID.String()+"/ephemeral", map[string]any{
		"user_id": bob, "content": envelope,
	}), http.StatusAccepted, "ephemeral in a direct chat")

	// In a group the bot must be installed, and only members get replies.
	gPath := "/api/bot/v1/chats/" + group.String() + "/ephemeral"
	expect(asBot(http.MethodPost, gPath, map[string]any{"user_id": bob, "content": envelope}), http.StatusNotFound,
		"ephemeral before install")
	expect(asUser(alice, http.MethodPost, "/api/chats/"+group.String()+"/bots", map[string]any{"bot_id": botID}),
		http.StatusCreated, "install")
	expect(asBot(http.MethodPost, gPath, map[string]any{"user_id": bob, "content": envelope}), http.StatusAccepted,
		"ephemeral to a member")
	expect(asBot(http.MethodPost, gPath, map[string]any{"user_id": outsider, "content": envelope}), http.StatusNotFound,
		"ephemeral to an outsider")
	expect(asBot(http.MethodPost, gPath, map[string]any{"user_id": bob, "content": "hello in the clear"}),
		http.StatusBadRequest, "plaintext ephemeral")
	expect(asUser(bob, http.MethodPost, "/api/chats/"+group.String()+"/bots/"+botID.String()+"/updates", map[string]any{
		"kind": "interaction", "content": envelope,
	}), http.StatusCreated, "interaction in a group")
}
