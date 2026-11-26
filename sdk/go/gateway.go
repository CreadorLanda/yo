package zwosocial

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type frame struct {
	Op string          `json:"op"`
	T  string          `json:"t,omitempty"`
	S  int64           `json:"s,omitempty"`
	D  json.RawMessage `json:"d,omitempty"`
}

// runGateway keeps a gateway connection alive until ctx ends: heartbeats,
// and on any drop a reconnect with backoff (1 s → 30 s) that resumes from
// the last event handled. Events are handled one at a time, in order.
func runGateway(ctx context.Context, baseURL, token string, intents []string, resumeFrom func() int64, onEvent func(Event)) {
	wsURL := "ws" + strings.TrimPrefix(strings.TrimRight(baseURL, "/"), "http") + "/api/bot/v1/gateway"
	wait := time.Second
	for ctx.Err() == nil {
		closeCode := gatewayOnce(ctx, wsURL, token, intents, resumeFrom, onEvent, func() { wait = time.Second })
		if ctx.Err() != nil {
			return
		}
		if closeCode == 4002 {
			log.Printf("[bot] gateway refused the intents; not reconnecting")
			return
		}
		log.Printf("[bot] gateway closed (%d); reconnecting in %s", closeCode, wait)
		if sleepCtx(ctx, wait) != nil {
			return
		}
		wait = min(wait*2, 30*time.Second)
	}
}

func gatewayOnce(ctx context.Context, url, token string, intents []string, resumeFrom func() int64, onEvent func(Event), ready func()) int {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, url, http.Header{"Authorization": {"Bot " + token}})
	if err != nil {
		return 0
	}
	defer conn.Close()
	go func() {
		<-ctx.Done()
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
	}()
	var writeMu chanMutex = make(chan struct{}, 1)
	send := func(f frame) {
		writeMu.lock()
		defer writeMu.unlock()
		_ = conn.WriteJSON(f)
	}
	stopBeat := make(chan struct{})
	defer close(stopBeat)
	for {
		var f frame
		if err := conn.ReadJSON(&f); err != nil {
			if ce, ok := err.(*websocket.CloseError); ok {
				return ce.Code
			}
			return 0
		}
		switch f.Op {
		case "hello":
			var hello struct {
				HeartbeatInterval int64 `json:"heartbeat_interval"`
			}
			_ = json.Unmarshal(f.D, &hello)
			if intents == nil {
				intents = []string{}
			}
			d, _ := json.Marshal(map[string]any{"intents": intents, "resume_from": resumeFrom()})
			send(frame{Op: "identify", D: d})
			go func() {
				t := time.NewTicker(time.Duration(hello.HeartbeatInterval) * time.Millisecond)
				defer t.Stop()
				for {
					select {
					case <-stopBeat:
						return
					case <-t.C:
						send(frame{Op: "heartbeat"})
					}
				}
			}()
		case "ready":
			ready()
			log.Printf("[bot] gateway ready")
		case "dispatch":
			var e Event
			if json.Unmarshal(f.D, &e) == nil {
				onEvent(e)
			}
		}
	}
}

type chanMutex chan struct{}

func (m chanMutex) lock()   { m <- struct{}{} }
func (m chanMutex) unlock() { <-m }
