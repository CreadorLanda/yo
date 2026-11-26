package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/bots"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/groups"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/keys"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/media"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/messages"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/users"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/realtime"
)

// webhookSink is a bot's webhook endpoint: it checks every signature.
type webhookSink struct {
	mu     sync.Mutex
	secret string
	types  []string
	bad    int
}

func (w *webhookSink) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	w.mu.Lock()
	defer w.mu.Unlock()
	if bots.VerifySignature(w.secret, r.Header.Get(bots.HeaderTimestamp), body, r.Header.Get(bots.HeaderSignature), time.Now()) != nil {
		w.bad++
		rw.WriteHeader(http.StatusUnauthorized)
		return
	}
	w.types = append(w.types, r.Header.Get(bots.HeaderEvent))
	rw.WriteHeader(http.StatusOK)
}

func (w *webhookSink) has(typ string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, t := range w.types {
		if t == typ {
			return true
		}
	}
	return false
}

// TestBotEventsEndToEnd is #323 over real HTTP: gateway with intents and
// resume, signed webhooks with a delivery log, and the events a bot gets from
// installs, commands, full-read group traffic and the owner's test ping.
func TestBotEventsEndToEnd(t *testing.T) {
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

	router, secret, worker := botEventsRouter(t, pool)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	worker.Start()
	t.Cleanup(worker.Stop)

	alice := testUser(t, pool, "ev_alice")
	bob := testUser(t, pool, "ev_bob")
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

	username := "ev_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_bot"
	created := asUser(alice, http.MethodPost, "/api/bots", map[string]string{"username": username, "display_name": "Events"})
	expect(created, http.StatusCreated, "create bot")
	var out struct {
		Bot   bots.Bot          `json:"bot"`
		Token bots.CreatedToken `json:"token"`
	}
	decode(t, created, &out)
	botID, botToken := out.Bot.ID, out.Token.Secret
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM bots WHERE user_id = $1`, botID) })
	botPath := "/api/bots/" + botID.String()

	// Webhook: the secret is shown once, never read back.
	sink := &webhookSink{}
	hook := httptest.NewServer(sink)
	t.Cleanup(hook.Close)
	expect(asUser(bob, http.MethodPut, botPath+"/webhook", map[string]any{"url": hook.URL}), http.StatusNotFound, "someone else's webhook")
	expect(asUser(alice, http.MethodPut, botPath+"/webhook", map[string]any{"url": hook.URL, "intents": []string{"message.new"}}),
		http.StatusBadRequest, "hub event name as intent")
	put := asUser(alice, http.MethodPut, botPath+"/webhook", map[string]any{"url": hook.URL})
	expect(put, http.StatusOK, "set webhook")
	var cfg bots.WebhookConfig
	decode(t, put, &cfg)
	if !strings.HasPrefix(cfg.Secret, "whsec_") {
		t.Fatalf("first webhook set should return the secret, got %+v", cfg)
	}
	sink.mu.Lock()
	sink.secret = cfg.Secret
	sink.mu.Unlock()
	again := asUser(alice, http.MethodPut, botPath+"/webhook", map[string]any{"url": hook.URL})
	expect(again, http.StatusOK, "set webhook again")
	var cfg2 bots.WebhookConfig
	decode(t, again, &cfg2)
	if cfg2.Secret != "" || !cfg2.HasSecret {
		t.Fatalf("the secret must not be shown twice: %+v", cfg2)
	}

	// Gateway: hello, identify, ready.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/bot/v1/gateway"
	header := http.Header{"Authorization": {"Bot " + botToken}}
	if _, resp, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("gateway without a token: err %v", err)
	}
	ws := gatewayConnect(t, wsURL, header, 0)

	// Install → bot.installed (and members.changed: the bot has members.read).
	gPath := "/api/chats/" + group.String()
	expect(asUser(alice, http.MethodPost, gPath+"/bots", map[string]any{"bot_id": botID}), http.StatusCreated, "install")
	installed := readUntil(t, ws, bots.EventBotInstalled)

	// A command addressed to the bot → command.invoked, carrying ciphertext.
	envelope := directEnvelope()
	expect(asUser(bob, http.MethodPost, gPath+"/bots/"+botID.String()+"/updates", map[string]any{
		"kind": "command", "content": envelope,
	}), http.StatusCreated, "submit command")
	cmd := readUntil(t, ws, bots.EventCommandInvoked)
	var cmdEvent bots.Event
	if err := json.Unmarshal(cmd.D, &cmdEvent); err != nil || cmdEvent.CreatedAt.Location() != time.UTC {
		t.Fatalf("event times must be UTC: %s (err %v)", cmd.D, err)
	}
	if !strings.Contains(string(cmd.D), envelope) {
		t.Fatalf("command event should carry the envelope: %s", cmd.D)
	}

	// Full read: group messages reach the bot through the tee.
	expect(asUser(alice, http.MethodPatch, gPath+"/bots/"+botID.String(), map[string]any{
		"scopes": []string{"messages.read.commands", "messages.read.all", "members.read"},
	}), http.StatusOK, "grant full read")
	time.Sleep(6 * time.Second) // past the tee's 5 s installation cache
	// Granting full read rotated the group key; bob writes in the new epoch.
	var keyEpoch int
	if err := pool.QueryRow(ctx, `SELECT key_epoch FROM chats WHERE id = $1`, group).Scan(&keyEpoch); err != nil {
		t.Fatalf("epoch: %v", err)
	}
	expect(asUser(bob, http.MethodPost, gPath+"/messages", map[string]string{"content": groupEnvelopeAt(bob, keyEpoch)}),
		http.StatusCreated, "bob writes to the group")
	readUntil(t, ws, bots.EventMessageCreated)

	// The owner's test event reaches both channels.
	expect(asUser(alice, http.MethodPost, botPath+"/test-event", nil), http.StatusAccepted, "test event")
	readUntil(t, ws, bots.EventPing)
	deadline := time.Now().Add(15 * time.Second)
	for !(sink.has(bots.EventPing) && sink.has(bots.EventCommandInvoked) && sink.has(bots.EventBotInstalled)) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if !sink.has(bots.EventPing) || !sink.has(bots.EventCommandInvoked) || !sink.has(bots.EventBotInstalled) {
		sink.mu.Lock()
		t.Fatalf("webhook got %v (bad signatures %d)", sink.types, sink.bad)
	}
	if sink.bad != 0 {
		t.Fatalf("%d webhook deliveries had a bad signature", sink.bad)
	}

	// Delivery log.
	logResp := asUser(alice, http.MethodGet, botPath+"/deliveries", nil)
	expect(logResp, http.StatusOK, "delivery log")
	var deliveries []bots.Delivery
	decode(t, logResp, &deliveries)
	delivered := 0
	for _, d := range deliveries {
		if d.Status == "delivered" {
			delivered++
		}
	}
	if delivered < 3 {
		t.Fatalf("delivery log: %+v", deliveries)
	}

	// Resume: a new connection from the install event replays the command.
	_ = ws.Close()
	ws2 := gatewayConnectResume(t, wsURL, header, installed.S, []string{bots.EventCommandInvoked})
	if ws2.S != cmd.S {
		t.Fatalf("resume replayed s=%d, want the command s=%d", ws2.S, cmd.S)
	}

	// Removing the bot says so on its way out.
	expect(asUser(alice, http.MethodDelete, gPath+"/bots/"+botID.String(), nil), http.StatusNoContent, "uninstall")
	var removed int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM bot_events WHERE bot_id = $1 AND type = 'bot.removed'`, botID).Scan(&removed); err != nil || removed != 1 {
		t.Fatalf("bot.removed events = %d (err %v)", removed, err)
	}
}

