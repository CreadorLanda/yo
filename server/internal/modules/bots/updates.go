package bots

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// UpdateKind is why a bot was sent an envelope.
type UpdateKind string

const (
	UpdateCommand     UpdateKind = "command"
	UpdateMention     UpdateKind = "mention"
	UpdateReply       UpdateKind = "reply"
	UpdateInteraction UpdateKind = "interaction"
)

const (
	maxUpdateBytes  = 64 * 1024
	maxUpdatesBatch = 100
	// UpdateRetention is how long an uncollected update waits. A bot that is
	// down for longer misses them, the way a webhook that never answers does.
	UpdateRetention = 7 * 24 * time.Hour
)

var (
	ErrInvalidUpdate  = errors.New("invalid_bot_update")
	ErrNotParticipant = errors.New("not_participant")
)

// Update is one envelope addressed to a bot.
type Update struct {
	ID        int64      `json:"update_id"`
	ChatID    uuid.UUID  `json:"chat_id"`
	SenderID  uuid.UUID  `json:"sender_id"`
	Kind      UpdateKind `json:"kind"`
	Content   string     `json:"content"`
	MessageID *int64     `json:"message_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// SubmitUpdateRequest is a person's client handing a bot its envelope.
type SubmitUpdateRequest struct {
	Kind      UpdateKind `json:"kind" binding:"required"`
	Content   string     `json:"content" binding:"required"`
	MessageID *int64     `json:"message_id"`
}

func validUpdateKind(k UpdateKind) bool {
	switch k {
	case UpdateCommand, UpdateMention, UpdateReply, UpdateInteraction:
		return true
	}
	return false
}

// validDirectEnvelope checks shape only, the same promise the messages
// module makes: a pairwise `soc1.<header>.<body>` the server never opens.
func validDirectEnvelope(content string) bool {
	if len(content) == 0 || len(content) > maxUpdateBytes || !strings.HasPrefix(content, "soc1.") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(content, "soc1."), ".")
	return len(parts) == 2 && parts[0] != "" && parts[1] != ""
}

// ── Repository ──────────────────────────────────────────────────────────────

func (r *Repository) InsertUpdate(ctx context.Context, botID, chatID, sender uuid.UUID, req SubmitUpdateRequest) (int64, error) {
	var id int64
	err := r.db.QueryRow(ctx, `
		INSERT INTO bot_updates (bot_id, chat_id, sender_id, kind, content, message_id)
		SELECT $1, $2, $3, $4, $5,
		       (SELECT id FROM messages WHERE id = $6 AND chat_id = $2)
		RETURNING id
	`, botID, chatID, sender, string(req.Kind), req.Content, req.MessageID).Scan(&id)
	return id, err
}

// Updates returns what is waiting after `offset`, and drops what the bot has
// confirmed by asking past it — the getUpdates contract.
func (r *Repository) Updates(ctx context.Context, botID uuid.UUID, offset int64, limit int) ([]Update, error) {
	if offset > 0 {
		if _, err := r.db.Exec(ctx, `DELETE FROM bot_updates WHERE bot_id = $1 AND id < $2`, botID, offset); err != nil {
			return nil, err
		}
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, chat_id, sender_id, kind, content, message_id, created_at
		FROM bot_updates
		WHERE bot_id = $1 AND id >= $2 AND created_at > NOW() - $4::interval
		ORDER BY id
		LIMIT $3
	`, botID, offset, limit, UpdateRetention.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Update{}
	for rows.Next() {
		var u Update
		var kind string
		if err := rows.Scan(&u.ID, &u.ChatID, &u.SenderID, &kind, &u.Content, &u.MessageID, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Kind = UpdateKind(kind)
		out = append(out, u)
	}
	return out, rows.Err()
}

// PurgeExpiredUpdates drops what no bot collected in time.
func (r *Repository) PurgeExpiredUpdates(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM bot_updates WHERE created_at < NOW() - $1::interval`, UpdateRetention.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *Repository) isParticipant(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2)
	`, chatID, userID).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return ok, err
}

// ── Service ─────────────────────────────────────────────────────────────────

// UpdateNotifier tells a bot something is waiting. The gateway and webhooks
// (#323) plug in here; until then a bot polls.
type UpdateNotifier interface {
	BotUpdate(ctx context.Context, botID uuid.UUID, updateID int64)
}

func (s *Service) WithUpdateNotifier(n UpdateNotifier) *Service {
	s.notifier = n
	return s
}

// SubmitUpdate stores an envelope a person's client addressed to a bot.
//
// The sender must be in the chat, and the bot installed there with
// messages.read.commands. A bot with full read already reads the group
// message itself; it is not sent a second copy.
func (s *Service) SubmitUpdate(ctx context.Context, chatID, botID, sender uuid.UUID, req SubmitUpdateRequest) (int64, error) {
	if !validUpdateKind(req.Kind) || !validDirectEnvelope(req.Content) || sender == botID {
		return 0, ErrInvalidUpdate
	}
	ok, err := s.repo.isParticipant(ctx, chatID, sender)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, ErrChatNotFound
	}
	if err := s.RequireScope(ctx, chatID, botID, ScopeReadCommands); err != nil {
		return 0, err
	}
	id, err := s.repo.InsertUpdate(ctx, botID, chatID, sender, req)
	if err != nil {
		return 0, err
	}
	if s.notifier != nil {
		s.notifier.BotUpdate(ctx, botID, id)
	}
	return id, nil
}

// PurgeExpiredUpdates is run periodically by the server.
func (s *Service) PurgeExpiredUpdates(ctx context.Context) (int64, error) {
	return s.repo.PurgeExpiredUpdates(ctx)
}

func (s *Service) Updates(ctx context.Context, botID uuid.UUID, offset int64, limit int) ([]Update, error) {
	if limit <= 0 || limit > maxUpdatesBatch {
		limit = maxUpdatesBatch
	}
	return s.repo.Updates(ctx, botID, offset, limit)
}

// ── Controller ──────────────────────────────────────────────────────────────

// PostChatBotUpdate: POST /chats/:id/bots/:botId/updates (person).
func (c *Controller) PostChatBotUpdate(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	botID, ok := paramUUID(ctx, "botId")
	if !ok {
		return
	}
	var req SubmitUpdateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	id, err := c.svc.SubmitUpdate(ctx.Request.Context(), chatID, botID, middleware.UserIDFrom(ctx), req)
	if err != nil {
		if errors.Is(err, ErrInvalidUpdate) {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, gin.H{"update_id": id})
}

// GetUpdates: GET /bot/v1/updates?offset=&limit= (bot). Asking with an
// offset confirms everything before it.
func (c *Controller) GetUpdates(ctx *gin.Context) {
	var offset int64
	if raw := ctx.Query("offset"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offset"})
			return
		}
		offset = v
	}
	limit := 0
	if raw := ctx.Query("limit"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_limit"})
			return
		}
		limit = v
	}
	list, err := c.svc.Updates(ctx.Request.Context(), middleware.UserIDFrom(ctx), offset, limit)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}
