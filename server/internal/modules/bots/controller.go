package bots

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller {
	return &Controller{svc: svc}
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrChatNotFound), errors.Is(err, ErrNotInstalled):
		ctx.JSON(http.StatusNotFound, gin.H{"error": rootErr(err)})
	case errors.Is(err, ErrNotOwner), errors.Is(err, ErrNotGroupAdmin), errors.Is(err, ErrScopeMissing):
		ctx.JSON(http.StatusForbidden, gin.H{"error": rootErr(err)})
	case errors.Is(err, ErrUsernameTaken), errors.Is(err, ErrAlreadyInstalled):
		ctx.JSON(http.StatusConflict, gin.H{"error": rootErr(err)})
	case errors.Is(err, ErrInvalidUsername), errors.Is(err, ErrInvalidName),
		errors.Is(err, ErrDescriptionLong), errors.Is(err, ErrTooManyBots),
		errors.Is(err, ErrInvalidScope), errors.Is(err, ErrChatNotSupported):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}

// rootErr is the sentinel's code, without any wrapped detail.
func rootErr(err error) string {
	for _, s := range []error{ErrNotFound, ErrChatNotFound, ErrNotInstalled, ErrNotOwner,
		ErrNotGroupAdmin, ErrScopeMissing, ErrUsernameTaken, ErrAlreadyInstalled} {
		if errors.Is(err, s) {
			return s.Error()
		}
	}
	return err.Error()
}

func paramUUID(ctx *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(ctx.Param(name))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_" + name})
		return uuid.Nil, false
	}
	return id, true
}

// ── Owner ───────────────────────────────────────────────────────────────────

func (c *Controller) PostBot(ctx *gin.Context) {
	var req CreateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	bot, tok, err := c.svc.Create(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, gin.H{"bot": bot, "token": tok})
}

func (c *Controller) GetMine(ctx *gin.Context) {
	list, err := c.svc.ListMine(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// GetBot is a bot's public profile, by id or @username.
func (c *Controller) GetBot(ctx *gin.Context) {
	bot, err := c.svc.Public(ctx.Request.Context(), ctx.Param("id"))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, bot)
}

func (c *Controller) PatchBot(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	var req UpdateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	bot, err := c.svc.Update(ctx.Request.Context(), middleware.UserIDFrom(ctx), id, req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, bot)
}

func (c *Controller) DeleteBot(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	if err := c.svc.Delete(ctx.Request.Context(), middleware.UserIDFrom(ctx), id); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) GetTokens(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.ListTokens(ctx.Request.Context(), middleware.UserIDFrom(ctx), id)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// PostToken rotates: a new secret, and every previous one revoked.
func (c *Controller) PostToken(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	tok, err := c.svc.RotateToken(ctx.Request.Context(), middleware.UserIDFrom(ctx), id)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, tok)
}

func (c *Controller) DeleteTokens(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	if err := c.svc.RevokeTokens(ctx.Request.Context(), middleware.UserIDFrom(ctx), id); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// PostDirect opens (or returns) the caller's direct chat with a bot.
func (c *Controller) PostDirect(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	chatID, created, err := c.svc.OpenDirect(ctx.Request.Context(), middleware.UserIDFrom(ctx), id)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	ctx.JSON(status, gin.H{"chat_id": chatID})
}

// ── Chat installs ───────────────────────────────────────────────────────────

func (c *Controller) GetChatBots(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.ListForChat(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) PostChatBot(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	var req InstallRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	inst, err := c.svc.Install(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, inst)
}

func (c *Controller) PatchChatBot(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	botID, ok := paramUUID(ctx, "botId")
	if !ok {
		return
	}
	var req ScopesRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	inst, err := c.svc.UpdateScopes(ctx.Request.Context(), chatID, botID, middleware.UserIDFrom(ctx), req.Scopes)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, inst)
}

func (c *Controller) DeleteChatBot(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	botID, ok := paramUUID(ctx, "botId")
	if !ok {
		return
	}
	if err := c.svc.Uninstall(ctx.Request.Context(), chatID, botID, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// ── Bot API ─────────────────────────────────────────────────────────────────

func (c *Controller) GetMe(ctx *gin.Context) {
	bot, err := c.svc.Me(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, bot)
}

func (c *Controller) GetMembers(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.Members(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}
