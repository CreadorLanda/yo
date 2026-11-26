package server

import (
	"context"
	"encoding/json"
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

// TestBotCommandsEndToEnd is #324 over HTTP: a bot registers commands, a
// member lists them with `/`, a chat's set overrides a global one, and an
// autocomplete query reaches the bot over the gateway and comes back.
func TestBotCommandsEndToEnd(t *testing.T) {
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
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	alice := testUser(t, pool, "cmd_alice")
	bob := testUser(t, pool, "cmd_bob")
	outsider := testUser(t, pool, "cmd_out")
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

	username := "cm_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{"username": username, "display_name": "Commands"})
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

	global := map[string]any{"commands": []map[string]any{
		{"name": "remind", "description": "Set a reminder", "description_pt": "Criar um lembrete", "options": []map[string]any{
			{"name": "when", "description": "When", "type": "datetime", "required": true},
			{"name": "city", "description": "City", "type": "string", "autocomplete": true},
		}},
		{"name": "help", "description": "What I do", "options": []any{}},
	}}
	expect(asBot(http.MethodPut, "/api/bot/v1/commands", map[string]any{"commands": []map[string]any{{"name": "Bad"}}}),
		http.StatusBadRequest, "invalid command")
	expect(asBot(http.MethodPut, "/api/bot/v1/commands", global), http.StatusNoContent, "register global commands")
	expect(asBot(http.MethodPut, "/api/bot/v1/chats/"+group.String()+"/commands", global), http.StatusNotFound,
		"chat commands before install")

	gPath := "/api/chats/" + group.String()
	list := func(user uuid.UUID) []bots.ChatCommand {
		t.Helper()
		r := asUser(user, http.MethodGet, gPath+"/commands", nil)
		expect(r, http.StatusOK, "list commands")
		var l []bots.ChatCommand
		decode(t, r, &l)
		return l
	}
	if n := len(list(bob)); n != 0 {
		t.Fatalf("commands of a bot not in the chat: %d", n)
	}
	expect(asUser(alice, http.MethodPost, gPath+"/bots", map[string]any{"bot_id": botID}), http.StatusCreated, "install")
	cmds := list(bob)
	if len(cmds) != 2 || cmds[0].Bot.ID != botID {
		t.Fatalf("after install: %+v", cmds)
	}
	expect(asUser(outsider, http.MethodGet, gPath+"/commands", nil), http.StatusNotFound, "outsider lists commands")

	// A chat's own `help` replaces the global one there.
	expect(asBot(http.MethodPut, "/api/bot/v1/chats/"+group.String()+"/commands", map[string]any{"commands": []map[string]any{
		{"name": "help", "description": "Help for this group", "options": []any{}},
	}}), http.StatusNoContent, "chat commands")
	var help string
	for _, c := range list(bob) {
		if c.Name == "help" {
			help = c.Description
		}
	}
	if help != "Help for this group" {
		t.Fatalf("chat override not applied: %q", help)
	}

	// Autocomplete: bob types, the bot gets the envelope and answers.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/bot/v1/gateway"
	ws := gatewayConnect(t, wsURL, http.Header{"Authorization": {"Bot " + token}}, 0)
	envelope := directEnvelope()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- asUser(bob, http.MethodPost, gPath+"/bots/"+botID.String()+"/autocomplete", map[string]string{
			"command": "remind", "option": "city", "content": envelope,
		})
	}()
	ev := readUntil(t, ws, bots.EventCommandAutocomplete)
	var event struct {
		Data struct {
			RequestID string `json:"request_id"`
			Content   string `json:"content"`
			Option    string `json:"option"`
		} `json:"data"`
	}
	if err := json.Unmarshal(ev.D, &event); err != nil || event.Data.Content != envelope || event.Data.Option != "city" {
		t.Fatalf("autocomplete event: %s (%v)", ev.D, err)
	}
	expect(asBot(http.MethodPost, "/api/bot/v1/autocomplete/"+event.Data.RequestID, map[string]any{
		"choices": []map[string]any{{"name": "Lisboa", "value": "lis"}, {"name": "Luanda", "value": "lad"}},
	}), http.StatusNoContent, "bot answers")
	var resp *httptest.ResponseRecorder
	select {
	case resp = <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("autocomplete never returned")
	}
	expect(resp, http.StatusOK, "autocomplete")
	var choices struct {
		Choices []bots.Choice `json:"choices"`
	}
	decode(t, resp, &choices)
	if len(choices.Choices) != 2 || choices.Choices[1].Name != "Luanda" {
		t.Fatalf("choices: %+v", choices)
	}

	// An option without autocomplete, or a silent bot, fails cleanly.
	expect(asUser(bob, http.MethodPost, gPath+"/bots/"+botID.String()+"/autocomplete", map[string]string{
		"command": "remind", "option": "when", "content": envelope,
	}), http.StatusBadRequest, "autocomplete on a plain option")
	start := time.Now()
	expect(asUser(bob, http.MethodPost, gPath+"/bots/"+botID.String()+"/autocomplete", map[string]string{
		"command": "remind", "option": "city", "content": envelope,
	}), http.StatusGatewayTimeout, "bot never answers")
	if time.Since(start) > 5*time.Second {
		t.Fatalf("timeout took %s", time.Since(start))
	}
	expect(asBot(http.MethodPost, "/api/bot/v1/autocomplete/nope", map[string]any{"choices": []any{}}), http.StatusNotFound,
		"answer to nothing")
}
