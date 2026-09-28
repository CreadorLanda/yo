// Package realtime is an in-process WebSocket hub for user-scoped events.
// Multi-node fan-out can later plug Redis pub/sub without changing callers.
package realtime

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
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
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" { // native clients do not send Origin
			return true
		}
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" {
			return false
		}
		if u.Host == r.Host {
			return true
		}
		host := strings.Split(u.Host, ":")[0]
		return host == "localhost" || host == "127.0.0.1" || host == "[::1]"
	},
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
	defer h.mu.Unlock()
	if h.clients[c.userID] == nil {
		h.clients[c.userID] = make(map[*client]struct{})
	}
	h.clients[c.userID][c] = struct{}{}
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.clients[c.userID]; ok {
		if _, present := set[c]; !present {
			return
		}
		delete(set, c)
		if len(set) == 0 {
			delete(h.clients, c.userID)
		}
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
	c.conn.SetReadLimit(64 << 10)
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
