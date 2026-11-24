package posts

import (
	"errors"
	"net/http"
	"strconv"
	"time"

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

func (c *Controller) PostCreate(ctx *gin.Context) {
	var req CreateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	post, err := c.svc.Create(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, post)
}

// GetList is one author's grid: GET /posts?author=<id|me>&kind=&before=&limit=.
//
// `author` defaults to the caller. `before` is the created_at of the last
// post already shown, so paging does not shift when something new is posted.
func (c *Controller) GetList(ctx *gin.Context) {
	me := middleware.UserIDFrom(ctx)
	q := ListQuery{Author: me, Kind: Kind(ctx.Query("kind"))}
	if raw := ctx.Query("author"); raw != "" && raw != "me" {
		id, err := uuid.Parse(raw)
		if err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_author"})
			return
		}
		q.Author = id
	}
	if raw := ctx.Query("before"); raw != "" {
		at, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_before"})
			return
		}
		q.Before = at
	}
	if raw := ctx.Query("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_limit"})
			return
		}
		q.Limit = n
	}
	list, err := c.svc.ListByAuthor(ctx.Request.Context(), me, q)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) GetOne(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	post, err := c.svc.Get(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, post)
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

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMediaNotOwned):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidKind), errors.Is(err, ErrInvalidVis),
		errors.Is(err, ErrNeedMedia), errors.Is(err, ErrTooManyMedia),
		errors.Is(err, ErrDuplicateMedia), errors.Is(err, ErrUnsupportedType),
		errors.Is(err, ErrReelNeedsVideo), errors.Is(err, ErrCaptionTooLong):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}
