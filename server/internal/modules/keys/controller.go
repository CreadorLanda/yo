package keys

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

// PutKeys handles PUT /users/me/keys.
func (c *Controller) PutKeys(ctx *gin.Context) {
	var req UploadRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	res, err := c.svc.Upload(
		ctx.Request.Context(),
		middleware.UserIDFrom(ctx),
		middleware.DeviceIDFrom(ctx),
		req,
	)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, res)
}

// GetMyCount handles GET /users/me/keys/count.
func (c *Controller) GetMyCount(ctx *gin.Context) {
	res, err := c.svc.Count(
		ctx.Request.Context(),
		middleware.UserIDFrom(ctx),
		middleware.DeviceIDFrom(ctx),
	)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, res)
}

// GetBundle handles GET /users/by-username/:username/keys.
// Consumes one OTK as part of the response.
func (c *Controller) GetBundle(ctx *gin.Context) {
	b, err := c.svc.BundleByUsername(ctx.Request.Context(), ctx.Param("username"))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, b)
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrUserNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
	case errors.Is(err, ErrNoBundle):
		ctx.JSON(http.StatusNotFound, gin.H{"error": "bundle_unavailable"})
	case errors.Is(err, ErrInvalidPayload):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}

func (c *Controller) GetIdentity(ctx *gin.Context) {
	id, err := c.svc.IdentityByUsername(ctx.Request.Context(), ctx.Param("username"))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, id)
}
