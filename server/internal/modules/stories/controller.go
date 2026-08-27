package stories

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/yo/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller {
	return &Controller{svc: svc}
}

func (c *Controller) PostCreate(ctx *gin.Context) {
	var req CreateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	st, err := c.svc.Create(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, st)
}

func (c *Controller) GetFeed(ctx *gin.Context) {
	list, err := c.svc.Feed(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if list == nil {
		list = []Story{}
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) GetOne(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	st, err := c.svc.Get(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, st)
}

func (c *Controller) PostView(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	st, err := c.svc.View(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, st)
}

func (c *Controller) Delete(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.Delete(ctx.Request.Context(), id, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) PostReact(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req ReactRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	st, err := c.svc.React(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	// The story, not 204: the caller wants the new counts, and it just
	// changed them.
	ctx.JSON(http.StatusOK, st)
}

// GetReactionCatalogue lists the emoji a reaction may be.
func (c *Controller) GetReactionCatalogue(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, c.svc.ReactionCatalogue())
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrThreadNotFound),
		errors.Is(err, ErrCommentNotFound):
		// A thread the caller is not part of is reported as missing, not as
		// forbidden: "you may not read this" confirms it exists.
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotAuthor):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrRateLimited):
		ctx.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidKind), errors.Is(err, ErrInvalidVis),
		errors.Is(err, ErrNeedMedia), errors.Is(err, ErrEmptyCaption),
		errors.Is(err, ErrEmptyBody), errors.Is(err, ErrOwnStory),
		errors.Is(err, ErrInvalidEmoji),
		errors.Is(err, ErrCommentsDisabled), errors.Is(err, ErrAnonNotAllowed):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}

func (c *Controller) GetViewers(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	viewers, err := c.svc.Viewers(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, viewers)
}

// ── blind channel ───────────────────────────────────────────────────────────

type anonBodyRequest struct {
	Body string `json:"body"`
}

func (c *Controller) PostAnonWrite(ctx *gin.Context) {
	storyID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req anonBodyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	if err := c.svc.WriteAnon(ctx.Request.Context(), storyID,
		middleware.UserIDFrom(ctx), req.Body); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) GetAnonInbox(ctx *gin.Context) {
	threads, err := c.svc.AnonInbox(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, threads)
}

func (c *Controller) GetAnonMessages(ctx *gin.Context) {
	threadID, err := uuid.Parse(ctx.Param("tid"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	msgs, err := c.svc.AnonMessages(ctx.Request.Context(), threadID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, msgs)
}

func (c *Controller) PostAnonReply(ctx *gin.Context) {
	threadID, err := uuid.Parse(ctx.Param("tid"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req anonBodyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	msg, err := c.svc.ReplyAnon(ctx.Request.Context(), threadID,
		middleware.UserIDFrom(ctx), req.Body)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, msg)
}

func (c *Controller) PostAnonBlock(ctx *gin.Context) {
	threadID, err := uuid.Parse(ctx.Param("tid"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.BlockAnon(ctx.Request.Context(), threadID, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) PostAnonReveal(ctx *gin.Context) {
	threadID, err := uuid.Parse(ctx.Param("tid"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	chatID, err := c.svc.RevealAnon(ctx.Request.Context(), threadID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	// A chat id means both sides agreed and the thread is gone; the client
	// uses it to move the person into the real conversation.
	if chatID != uuid.Nil {
		ctx.JSON(http.StatusOK, gin.H{"chat_id": chatID.String()})
		return
	}
	ctx.Status(http.StatusNoContent)
}

// ── comments ────────────────────────────────────────────────────────────────

type addCommentRequest struct {
	Body        string `json:"body"`
	ParentID    *int64 `json:"parent_id"`
	IsAnonymous bool   `json:"is_anonymous"`
}

func (c *Controller) GetComments(ctx *gin.Context) {
	storyID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	list, err := c.svc.Comments(ctx.Request.Context(), storyID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) PostComment(ctx *gin.Context) {
	storyID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req addCommentRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	comment, err := c.svc.AddComment(ctx.Request.Context(), storyID,
		middleware.UserIDFrom(ctx), req.ParentID, req.Body, req.IsAnonymous)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, comment)
}

func (c *Controller) DeleteComment(ctx *gin.Context) {
	var id int64
	if _, err := fmt.Sscanf(ctx.Param("cid"), "%d", &id); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.DeleteComment(ctx.Request.Context(), id, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}
