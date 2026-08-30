// Package realtime is an in-process WebSocket hub for user-scoped events.
// Multi-node fan-out can later plug Redis pub/sub without changing callers.
package realtime

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

// Event is the envelope pushed to connected clients.
type Event struct {
	Type    string          `json:"type"`
	ChatID  string          `json:"chat_id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Hub tracks active WS connections keyed by user id.
type Hub struct {
	mu      sync.RWMutex
	clients map[uuid.UUID]map[*client]struct{}

	// OnPresenceChange, when set, is called as a user's *first* connection
	// opens and as their *last* one closes — not once per socket. A phone
	// and a laptop are one person being present.
	//
	// Called outside the lock: it reaches a database, and holding the hub's
	// mutex across that would stall every publish in the process.
	OnPresenceChange func(userID uuid.UUID, online bool)
}

type client struct {
	userID uuid.UUID
	conn   *websocket.Conn
	send   chan []byte
	hub    *Hub
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Mobile/dev clients may open from different origins; auth is the real gate.
	CheckOrigin: func(r *http.Request) bool { return true },
}

func NewHub() *Hub {
	return &Hub{clients: make(map[uuid.UUID]map[*client]struct{})}
}

// Publish sends an event to every open connection for the given users.
func (h *Hub) Publish(userIDs []uuid.UUID, ev Event) {
	raw, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, uid := range userIDs {
		for c := range h.clients[uid] {
			select {
			case c.send <- raw:
			default:
				// Slow client — drop rather than block the hub.
			}
		}
	}
}

// PublishJSON marshals payload and publishes.
func (h *Hub) PublishJSON(userIDs []uuid.UUID, typ, chatID string, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.Publish(userIDs, Event{Type: typ, ChatID: chatID, Payload: b})
}

// Online reports whether the user has at least one active socket.
func (h *Hub) Online(userID uuid.UUID) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}

// ServeWS upgrades the HTTP connection and registers the user.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, userID uuid.UUID) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Msg("ws upgrade failed")
		return
	}
	c := &client{
		userID: userID,
		conn:   conn,
		send:   make(chan []byte, 64),
		hub:    h,
	}
	h.register(c)

	go c.writePump()
	c.readPump()
}

func (h *Hub) register(c *client) {
	h.mu.Lock()
	if h.clients[c.userID] == nil {
		h.clients[c.userID] = make(map[*client]struct{})
	}
	first := len(h.clients[c.userID]) == 0
	h.clients[c.userID][c] = struct{}{}
	cb := h.OnPresenceChange
	h.mu.Unlock()

	if first && cb != nil {
		cb(c.userID, true)
	}
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	gone := false
	if set, ok := h.clients[c.userID]; ok {
		if _, present := set[c]; !present {
			h.mu.Unlock()
			return
		}
		delete(set, c)
		if len(set) == 0 {
			delete(h.clients, c.userID)
			gone = true
		}
	}
	cb := h.OnPresenceChange
	h.mu.Unlock()

	// Their last socket closed: this instant is what "last seen" means.
	if gone && cb != nil {
		cb(c.userID, false)
	}
	// Channel may already be closed if called twice; recover from panic.
	func() {
		defer func() { _ = recover() }()
		close(c.send)
	}()
	if c.conn != nil {
		_ = c.conn.Close()
	}
}

func (c *client) readPump() {
	defer c.hub.unregister(c)
	_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	})
	for {
		// Client→server frames are optional (typing can also be REST).
		// Drain to detect disconnects / pings.
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