type frame struct {
	Op string          `json:"op"`
	T  string          `json:"t"`
	S  int64           `json:"s"`
	D  json.RawMessage `json:"d"`
}

func gatewayConnect(t *testing.T, url string, header http.Header, resume int64) *websocket.Conn {
	t.Helper()
	ws, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		t.Fatalf("gateway dial: %v", err)
	}
	t.Cleanup(func() { _ = ws.Close() })
	var hello frame
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := ws.ReadJSON(&hello); err != nil || hello.Op != "hello" {
		t.Fatalf("hello: %+v %v", hello, err)
	}
	d, _ := json.Marshal(map[string]any{"intents": []string{}, "resume_from": resume})
	if err := ws.WriteJSON(map[string]any{"op": "identify", "d": json.RawMessage(d)}); err != nil {
		t.Fatal(err)
	}
	if f := readFrame(t, ws); f.Op != "ready" {
		t.Fatalf("want ready, got %+v", f)
	}
	return ws
}

// gatewayConnectResume returns the first replayed dispatch.
func gatewayConnectResume(t *testing.T, url string, header http.Header, from int64, intents []string) frame {
	t.Helper()
	ws, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		t.Fatalf("gateway dial: %v", err)
	}
	t.Cleanup(func() { _ = ws.Close() })
	readFrame(t, ws) // hello
	d, _ := json.Marshal(map[string]any{"intents": intents, "resume_from": from})
	_ = ws.WriteJSON(map[string]any{"op": "identify", "d": json.RawMessage(d)})
	f := readFrame(t, ws)
	if f.Op != "dispatch" {
		t.Fatalf("resume: want a replayed dispatch first, got %+v", f)
	}
	return f
}

