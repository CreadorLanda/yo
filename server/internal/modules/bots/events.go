package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// Event types a bot can receive (#323). The names are the bot API's own, not
// the realtime hub's: a bot never sees `message.new` or `group.members.changed`.
const (
	EventMessageCreated     = "message.created"
	EventMessageUpdated     = "message.updated"
	EventMessageDeleted     = "message.deleted"
	EventMessageReaction    = "message.reaction"
	EventCommandInvoked     = "command.invoked"
	EventInteractionCreated = "interaction.created"
	EventMembersChanged     = "members.changed"
	EventBotInstalled       = "bot.installed"
	EventBotRemoved         = "bot.removed"
	// EventPing is the owner's "send test event". Always delivered.
	EventPing = "ping"
)

var knownEvents = map[string]bool{
	EventMessageCreated: true, EventMessageUpdated: true, EventMessageDeleted: true,
	EventMessageReaction: true, EventCommandInvoked: true, EventInteractionCreated: true,
	EventMembersChanged: true, EventBotInstalled: true, EventBotRemoved: true, EventPing: true,
}

// EventRetention is how long an event can be resumed or retried.
const EventRetention = 7 * 24 * time.Hour

var ErrInvalidIntent = errors.New("invalid_intent")

// Event is what a bot receives, over the gateway or in a webhook body. `ID`
// is the sequence a gateway connection resumes from; it may arrive twice
// (a resume, a retried webhook), so bots dedupe on it.
type Event struct {
	ID        int64           `json:"id"`
	Type      string          `json:"type"`
	ChatID    *uuid.UUID      `json:"chat_id,omitempty"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"created_at"`
}

