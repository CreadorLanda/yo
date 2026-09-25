package channels

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/yo/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

func (c *Controller) PostCreate(ctx *gin.Context) {
	var req CreateChannelRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	ch, err := c.svc.Create(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, ch)
}

func (c *Controller) GetList(ctx *gin.Context) {
	list, err := c.svc.List(ctx.Request.Context(), middleware.UserIDFrom(ctx), ctx.Query("category"))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if list == nil {
		list = []Channel{}
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) GetOne(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	ch, err := c.svc.Get(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, ch)
}

func (c *Controller) Patch(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req PatchChannelRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	ch, err := c.svc.Patch(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, ch)
}

func (c *Controller) PostFollow(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	ch, err := c.svc.Follow(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, ch)
}

func (c *Controller) DeleteFollow(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	ch, err := c.svc.Unfollow(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, ch)
}

func (c *Controller) GetPosts(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	list, err := c.svc.ListPosts(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if list == nil {
		list = []Post{}
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) PostPost(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req CreatePostRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	p, err := c.svc.CreatePost(ctx.Request.Context(), id, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, p)
}

func (c *Controller) PostReact(ctx *gin.Context) {
	pid, err := uuid.Parse(ctx.Param("postId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req ReactRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if err := c.svc.React(ctx.Request.Context(), pid, middleware.UserIDFrom(ctx), req.Emoji, false); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) DeleteReact(ctx *gin.Context) {
	pid, err := uuid.Parse(ctx.Param("postId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.React(ctx.Request.Context(), pid, middleware.UserIDFrom(ctx), "", true); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) GetComments(ctx *gin.Context) {
	pid, err := uuid.Parse(ctx.Param("postId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	list, err := c.svc.ListComments(ctx.Request.Context(), pid, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if list == nil {
		list = []Comment{}
	}
	ctx.JSON(http.StatusOK, list)
}

func (c *Controller) PostComment(ctx *gin.Context) {
	pid, err := uuid.Parse(ctx.Param("postId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req CommentRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	cm, err := c.svc.Comment(ctx.Request.Context(), pid, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, cm)
}

func (c *Controller) GetHandleAvailable(ctx *gin.Context) {
	ok, err := c.svc.CheckHandle(ctx.Request.Context(), ctx.Query("handle"))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"available": ok})
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrMemberNotFound),
		errors.Is(err, ErrInviteNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrCannotPost), errors.Is(err, ErrJoinApproval), errors.Is(err, ErrInviteOnly):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrHandleTaken):
		ctx.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidHandle), errors.Is(err, ErrInvalidName),
		errors.Is(err, ErrInvalidVisibility), errors.Is(err, ErrInvalidPostPolicy), errors.Is(err, ErrInvalidJoinMode),
		errors.Is(err, ErrCommentsOff), errors.Is(err, ErrReactionsOff),
		errors.Is(err, ErrInvalidRole), errors.Is(err, ErrCannotDemote),
		errors.Is(err, ErrSelfRole):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}

// ── members ─────────────────────────────────────────────────────────────────

type setRoleRequest struct {
	Role MemberRole `json:"role"`
}

func (c *Controller) GetMembers(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	members, err := c.svc.Members(ctx.Request.Context(), id, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, members)
}

func (c *Controller) PatchMemberRole(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	target, err := uuid.Parse(ctx.Param("uid"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	var req setRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	if err := c.svc.SetMemberRole(ctx.Request.Context(), id,
		middleware.UserIDFrom(ctx), target, req.Role); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) DeleteMember(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	target, err := uuid.Parse(ctx.Param("uid"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	if err := c.svc.RemoveMember(ctx.Request.Context(), id,
		middleware.UserIDFrom(ctx), target); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

type editPostRequest struct {
	Text string `json:"text"`
}

func (c *Controller) PatchPost(ctx *gin.Context) {
	postID, err := uuid.Parse(ctx.Param("postId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req editPostRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	if err := c.svc.EditPost(ctx.Request.Context(), postID,
		middleware.UserIDFrom(ctx), req.Text); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *Controller) DeletePost(ctx *gin.Context) {
	postID, err := uuid.Parse(ctx.Param("postId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.DeletePost(ctx.Request.Context(), postID,
		middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

type addMemberRequest struct {
	Username string     `json:"username"`
	Role     MemberRole `json:"role"`
}

func (c *Controller) PostMember(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req addMemberRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	member, err := c.svc.AddMemberByUsername(ctx.Request.Context(), id,
		middleware.UserIDFrom(ctx), req.Username, req.Role)
	if errors.Is(err, ErrInvitePending) {
		// The request was created and is waiting on the person. 202 rather
		// than 200: nothing has been granted yet, and the client says so.
		ctx.JSON(http.StatusAccepted, gin.H{"status": "invited", "role": member.Role})
		return
	}
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, member)
}

// ── role invitations ────────────────────────────────────────────────────────

func (c *Controller) GetMyInvites(ctx *gin.Context) {
	invites, err := c.svc.PendingInvites(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, invites)
}

func (c *Controller) PostAcceptInvite(ctx *gin.Context) {
	inviteID, err := uuid.Parse(ctx.Param("inviteId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	channelID, err := c.svc.AcceptInvite(ctx.Request.Context(), inviteID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"channel_id": channelID.String()})
}

func (c *Controller) PostDeclineInvite(ctx *gin.Context) {
	inviteID, err := uuid.Parse(ctx.Param("inviteId"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.DeclineInvite(ctx.Request.Context(), inviteID, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}
