package groups

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

func (c *Controller) PostCreate(ctx *gin.Context) {
	var req CreateGroupRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	g, err := c.svc.Create(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, g)
}

func (c *Controller) GetList(ctx *gin.Context) {
	list, err := c.svc.List(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if list == nil {
		list = []Group{}
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) GetOne(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	g, err := c.svc.Get(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, g)
}

func (c *Controller) Patch(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req PatchGroupRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	g, err := c.svc.Patch(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, g)
}

func (c *Controller) PostMembers(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req AddMembersRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	// Omitted means "share", which is what happened before this existed.
	share := req.ShareHistory == nil || *req.ShareHistory
	g, err := c.svc.AddMembers(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), req.UserIDs, share)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, g)
}

func (c *Controller) DeleteMember(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	uid, err := uuid.Parse(ctx.Param("userId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	g, err := c.svc.RemoveMember(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), uid)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, g)
}

func (c *Controller) PatchMemberRole(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	uid, err := uuid.Parse(ctx.Param("userId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	var req SetRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	g, err := c.svc.SetRole(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), uid, req.Role)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, g)
}

func (c *Controller) PostLeave(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	me := middleware.UserIDFrom(ctx)
	if _, err := c.svc.RemoveMember(ctx.Request.Context(), id, me, me); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotMember), errors.Is(err, ErrNotAdmin):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrLastAdmin), errors.Is(err, ErrInvalidTitle),
		errors.Is(err, ErrInvalidRole), errors.Is(err, ErrInvalidHistory):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}
