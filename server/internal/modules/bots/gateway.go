package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// The websocket gateway (#323): GET /api/bot/v1/gateway with the bot token.
//
//	server → {"op":"hello","d":{"heartbeat_interval":30000}}
//	client → {"op":"identify","d":{"intents":["command.invoked"],"resume_from":0}}
//	server → {"op":"ready","d":{"bot_id":"…","resumed":0}}
//	server → {"op":"dispatch","t":"command.invoked","s":42,"d":{…event…}}
//	client → {"op":"heartbeat"}            server → {"op":"heartbeat_ack"}
//
// `s` is the event id. A client that reconnects identifies with resume_from
// set to the last `s` it handled and gets what it missed (up to
// maxResumeEvents, within EventRetention). Events can repeat around a resume;
// a bot dedupes on `s`.

const (
	GatewayHeartbeat   = 30 * time.Second
	identifyTimeout    = 10 * time.Second
	maxGatewayConns    = 5
	maxResumeEvents    = 1000
	gatewaySendBuffer  = 256
	gatewayReadLimit   = 16 << 10
	gatewayWriteWindow = 10 * time.Second
)

// Close codes, in the 4000 range websockets leave to applications.
const (
	CloseUnknownOp       = 4000
	CloseNotIdentified   = 4001
	CloseInvalidIntents  = 4002
	CloseHeartbeatMissed = 4003
	CloseTooManyConns    = 4008
	CloseTooSlow         = 4009
)

type gwFrame struct {
	Op string          `json:"op"`
	T  string          `json:"t,omitempty"`
	S  int64           `json:"s,omitempty"`
	D  json.RawMessage `json:"d,omitempty"`
}

type identifyData struct {
	Intents    []string `json:"intents"`
	ResumeFrom int64    `json:"resume_from"`
}

// eventSource is what the gateway needs from the service, so it can be tested
// without a database.
type eventSource interface {
	EventsAfter(ctx context.Context, botID uuid.UUID, after int64, limit int) ([]Event, error)
}

// Gateway holds the live bot connections of this process and is the
// service's EventSink.
type Gateway struct {
	events    eventSource
	heartbeat time.Duration

	mu    sync.RWMutex
	conns map[uuid.UUID]map[*gwConn]struct{}
}

type gwConn struct {
	botID   uuid.UUID
	ws      *websocket.Conn
	send    chan []byte
	intents []string // set once, at identify, before the conn is registered
	closed  atomic.Bool
	once    sync.Once
}

func NewGateway(events eventSource) *Gateway {
	return &Gateway{events: events, heartbeat: GatewayHeartbeat, conns: map[uuid.UUID]map[*gwConn]struct{}{}}
}

var gatewayUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Bots are servers, not browsers: a request carrying an Origin is a page
	// trying to use a token it should not have.
	CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "" },
}

// Dispatch pushes an event to the bot's connections that want it. A
// connection whose buffer is full is closed rather than silently skipped, so
// the bot knows to resume instead of believing it saw everything.
func (g *Gateway) Dispatch(botID uuid.UUID, ev Event) {
	frame, err := json.Marshal(gwFrame{Op: "dispatch", T: ev.Type, S: ev.ID, D: mustJSON(ev)})
	if err != nil {
		return
	}
	g.mu.RLock()
	var slow []*gwConn
	for c := range g.conns[botID] {
		if !wants(c.intents, ev.Type) {
			continue
		}
		select {
		case c.send <- frame:
		default:
			slow = append(slow, c)
		}
	}
	g.mu.RUnlock()
	for _, c := range slow {
		c.close(CloseTooSlow, "send buffer full; resume")
	}
}

// Connections is how many sockets a bot has open here.
func (g *Gateway) Connections(botID uuid.UUID) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.conns[botID])
}

// Handler serves the upgrade. The bot is already authenticated by Auth.
func (g *Gateway) Handler(ctx *gin.Context) {
	botID := middleware.UserIDFrom(ctx)
	if g.Connections(botID) >= maxGatewayConns {
		ctx.JSON(http.StatusTooManyRequests, gin.H{"error": "too_many_gateway_connections"})
		return
	}
	ws, err := gatewayUpgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		return
	}
	g.serve(ws, botID)
}

