package bots

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// Tee sits between the services and the realtime hub (#323). Everything goes
// to the hub as before; what a bot installed in the chat may see is also
// turned into a bot event. Modules keep publishing to "a broadcaster" and
// never import this package.
//
// What a bot gets, by the realtime event that happened:
//   - message.new / edited / deleted / reaction → only bots with full read
//     (messages.read.all). A bot in privacy mode gets what is addressed to it
//     through its own envelopes (#322), never the group's traffic.
//   - group.members.changed → bots with members.read, as members.changed.
//
// The forwarding runs off the caller's goroutine and is bounded, so a slow
// database never holds up a message reaching people.
type Tee struct {
	inner Broadcaster
	bots  teeTarget

	sem chan struct{}

	mu    sync.Mutex
	cache map[uuid.UUID]cachedChatBots
	ttl   time.Duration
}

type teeTarget interface {
	chatBots(ctx context.Context, chatID uuid.UUID) ([]chatBot, error)
	Emit(ctx context.Context, botID uuid.UUID, typ string, chatID *uuid.UUID, data any)
}

type cachedChatBots struct {
	bots []chatBot
	at   time.Time
}

var teeRoutes = map[string]struct {
	event string
	scope Scope
}{
	"message.new":           {EventMessageCreated, ScopeReadAll},
	"message.edited":        {EventMessageUpdated, ScopeReadAll},
	"message.deleted":       {EventMessageDeleted, ScopeReadAll},
	"message.reaction":      {EventMessageReaction, ScopeReadAll},
	"group.members.changed": {EventMembersChanged, ScopeMembers},
}

func NewTee(inner Broadcaster, svc *Service) *Tee {
	return newTee(inner, svc)
}

func newTee(inner Broadcaster, bots teeTarget) *Tee {
	return &Tee{
		inner: inner,
		bots:  bots,
		sem:   make(chan struct{}, 64),
		cache: map[uuid.UUID]cachedChatBots{},
		ttl:   5 * time.Second,
	}
}

func (t *Tee) PublishJSON(userIDs []uuid.UUID, typ, chatID string, payload any) {
	t.inner.PublishJSON(userIDs, typ, chatID, payload)
	route, ok := teeRoutes[typ]
	if !ok {
		return
	}
	cid, err := uuid.Parse(chatID)
	if err != nil {
		return
	}
	select {
	case t.sem <- struct{}{}:
	default:
		// Saturated: the event is dropped for bots rather than queueing
		// without bound. A full-read bot can page history to catch up.
		log.Warn().Str("type", typ).Msg("bot tee saturated; event not forwarded")
		return
	}
	go func() {
		defer func() { <-t.sem }()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		t.forward(ctx, userIDs, cid, route.event, route.scope, payload)
	}()
}

func (t *Tee) forward(ctx context.Context, userIDs []uuid.UUID, chatID uuid.UUID, event string, scope Scope, payload any) {
	bots, err := t.chatBotsCached(ctx, chatID)
	if err != nil || len(bots) == 0 {
		return
	}
	// Only bots the event was actually addressed to: a bot removed from the
	// chat a moment ago is no longer among the recipients.
	recipients := make(map[uuid.UUID]bool, len(userIDs))
	for _, id := range userIDs {
		recipients[id] = true
	}
	// A bot can be listed twice (a direct chat with it also has an
	// installation row); it gets each event once.
	sent := map[uuid.UUID]bool{}
	for _, b := range bots {
		if sent[b.BotID] || !recipients[b.BotID] || !hasScope(b.Scopes, scope) {
			continue
		}
		sent[b.BotID] = true
		t.bots.Emit(ctx, b.BotID, event, &chatID, payload)
	}
}

func (t *Tee) chatBotsCached(ctx context.Context, chatID uuid.UUID) ([]chatBot, error) {
	t.mu.Lock()
	if c, ok := t.cache[chatID]; ok && time.Since(c.at) < t.ttl {
		t.mu.Unlock()
		return c.bots, nil
	}
	t.mu.Unlock()
	bots, err := t.bots.chatBots(ctx, chatID)
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	if len(t.cache) > 10_000 {
		t.cache = map[uuid.UUID]cachedChatBots{}
	}
	t.cache[chatID] = cachedChatBots{bots: bots, at: time.Now()}
	t.mu.Unlock()
	return bots, nil
}

// Online passes through to the hub, for callers that decide on push by it.
func (t *Tee) Online(userID uuid.UUID) bool {
	if o, ok := t.inner.(interface{ Online(uuid.UUID) bool }); ok {
		return o.Online(userID)
	}
	return false
}
