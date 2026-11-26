package bots

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// Interactive messages (#325). Buttons, menus, forms and cards live inside
// the end-to-end encrypted body, so the server never sees them; what it adds
// is the plumbing: a person's click reaches the bot (an `interaction` update,
// also in a direct chat with it), and a bot can answer one person alone.

// EventEphemeral is the realtime event an ephemeral reply arrives as.
const EventEphemeral = "bot.ephemeral"

var ErrNotMember = errors.New("not_chat_member")

// EphemeralRequest is a reply only `user_id` sees: a pairwise envelope for
// that person, pushed live and never stored.
type EphemeralRequest struct {
	UserID  uuid.UUID `json:"user_id" binding:"required"`
	Content string    `json:"content" binding:"required"`
}

// reachable is true when the bot is installed in the chat with `scope`, or
// is the other side of a direct chat — where there is no installation, and
// the person talking to it is the whole audience.
func (s *Service) reachable(ctx context.Context, chatID, botID uuid.UUID, scope Scope) error {
	err := s.RequireScope(ctx, chatID, botID, scope)
	if !errors.Is(err, ErrNotInstalled) {
		return err
	}
	direct, derr := s.repo.isDirectWith(ctx, chatID, botID)
	if derr != nil {
		return derr
	}
	if direct {
		return nil
	}
	return err
}

func (r *Repository) isDirectWith(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM chats c JOIN chat_participants cp ON cp.chat_id = c.id
			WHERE c.id = $1 AND c.type = 'direct' AND cp.user_id = $2
		)
	`, chatID, userID).Scan(&ok)
	return ok, err
}

// Ephemeral pushes a bot's private reply to one member, now, and keeps
// nothing: a person who is offline does not get it, as with Discord.
func (s *Service) Ephemeral(ctx context.Context, chatID, botID uuid.UUID, req EphemeralRequest) error {
	if !validDirectEnvelope(req.Content) || req.UserID == botID {
		return ErrInvalidUpdate
	}
	if err := s.reachable(ctx, chatID, botID, ScopeSend); err != nil {
		return err
	}
	member, err := s.repo.isParticipant(ctx, chatID, req.UserID)
	if err != nil {
		return err
	}
	if !member {
		return ErrNotMember
	}
	if s.broadcaster != nil {
		s.broadcaster.PublishJSON([]uuid.UUID{req.UserID}, EventEphemeral, chatID.String(), map[string]any{
			"id":         newRequestID(),
			"chat_id":    chatID,
			"bot_id":     botID,
			"content":    req.Content,
			"created_at": time.Now().UTC(),
		})
	}
	return nil
}

// PostEphemeral: POST /bot/v1/chats/:id/ephemeral (bot).
func (c *Controller) PostEphemeral(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	var req EphemeralRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	err := c.svc.Ephemeral(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req)
	switch {
	case err == nil:
		ctx.Status(http.StatusAccepted)
	case errors.Is(err, ErrNotMember):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidUpdate):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		writeErr(ctx, err)
	}
}

// ChatInfo is what a bot may know about a chat it is in.
type ChatInfo struct {
	ID   uuid.UUID `json:"id"`
	Type string    `json:"type"`
}

// Chat tells a bot whether a chat is a group or a direct chat, which decides
// how it seals a reply (sender key or pairwise).
func (s *Service) Chat(ctx context.Context, chatID, botID uuid.UUID) (ChatInfo, error) {
	ci, err := s.repo.chatInfo(ctx, chatID, botID)
	if err != nil {
		return ChatInfo{}, err
	}
	if !ci.CallerIsInIt {
		return ChatInfo{}, ErrChatNotFound
	}
	return ChatInfo{ID: chatID, Type: ci.Type}, nil
}

// GetChat: GET /bot/v1/chats/:id (bot).
func (c *Controller) GetChat(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	info, err := c.svc.Chat(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, info)
}
