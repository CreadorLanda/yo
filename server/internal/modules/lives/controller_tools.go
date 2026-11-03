package lives

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

func registerTools(rg *gin.RouterGroup, c *Controller) {
	rg.GET("/lives/:id", c.GetDetails)
	rg.GET("/lives/:id/stats", c.GetStats)
	rg.GET("/lives/:id/audience", c.GetAudience)
	rg.POST("/lives/:id/respond", c.PostRespond)
	rg.POST("/lives/:id/invite", c.PostInvite)
	rg.PATCH("/lives/:id/settings", c.PatchSettings)
	rg.POST("/lives/:id/hearts", c.PostHearts)

	rg.GET("/lives/:id/comments", c.GetComments)
	rg.POST("/lives/:id/comments", c.PostComment)
	rg.DELETE("/lives/:id/comments/:cid", c.DeleteComment)

	rg.POST("/lives/:id/stage/request", c.PostStageRequest)
	rg.POST("/lives/:id/stage/leave", c.PostStageLeave)
	rg.POST("/lives/:id/stage/:uid", c.PostStageInvite)
	rg.DELETE("/lives/:id/stage/:uid", c.DeleteStage)

	rg.PUT("/lives/:id/moderators/:uid", c.PutModerator)
	rg.DELETE("/lives/:id/moderators/:uid", c.DeleteModerator)

	rg.GET("/lives/:id/bans", c.GetBans)
	rg.PUT("/lives/:id/bans/:uid", c.PutBan)
	rg.DELETE("/lives/:id/bans/:uid", c.DeleteBan)
}

// writeErr maps the service's errors to statuses. Not-allowed and no-live are
// both not-found, as everywhere else in this module.
func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNoLive), errors.Is(err, ErrNotAllowed):
		ctx.JSON(http.StatusNotFound, gin.H{"error": "no_live"})
	case errors.Is(err, ErrBanned):
		ctx.JSON(http.StatusForbidden, gin.H{"error": ErrBanned.Error()})
	case errors.Is(err, ErrForbidden):
		ctx.JSON(http.StatusForbidden, gin.H{"error": ErrForbidden.Error()})
	case errors.Is(err, ErrCommentsOff):
		ctx.JSON(http.StatusForbidden, gin.H{"error": ErrCommentsOff.Error()})
	case errors.Is(err, ErrInvalid):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": ErrInvalid.Error()})
	case errors.Is(err, ErrNothingPending):
		ctx.JSON(http.StatusConflict, gin.H{"error": ErrNothingPending.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	}
}

func ids(ctx *gin.Context, names ...string) ([]uuid.UUID, bool) {
	out := make([]uuid.UUID, 0, len(names))
	for _, n := range names {
		id, err := uuid.Parse(ctx.Param(n))
		if err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}

func reply(ctx *gin.Context, body any, err error) {
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if body == nil {
		ctx.Status(http.StatusNoContent)
		return
	}
	ctx.JSON(http.StatusOK, body)
}

// GetDetails — GET /lives/:id
func (c *Controller) GetDetails(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	d, err := c.svc.Details(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx))
	reply(ctx, d, err)
}

// GetStats — GET /lives/:id/stats
func (c *Controller) GetStats(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	st, err := c.svc.Stats(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx))
	reply(ctx, st, err)
}

// GetAudience — GET /lives/:id/audience
func (c *Controller) GetAudience(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.Audience(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx))
	reply(ctx, list, err)
}

// PostRespond — POST /lives/:id/respond {"accept": bool}
func (c *Controller) PostRespond(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	var req struct {
		Accept bool `json:"accept"`
	}
	if err := ctx.ShouldBindJSON(&req); err != nil {
		writeErr(ctx, ErrInvalid)
		return
	}
	reply(ctx, nil, c.svc.Respond(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), req.Accept))
}

