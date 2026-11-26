package bots

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// Moderation by a bot (#333). A group's admins allow it by granting
// members.manage, which the group is told about. The bot can then mute,
// remove, ban and unban plain members and delete their messages — never an
// admin's or a moderator's. Every action is in the group's bot activity.

var (
	ErrCannotModerate  = errors.New("cannot_moderate_admin")
	ErrInvalidMute     = errors.New("invalid_mute")
	ErrMessageNotFound = errors.New("message_not_found")
)

// Moderator does the work; server.go wires it to the groups and messages
// modules and translates their errors into the ones above.
type Moderator interface {
	Mute(ctx context.Context, chatID, actor, target uuid.UUID, until time.Time) error
	Unmute(ctx context.Context, chatID, actor, target uuid.UUID) error
	Kick(ctx context.Context, chatID, actor, target uuid.UUID) error
	Ban(ctx context.Context, chatID, actor, target uuid.UUID, reason string) error
	Unban(ctx context.Context, chatID, actor, target uuid.UUID) error
	DeleteMessage(ctx context.Context, chatID uuid.UUID, messageID int64) error
}

const (
	AuditModMute      = "mod.mute"
	AuditModUnmute    = "mod.unmute"
	AuditModKick      = "mod.kick"
	AuditModBan       = "mod.ban"
	AuditModUnban     = "mod.unban"
	AuditModDelete    = "mod.delete_message"
	AuditModerateOn   = "bot.moderate_on"
	AuditModerateOff  = "bot.moderate_off"
	maxMuteSeconds    = 30 * 24 * 3600
	maxModReasonBytes = 500
)

// WithModerator enables the moderation endpoints.
func (s *Service) WithModerator(m Moderator) *Service {
	s.moderator = m
	return s
}

type modRequest struct {
	Seconds int    `json:"seconds"`
	Reason  string `json:"reason"`
}

func (c *Controller) moderate(ctx *gin.Context, action string) {
	if c.svc.moderator == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "moderation_unavailable"})
		return
	}
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	bot := middleware.UserIDFrom(ctx)
	var req modRequest
	if ctx.Request.ContentLength > 0 {
		if err := ctx.ShouldBindJSON(&req); err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
			return
		}
	}
	if len(req.Reason) > maxModReasonBytes {
		req.Reason = req.Reason[:maxModReasonBytes]
	}
	rctx := ctx.Request.Context()
	detail := map[string]any{}
	if req.Reason != "" {
		detail["reason"] = req.Reason
	}
	var err error
	if action == AuditModDelete {
		mid, perr := strconv.ParseInt(ctx.Param("mid"), 10, 64)
		if perr != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_message_id"})
			return
		}
		detail["message_id"] = mid
		err = c.svc.moderator.DeleteMessage(rctx, chatID, mid)
	} else {
		target, ok := paramUUID(ctx, "uid")
		if !ok {
			return
		}
		detail["target"] = target
		switch action {
		case AuditModMute:
			if req.Seconds < 60 || req.Seconds > maxMuteSeconds {
				ctx.JSON(http.StatusBadRequest, gin.H{"error": ErrInvalidMute.Error(), "detail": "seconds must be 60 to 2592000"})
				return
			}
			until := time.Now().UTC().Add(time.Duration(req.Seconds) * time.Second)
			detail["until"] = until
			err = c.svc.moderator.Mute(rctx, chatID, bot, target, until)
		case AuditModUnmute:
			err = c.svc.moderator.Unmute(rctx, chatID, bot, target)
		case AuditModKick:
			err = c.svc.moderator.Kick(rctx, chatID, bot, target)
		case AuditModBan:
			err = c.svc.moderator.Ban(rctx, chatID, bot, target, req.Reason)
		case AuditModUnban:
			err = c.svc.moderator.Unban(rctx, chatID, bot, target)
		}
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrCannotModerate):
			ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case errors.Is(err, ErrInvalidMute):
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrNotMember), errors.Is(err, ErrMessageNotFound), errors.Is(err, ErrChatNotFound):
			ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			writeErr(ctx, err)
		}
		return
	}
	c.svc.repo.addAudit(rctx, chatID, nil, &bot, action, detail)
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) PostMute(ctx *gin.Context)         { c.moderate(ctx, AuditModMute) }
func (c *Controller) DeleteMute(ctx *gin.Context)       { c.moderate(ctx, AuditModUnmute) }
func (c *Controller) PostKick(ctx *gin.Context)         { c.moderate(ctx, AuditModKick) }
func (c *Controller) PostBan(ctx *gin.Context)          { c.moderate(ctx, AuditModBan) }
func (c *Controller) DeleteBan(ctx *gin.Context)        { c.moderate(ctx, AuditModUnban) }
func (c *Controller) DeleteModMessage(ctx *gin.Context) { c.moderate(ctx, AuditModDelete) }
