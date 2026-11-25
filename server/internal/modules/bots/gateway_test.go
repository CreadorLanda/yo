package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type fakeEvents struct{ list []Event }

func (f fakeEvents) EventsAfter(_ context.Context, _ uuid.UUID, after int64, limit int) ([]Event, error) {
	out := []Event{}
	for _, e := range f.list {
		if e.ID > after && len(out) < limit {
			out = append(out, e)
		}
	}
	return out, nil
}

func ev(id int64, typ string) Event {
	return Event{ID: id, Type: typ, Data: json.RawMessage(`{}`), CreatedAt: time.Now()}
}

// gatewayServer serves the gateway for one fixed bot, skipping token auth.
func gatewayServer(t *testing.T, g *Gateway, bot uuid.UUID) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := gatewayUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		g.serve(ws, bot)
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func read(t *testing.T, c *websocket.Conn) gwFrame {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var f gwFrame
	if err := c.ReadJSON(&f); err != nil {
		t.Fatalf("read: %v", err)
	}
	return f
}

func identify(t *testing.T, c *websocket.Conn, d identifyData) {
	t.Helper()
	raw, _ := json.Marshal(d)
	if err := c.WriteJSON(gwFrame{Op: "identify", D: raw}); err != nil {
		t.Fatal(err)
	}
}

func waitConns(t *testing.T, g *Gateway, bot uuid.UUID, n int) {
	t.Helper()
	for i := 0; i < 100 && g.Connections(bot) != n; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if g.Connections(bot) != n {
		t.Fatalf("connections = %d, want %d", g.Connections(bot), n)
	}
}

func TestGatewayHelloIdentifyDispatchHeartbeat(t *testing.T) {
	bot := uuid.New()
	g := NewGateway(fakeEvents{})
	c := dial(t, gatewayServer(t, g, bot))

	hello := read(t, c)
	if hello.Op != "hello" || !strings.Contains(string(hello.D), "heartbeat_interval") {
		t.Fatalf("hello: %+v", hello)
	}
	identify(t, c, identifyData{Intents: []string{EventCommandInvoked}})
	if f := read(t, c); f.Op != "ready" {
		t.Fatalf("want ready, got %+v", f)
	}
	waitConns(t, g, bot, 1)

	// An event outside the intents is not sent; the next one is.
	g.Dispatch(bot, ev(7, EventMessageCreated))
	g.Dispatch(bot, ev(8, EventCommandInvoked))
	f := read(t, c)
	if f.Op != "dispatch" || f.T != EventCommandInvoked || f.S != 8 {
		t.Fatalf("dispatch: %+v", f)
	}
	// Another bot's events never reach this connection.
	g.Dispatch(uuid.New(), ev(9, EventCommandInvoked))

	if err := c.WriteJSON(gwFrame{Op: "heartbeat"}); err != nil {
		t.Fatal(err)
	}
	if f := read(t, c); f.Op != "heartbeat_ack" {
		t.Fatalf("want heartbeat_ack, got %+v", f)
	}
}

func TestGatewayResumeReplaysMissedEvents(t *testing.T) {
	bot := uuid.New()
	g := NewGateway(fakeEvents{list: []Event{ev(1, EventPing), ev(2, EventCommandInvoked), ev(3, EventBotInstalled), ev(4, EventCommandInvoked)}})
	c := dial(t, gatewayServer(t, g, bot))
	read(t, c) // hello
	identify(t, c, identifyData{Intents: []string{EventCommandInvoked}, ResumeFrom: 2})

	f := read(t, c)
	if f.Op != "dispatch" || f.S != 4 {
		t.Fatalf("resume should replay event 4 only, got %+v", f)
	}
	ready := read(t, c)
	if ready.Op != "ready" || !strings.Contains(string(ready.D), `"resumed":1`) {
		t.Fatalf("ready after resume: %+v", ready)
	}
}

func TestGatewayRejectsBadIdentify(t *testing.T) {
	bot := uuid.New()
	g := NewGateway(fakeEvents{})
	url := gatewayServer(t, g, bot)

	cases := []struct {
		name  string
		frame gwFrame
		code  int
	}{
		{"not identify", gwFrame{Op: "heartbeat"}, CloseNotIdentified},
		{"unknown intent", gwFrame{Op: "identify", D: json.RawMessage(`{"intents":["message.new"]}`)}, CloseInvalidIntents},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := dial(t, url)
			read(t, c) // hello
			_ = c.WriteJSON(tc.frame)
			_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
			_, _, err := c.ReadMessage()
			ce, ok := err.(*websocket.CloseError)
			if !ok || ce.Code != tc.code {
				t.Fatalf("want close %d, got %v", tc.code, err)
			}
		})
	}
}

func TestGatewayLimitsConnectionsPerBot(t *testing.T) {
	bot := uuid.New()
	g := NewGateway(fakeEvents{})
	url := gatewayServer(t, g, bot)
	var mu sync.Mutex
	for i := 0; i < maxGatewayConns; i++ {
		c := dial(t, url)
		read(t, c)
		identify(t, c, identifyData{})
		read(t, c) // ready
	}
	waitConns(t, g, bot, maxGatewayConns)
	c := dial(t, url)
	read(t, c)
	identify(t, c, identifyData{})
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err := c.ReadMessage()
	mu.Lock()
	defer mu.Unlock()
	if ce, ok := err.(*websocket.CloseError); !ok || ce.Code != CloseTooManyConns {
		t.Fatalf("sixth connection: %v", err)
	}
}
