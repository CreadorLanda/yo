package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/modules/bots"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

// TestBotModeration is #333's server side: a bot the admins allowed to
// moderate can mute, delete, remove and ban plain members — never admins —
// and each step is visible to the group.
func TestBotModeration(t *testing.T) {
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

	alice := testUser(t, pool, "mo_alice")
	bob := testUser(t, pool, "mo_bob")
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
	epoch := func() int {
		var e int
		if err := pool.QueryRow(ctx, `SELECT key_epoch FROM chats WHERE id = $1`, group).Scan(&e); err != nil {
			t.Fatal(err)
		}
		return e
	}
	send := func(user uuid.UUID) *httptest.ResponseRecorder {
		return asUser(user, http.MethodPost, "/api/chats/"+group.String()+"/messages", map[string]any{
			"content": groupEnvelopeAt(user, epoch()), "message_type": "text",
		})
	}

	username := "mo_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{"username": username, "display_name": "Mod"})
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
	mod := "/api/bot/v1/chats/" + group.String() + "/moderation"

	// Without members.manage the bot cannot moderate.
	expect(asUser(alice, http.MethodPost, "/api/chats/"+group.String()+"/bots", map[string]any{
		"bot_id": botID, "scopes": []string{"messages.read.commands", "messages.send", "members.read"},
	}), http.StatusCreated, "install")
	expect(asBot(http.MethodPost, mod+"/members/"+bob.String()+"/mute", map[string]any{"seconds": 600}), http.StatusForbidden, "mute without scope")

	// Granting it is announced.
	expect(asUser(alice, http.MethodPatch, "/api/chats/"+group.String()+"/bots/"+botID.String(), map[string]any{
		"scopes": []string{"messages.read.commands", "messages.send", "members.read", "members.manage"},
	}), http.StatusOK, "grant members.manage")
	if systemMessages(t, pool, group, "bot:moderate:") != 1 {
		t.Fatal("granting moderation was not announced")
	}

	// Mute: bob cannot send, admins cannot be muted, unmute restores.
	expect(asBot(http.MethodPost, mod+"/members/"+bob.String()+"/mute", map[string]any{"seconds": 600, "reason": "flood"}), http.StatusNoContent, "mute")
	expect(send(bob), http.StatusForbidden, "muted member sends")
	expect(asBot(http.MethodPost, mod+"/members/"+alice.String()+"/mute", map[string]any{"seconds": 600}), http.StatusForbidden, "mute an admin")
	expect(asBot(http.MethodPost, mod+"/members/"+bob.String()+"/mute", map[string]any{"seconds": 5}), http.StatusBadRequest, "mute too short")
	expect(asBot(http.MethodDelete, mod+"/members/"+bob.String()+"/mute", nil), http.StatusNoContent, "unmute")
	sent := send(bob)
	expect(sent, http.StatusCreated, "unmuted member sends")
	var msg struct {
		ID int64 `json:"id"`
	}
	decode(t, sent, &msg)

	// Delete a member's message; an admin's is off limits.
	expect(asBot(http.MethodDelete, mod+"/messages/"+itoa(msg.ID), nil), http.StatusNoContent, "delete member message")
	var deleted bool
	_ = pool.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM messages WHERE id = $1`, msg.ID).Scan(&deleted)
	if !deleted {
		t.Fatal("message not deleted")
	}
	adminMsg := send(alice)
	decode(t, adminMsg, &msg)
	expect(asBot(http.MethodDelete, mod+"/messages/"+itoa(msg.ID), nil), http.StatusNotFound, "delete an admin's message")

	// Kick: bob can be added back. Ban: he cannot, until an admin lifts it.
	expect(asBot(http.MethodPost, mod+"/members/"+bob.String()+"/kick", nil), http.StatusNoContent, "kick")
	expect(asUser(alice, http.MethodPost, "/api/groups/"+group.String()+"/members", map[string]any{"user_ids": []uuid.UUID{bob}}), http.StatusOK, "re-add after kick")
	expect(asBot(http.MethodPost, mod+"/members/"+bob.String()+"/ban", map[string]any{"reason": "spam"}), http.StatusNoContent, "ban")
	expect(asUser(alice, http.MethodPost, "/api/groups/"+group.String()+"/members", map[string]any{"user_ids": []uuid.UUID{bob}}), http.StatusConflict, "re-add banned")
	bans := asUser(alice, http.MethodGet, "/api/groups/"+group.String()+"/bans", nil)
	expect(bans, http.StatusOK, "list bans")
	if !strings.Contains(bans.Body.String(), bob.String()) || !strings.Contains(bans.Body.String(), "spam") {
		t.Fatalf("bans: %s", bans.Body.String())
	}
	expect(asUser(alice, http.MethodDelete, "/api/groups/"+group.String()+"/bans/"+bob.String(), nil), http.StatusNoContent, "unban")
	expect(asUser(alice, http.MethodPost, "/api/groups/"+group.String()+"/members", map[string]any{"user_ids": []uuid.UUID{bob}}), http.StatusOK, "re-add after unban")

	// Everything is in the group's timeline and bot activity.
	for _, prefix := range []string{"group:member_muted:", "group:member_unmuted:", "group:member_removed:" + botID.String(), "group:member_banned:", "group:member_unbanned:"} {
		if systemMessages(t, pool, group, prefix) == 0 {
			t.Fatalf("no %s notice", prefix)
		}
	}
	var actions int
	_ = pool.QueryRow(ctx, `SELECT COUNT(DISTINCT action) FROM bot_audit WHERE chat_id = $1 AND action LIKE 'mod.%'`, group).Scan(&actions)
	if actions != 5 { // mute, unmute, delete_message, kick, ban
		t.Fatalf("audit has %d moderation actions, want 5", actions)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