// PostInvite — POST /lives/:id/invite {"user_ids": [...]}
func (c *Controller) PostInvite(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	var req struct {
		UserIDs []uuid.UUID `json:"user_ids"`
	}
	if err := ctx.ShouldBindJSON(&req); err != nil {
		writeErr(ctx, ErrInvalid)
		return
	}
	reply(ctx, nil, c.svc.Invite(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), req.UserIDs))
}

// PatchSettings — PATCH /lives/:id/settings {"comments_enabled": bool}
func (c *Controller) PatchSettings(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	var req struct {
		CommentsEnabled *bool `json:"comments_enabled"`
	}
	if err := ctx.ShouldBindJSON(&req); err != nil || req.CommentsEnabled == nil {
		writeErr(ctx, ErrInvalid)
		return
	}
	reply(ctx, nil, c.svc.SetComments(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), *req.CommentsEnabled))
}

// PostHearts — POST /lives/:id/hearts {"n": 1..50}
func (c *Controller) PostHearts(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	var req struct {
		N int `json:"n"`
	}
	if err := ctx.ShouldBindJSON(&req); err != nil {
		writeErr(ctx, ErrInvalid)
		return
	}
	reply(ctx, nil, c.svc.Hearts(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), req.N))
}

// GetComments — GET /lives/:id/comments
func (c *Controller) GetComments(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.Comments(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx))
	reply(ctx, list, err)
}

// PostComment — POST /lives/:id/comments {"body": "..."}
func (c *Controller) PostComment(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	var req struct {
		Body string `json:"body"`
	}
	if err := ctx.ShouldBindJSON(&req); err != nil {
		writeErr(ctx, ErrInvalid)
		return
	}
	cm, err := c.svc.Comment(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), req.Body)
	reply(ctx, cm, err)
}

// DeleteComment — DELETE /lives/:id/comments/:cid
func (c *Controller) DeleteComment(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	cid, err := strconv.ParseInt(ctx.Param("cid"), 10, 64)
	if err != nil {
		writeErr(ctx, ErrInvalid)
		return
	}
	reply(ctx, nil, c.svc.DeleteComment(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), cid))
}

// PostStageRequest — POST /lives/:id/stage/request
func (c *Controller) PostStageRequest(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.RequestStage(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx)))
}

// PostStageLeave — POST /lives/:id/stage/leave
func (c *Controller) PostStageLeave(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.LeaveStage(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx)))
}

// PostStageInvite — POST /lives/:id/stage/:uid
func (c *Controller) PostStageInvite(ctx *gin.Context) {
	p, ok := ids(ctx, "id", "uid")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.InviteToStage(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), p[1]))
}

// DeleteStage — DELETE /lives/:id/stage/:uid
func (c *Controller) DeleteStage(ctx *gin.Context) {
	p, ok := ids(ctx, "id", "uid")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.RemoveFromStage(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), p[1]))
}

// PutModerator — PUT /lives/:id/moderators/:uid
func (c *Controller) PutModerator(ctx *gin.Context) {
	p, ok := ids(ctx, "id", "uid")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.SetModerator(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), p[1], true))
}

// DeleteModerator — DELETE /lives/:id/moderators/:uid
func (c *Controller) DeleteModerator(ctx *gin.Context) {
	p, ok := ids(ctx, "id", "uid")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.SetModerator(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), p[1], false))
}

// GetBans — GET /lives/:id/bans
func (c *Controller) GetBans(ctx *gin.Context) {
	p, ok := ids(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.Bans(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx))
	reply(ctx, list, err)
}

// PutBan — PUT /lives/:id/bans/:uid
func (c *Controller) PutBan(ctx *gin.Context) {
	p, ok := ids(ctx, "id", "uid")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.Ban(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), p[1]))
}

// DeleteBan — DELETE /lives/:id/bans/:uid
func (c *Controller) DeleteBan(ctx *gin.Context) {
	p, ok := ids(ctx, "id", "uid")
	if !ok {
		return
	}
	reply(ctx, nil, c.svc.Unban(ctx.Request.Context(), p[0], middleware.UserIDFrom(ctx), p[1]))
}