func readFrame(t *testing.T, ws *websocket.Conn) frame {
	t.Helper()
	_ = ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	var f frame
	if err := ws.ReadJSON(&f); err != nil {
		t.Fatalf("gateway read: %v", err)
	}
	return f
}

// readUntil skips other events until one of `typ` arrives.
func readUntil(t *testing.T, ws *websocket.Conn, typ string) frame {
	t.Helper()
	for i := 0; i < 20; i++ {
		f := readFrame(t, ws)
		if f.Op == "dispatch" && f.T == typ {
			return f
		}
	}
	t.Fatalf("no %s event", typ)
	return frame{}
}

// groupEnvelopeAt is groupEnvelope in a given key epoch.
func groupEnvelopeAt(sender uuid.UUID, epoch int) string {
	header, _ := json.Marshal(map[string]any{"v": 1, "s": sender.String(), "e": epoch, "n": 1})
	return "soc1g." + base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString([]byte("ciphertext-placeholder"))
}

// directEnvelope is a well-formed soc1. pairwise envelope; the body is noise.
func directEnvelope() string {
	return "soc1." + base64.RawURLEncoding.EncodeToString([]byte(`{"v":1}`)) + "." +
		base64.RawURLEncoding.EncodeToString([]byte("ciphertext-"+uuid.NewString()[:8]))
}

// botEventsRouter is botTestRouter plus what #323 adds: the tee in front of
// the hub, the gateway, and a webhook worker allowed to reach localhost.
func botEventsRouter(t *testing.T, pool *pgxpool.Pool) (*gin.Engine, []byte, *bots.WebhookWorker) {
	t.Helper()
	secret := []byte("bot-events-test-secret")
	botsRepo := bots.NewRepository(pool)
	botsSvc := bots.NewService(botsRepo).WithPrivateWebhooks(true)
	gw := bots.NewGateway(botsSvc)
	worker := bots.NewWebhookWorker(botsRepo, true)
	botsSvc.WithEventSink(gw).WithWebhookWaker(worker).WithUpdateNotifier(botsSvc)
	bus := bots.NewTee(realtime.NewHub(), botsSvc)
	botsSvc.WithBroadcaster(bus)

	usersRepo := users.NewRepository(pool)
	groupsSvc := groups.NewService(groups.NewRepository(pool)).WithBroadcaster(bus)
	msgSvc := messages.NewService(messages.NewRepository(pool, ""), usersRepo, bus, nil).WithGroupPolicy(groupsSvc)
	botsSvc.WithModerator(moderator{groups: groupsSvc, messages: msgSvc})
	msgCtl := messages.NewController(msgSvc, nil, secret)
	keysCtl := keys.NewController(keys.NewService(keys.NewRepository(pool), usersRepo))
	mediaCtl := media.NewController(media.NewService(media.NewRepository(pool), t.TempDir(), 1<<20, time.Hour))
	groupsCtl := groups.NewController(groupsSvc)
	botsCtl := bots.NewController(botsSvc)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	authed := api.Group("")
	authed.Use(middleware.Auth(secret))
	bots.Register(authed, botsCtl)
	messages.Register(authed, msgCtl)
	groups.Register(authed, groupsCtl)
	mountBotAPI(api, botsSvc, botsCtl, gw, botAPIHandlers{
		keys: keysCtl, media: mediaCtl, messages: msgCtl, groups: groupsCtl,
	}, nil)
	return router, secret, worker
}
