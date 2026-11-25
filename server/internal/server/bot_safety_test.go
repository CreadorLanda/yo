package server

import (
	"context"
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

type denyAll struct{}

func (denyAll) Allow(context.Context, string, int, time.Duration) (bool, time.Duration, error) {
	return false, time.Second, nil
}

// TestBotSafety is #343: the group audit log, automatic and operator
// suspension, the owner lifting the automatic one, and data deletion asks.
func TestBotSafety(t *testing.T) {
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
	// A second service on the same database, to act as the platform does.
	platform := bots.NewService(bots.NewRepository(pool)).WithStrikeLimiter(denyAll{})

	alice := testUser(t, pool, "sf_alice")
	bob := testUser(t, pool, "sf_bob")
	outsider := testUser(t, pool, "sf_out")
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

	username := "sf_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{"username": username, "display_name": "Safety"})
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
	gPath := "/api/chats/" + group.String()
	botPath := "/api/bots/" + botID.String()

	// Audit log: install with full read, narrow it, a command by an admin, remove.
	expect(asUser(alice, http.MethodPost, gPath+"/bots", map[string]any{
		"bot_id": botID, "scopes": []string{"messages.read.commands", "messages.read.all", "messages.send"},
	}), http.StatusCreated, "install")
	expect(asUser(alice, http.MethodPatch, gPath+"/bots/"+botID.String(), map[string]any{
		"scopes": []string{"messages.read.commands", "messages.send"},
	}), http.StatusOK, "narrow scopes")
	expect(asUser(alice, http.MethodPost, gPath+"/bots/"+botID.String()+"/updates", map[string]any{
		"kind": "command", "content": directEnvelope(),
	}), http.StatusCreated, "admin runs a command")
	expect(asUser(bob, http.MethodPost, gPath+"/bots/"+botID.String()+"/updates", map[string]any{
		"kind": "command", "content": directEnvelope(),
	}), http.StatusCreated, "member runs a command")
	expect(asUser(bob, http.MethodGet, gPath+"/bots/audit", nil), http.StatusForbidden, "member reads the audit log")
	audit := asUser(alice, http.MethodGet, gPath+"/bots/audit", nil)
	expect(audit, http.StatusOK, "admin reads the audit log")
	var entries []bots.AuditEntry
	decode(t, audit, &entries)
	var actions []string
	for _, e := range entries {
		actions = append(actions, e.Action)
	}
	want := []string{bots.AuditCommandRun, bots.AuditReadAllOff, bots.AuditReadAllOn, bots.AuditAdded}
	if strings.Join(actions, ",") != strings.Join(want, ",") {
		t.Fatalf("audit actions %v, want %v (only the admin's command)", actions, want)
	}
	if entries[3].BotName != "Safety" || entries[3].ActorName == "" {
		t.Fatalf("audit names: %+v", entries[3])
	}

	// Data deletion: one bot on request, every bot on account deletion.
	expect(asUser(bob, http.MethodPost, botPath+"/forget-me", nil), http.StatusAccepted, "forget me")
	expect(asUser(outsider, http.MethodPost, botPath+"/forget-me", nil), http.StatusNotFound, "forget me, no shared chat")
	if err := platform.NotifyDataDeletion(ctx, bob); err != nil {
		t.Fatal(err)
	}
	var asks int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM bot_events WHERE bot_id = $1 AND type = 'user.data_deletion' AND payload->>'user_id' = $2`, botID, bob.String()).Scan(&asks); err != nil || asks != 2 {
		t.Fatalf("data deletion events = %d (err %v), want 2", asks, err)
	}

	// Automatic suspension: strikes past the limit. The token stops working,
	// the group log says so, and the owner can lift it.
	expect(asBot(http.MethodGet, "/api/bot/v1/me"), http.StatusOK, "bot before suspension")
	platform.Strike(ctx, botID)
	expect(asBot(http.MethodGet, "/api/bot/v1/me"), http.StatusForbidden, "suspended bot")
	expect(asUser(alice, http.MethodPost, gPath+"/bots", map[string]any{"bot_id": botID}), http.StatusForbidden, "add a suspended bot")
	var suspendedLogged int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM bot_audit WHERE chat_id = $1 AND action = 'bot.suspended'`, group).Scan(&suspendedLogged)
	if suspendedLogged != 1 {
		t.Fatalf("suspension logged %d times in the group", suspendedLogged)
	}
	expect(asUser(bob, http.MethodPost, botPath+"/reactivate", nil), http.StatusNotFound, "someone else reactivates")
	expect(asUser(alice, http.MethodPost, botPath+"/reactivate", nil), http.StatusOK, "owner reactivates")
	expect(asBot(http.MethodGet, "/api/bot/v1/me"), http.StatusOK, "bot after reactivation")

	// An operator's suspension is not the owner's to lift.
	if err := platform.Suspend(ctx, botID, "abuse"); err != nil {
		t.Fatal(err)
	}
	expect(asUser(alice, http.MethodPost, botPath+"/reactivate", nil), http.StatusForbidden, "owner lifts an operator suspension")
	expect(asBot(http.MethodGet, "/api/bot/v1/me"), http.StatusForbidden, "still suspended")
}