func normalizeIntents(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range in {
		if !knownEvents[t] {
			return nil, fmt.Errorf("%w: %s", ErrInvalidIntent, t)
		}
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out, nil
}

// wants reports whether a subscription with `intents` takes `typ`. No
// intents means everything; a ping always goes through.
func wants(intents []string, typ string) bool {
	if len(intents) == 0 || typ == EventPing {
		return true
	}
	for _, t := range intents {
		if t == typ {
			return true
		}
	}
	return false
}

// ── Repository ──────────────────────────────────────────────────────────────

// InsertEvent records an event and reports whether the bot's webhook wants
// it, in one round trip; the delivery row is queued in the same statement.
func (r *Repository) InsertEvent(ctx context.Context, botID uuid.UUID, typ string, chatID *uuid.UUID, data []byte) (Event, bool, error) {
	ev := Event{Type: typ, ChatID: chatID, Data: data}
	var queued bool
	err := r.db.QueryRow(ctx, `
		WITH e AS (
			INSERT INTO bot_events (bot_id, type, chat_id, payload)
			VALUES ($1, $2, $3, $4::jsonb)
			RETURNING id, created_at
		), d AS (
			INSERT INTO bot_deliveries (event_id, bot_id)
			SELECT e.id, $1 FROM e, bots b
			WHERE b.user_id = $1
			  AND COALESCE(b.webhook_url, '') <> ''
			  AND COALESCE(b.webhook_secret, '') <> ''
			  AND (cardinality(b.intents) = 0 OR $2 = ANY(b.intents) OR $2 = 'ping')
			RETURNING id
		)
		SELECT e.id, e.created_at, EXISTS(SELECT 1 FROM d) FROM e
	`, botID, typ, chatID, string(data)).Scan(&ev.ID, &ev.CreatedAt, &queued)
	ev.CreatedAt = ev.CreatedAt.UTC()
	return ev, queued, err
}

// EventsAfter is what a resuming gateway connection missed, oldest first.
func (r *Repository) EventsAfter(ctx context.Context, botID uuid.UUID, after int64, limit int) ([]Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, type, chat_id, payload, created_at
		FROM bot_events
		WHERE bot_id = $1 AND id > $2 AND created_at > NOW() - $4::interval
		ORDER BY id
		LIMIT $3
	`, botID, after, limit, EventRetention.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var ev Event
		var data []byte
		if err := rows.Scan(&ev.ID, &ev.Type, &ev.ChatID, &data, &ev.CreatedAt); err != nil {
			return nil, err
		}
		ev.Data = data
		ev.CreatedAt = ev.CreatedAt.UTC()
		out = append(out, ev)
	}
	return out, rows.Err()
}

// PurgeExpiredEvents drops events (and their deliveries) past retention.
func (r *Repository) PurgeExpiredEvents(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM bot_events WHERE created_at < NOW() - $1::interval`, EventRetention.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// chatBot is a bot installed in a chat, as the tee needs it.
type chatBot struct {
	BotID  uuid.UUID
	Scopes []Scope
}

func (r *Repository) chatBots(ctx context.Context, chatID uuid.UUID) ([]chatBot, error) {
	rows, err := r.db.Query(ctx, `SELECT bot_id, scopes FROM bot_installations WHERE chat_id = $1`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chatBot{}
	for rows.Next() {
		var cb chatBot
		var scopes []string
		if err := rows.Scan(&cb.BotID, &scopes); err != nil {
			return nil, err
		}
		cb.Scopes = toScopes(scopes)
		out = append(out, cb)
	}
	return out, rows.Err()
}

func (r *Repository) update(ctx context.Context, botID uuid.UUID, id int64) (Update, error) {
	var u Update
	var kind string
	err := r.db.QueryRow(ctx, `
		SELECT id, chat_id, sender_id, kind, content, message_id, created_at
		FROM bot_updates WHERE id = $1 AND bot_id = $2
	`, id, botID).Scan(&u.ID, &u.ChatID, &u.SenderID, &kind, &u.Content, &u.MessageID, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Update{}, ErrNotFound
	}
	u.Kind = UpdateKind(kind)
	u.CreatedAt = u.CreatedAt.UTC()
	return u, err
}

// ── Service ─────────────────────────────────────────────────────────────────

// EventSink is where a new event goes live: the gateway's connections and
// the webhook worker's wake-up. Both are optional, so tests run without them.
type EventSink interface {
	Dispatch(botID uuid.UUID, ev Event)
}

type waker interface{ Wake() }

func (s *Service) WithEventSink(sink EventSink) *Service {
	s.sink = sink
	return s
}

func (s *Service) WithWebhookWaker(w waker) *Service {
	s.waker = w
	return s
}

// Emit records an event for a bot and sends it on its way. It never fails the
// caller's request: an event that cannot be written is logged and dropped,
// the way a realtime push to an offline client is.
func (s *Service) Emit(ctx context.Context, botID uuid.UUID, typ string, chatID *uuid.UUID, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	ev, queued, err := s.repo.InsertEvent(ctx, botID, typ, chatID, raw)
	if err != nil {
		log.Warn().Err(err).Str("bot", botID.String()).Str("type", typ).Msg("bot event not recorded")
		return
	}
	if s.sink != nil {
		s.sink.Dispatch(botID, ev)
	}
	if queued && s.waker != nil {
		s.waker.Wake()
	}
}

// BotUpdate turns an envelope addressed to a bot (#322) into its event. It
// satisfies UpdateNotifier, which SubmitUpdate calls.
func (s *Service) BotUpdate(ctx context.Context, botID uuid.UUID, updateID int64) {
	u, err := s.repo.update(ctx, botID, updateID)
	if err != nil {
		return
	}
	typ := EventMessageCreated
	switch u.Kind {
	case UpdateCommand:
		typ = EventCommandInvoked
	case UpdateInteraction:
		typ = EventInteractionCreated
	}
	chat := u.ChatID
	s.Emit(ctx, botID, typ, &chat, u)
}

// EventsAfter is for the gateway's resume.
func (s *Service) EventsAfter(ctx context.Context, botID uuid.UUID, after int64, limit int) ([]Event, error) {
	return s.repo.EventsAfter(ctx, botID, after, limit)
}

// PurgeExpiredEvents is run by the sweeper.
func (s *Service) PurgeExpiredEvents(ctx context.Context) (int64, error) {
	return s.repo.PurgeExpiredEvents(ctx)
}

// ChatBots is the installed bots of a chat, for the tee.
func (s *Service) chatBots(ctx context.Context, chatID uuid.UUID) ([]chatBot, error) {
	return s.repo.chatBots(ctx, chatID)
}