func (g *Gateway) serve(ws *websocket.Conn, botID uuid.UUID) {
	c := &gwConn{botID: botID, ws: ws, send: make(chan []byte, gatewaySendBuffer)}
	ws.SetReadLimit(gatewayReadLimit)

	hello := gwFrame{Op: "hello", D: mustJSON(map[string]int64{"heartbeat_interval": g.heartbeat.Milliseconds()})}
	if err := g.writeNow(ws, hello); err != nil {
		_ = ws.Close()
		return
	}

	_ = ws.SetReadDeadline(time.Now().Add(identifyTimeout))
	var first gwFrame
	if err := ws.ReadJSON(&first); err != nil || first.Op != "identify" {
		closeWS(ws, CloseNotIdentified, "identify first")
		return
	}
	var id identifyData
	if len(first.D) > 0 {
		if err := json.Unmarshal(first.D, &id); err != nil {
			closeWS(ws, CloseNotIdentified, "bad identify")
			return
		}
	}
	intents, err := normalizeIntents(id.Intents)
	if err != nil {
		closeWS(ws, CloseInvalidIntents, err.Error())
		return
	}
	c.intents = intents

	// Registered before the replay is read, so nothing emitted in between
	// is lost; it may arrive twice instead, which `s` lets the bot drop.
	if !g.register(c) {
		closeWS(ws, CloseTooManyConns, "too many connections")
		return
	}
	defer g.unregister(c)

	go g.writePump(c)

	var resumed int
	if id.ResumeFrom > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		missed, err := g.events.EventsAfter(ctx, botID, id.ResumeFrom, maxResumeEvents)
		cancel()
		if err == nil {
			for _, ev := range missed {
				if !wants(intents, ev.Type) {
					continue
				}
				frame, _ := json.Marshal(gwFrame{Op: "dispatch", T: ev.Type, S: ev.ID, D: mustJSON(ev)})
				if !c.enqueue(frame) {
					return
				}
				resumed++
			}
		}
	}
	ready, _ := json.Marshal(gwFrame{Op: "ready", D: mustJSON(map[string]any{"bot_id": botID, "resumed": resumed})})
	if !c.enqueue(ready) {
		return
	}

	g.readPump(c)
}

func (g *Gateway) readPump(c *gwConn) {
	deadline := 2*g.heartbeat + 10*time.Second
	ack, _ := json.Marshal(gwFrame{Op: "heartbeat_ack"})
	for {
		_ = c.ws.SetReadDeadline(time.Now().Add(deadline))
		var f gwFrame
		if err := c.ws.ReadJSON(&f); err != nil {
			if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
				c.close(CloseHeartbeatMissed, "heartbeat missed")
			} else {
				c.close(websocket.CloseNormalClosure, "")
			}
			return
		}
		switch f.Op {
		case "heartbeat":
			if !c.enqueue(ack) {
				return
			}
		default:
			c.close(CloseUnknownOp, "unknown op")
			return
		}
	}
}

func (g *Gateway) writePump(c *gwConn) {
	ping := time.NewTicker(g.heartbeat)
	defer ping.Stop()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(gatewayWriteWindow))
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.close(websocket.CloseAbnormalClosure, "")
				return
			}
		case <-ping.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(gatewayWriteWindow))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.close(websocket.CloseAbnormalClosure, "")
				return
			}
		}
	}
}

func (g *Gateway) register(c *gwConn) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.conns[c.botID]) >= maxGatewayConns {
		return false
	}
	if g.conns[c.botID] == nil {
		g.conns[c.botID] = map[*gwConn]struct{}{}
	}
	g.conns[c.botID][c] = struct{}{}
	return true
}

func (g *Gateway) unregister(c *gwConn) {
	g.mu.Lock()
	if set := g.conns[c.botID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(g.conns, c.botID)
		}
	}
	g.mu.Unlock()
	c.close(websocket.CloseNormalClosure, "")
}

// enqueue queues a frame without blocking; false means the conn is gone.
func (c *gwConn) enqueue(frame []byte) bool {
	if c.closed.Load() {
		return false
	}
	select {
	case c.send <- frame:
		return true
	default:
		c.close(CloseTooSlow, "send buffer full; resume")
		return false
	}
}

func (c *gwConn) close(code int, reason string) {
	c.once.Do(func() {
		c.closed.Store(true)
		closeWS(c.ws, code, reason)
	})
}

func (g *Gateway) writeNow(ws *websocket.Conn, f gwFrame) error {
	_ = ws.SetWriteDeadline(time.Now().Add(gatewayWriteWindow))
	return ws.WriteJSON(f)
}

// closeWS uses WriteControl, the one write gorilla allows alongside the
// write pump.
func closeWS(ws *websocket.Conn, code int, reason string) {
	_ = ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
	_ = ws.Close()
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}
