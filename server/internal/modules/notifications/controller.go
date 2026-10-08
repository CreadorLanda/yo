package notifications

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

type Controller struct {
	svc *Service
}

func NewController(svc *Service) *Controller {
	return &Controller{svc: svc}
}

// PutDevice — PUT /notifications/devices
func (c *Controller) PutDevice(ctx *gin.Context) {
	var req RegisterDeviceRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	d, err := c.svc.RegisterDevice(
		ctx.Request.Context(),
		middleware.UserIDFrom(ctx),
		middleware.DeviceIDFrom(ctx),
		req,
	)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, d)
}

// DeleteDevice — DELETE /notifications/devices
func (c *Controller) DeleteDevice(ctx *gin.Context) {
	err := c.svc.UnregisterDevice(
		ctx.Request.Context(),
		middleware.UserIDFrom(ctx),
		middleware.DeviceIDFrom(ctx),
	)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// GetPrefs — GET /notifications/prefs
func (c *Controller) GetPrefs(ctx *gin.Context) {
	p, err := c.svc.GetPrefs(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, p)
}

// PatchPrefs — PATCH /notifications/prefs
func (c *Controller) PatchPrefs(ctx *gin.Context) {
	var req PatchPrefsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	p, err := c.svc.PatchPrefs(ctx.Request.Context(), middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, p)
}

// PostTest — POST /notifications/test  (enqueue smoke push)
func (c *Controller) PostTest(ctx *gin.Context) {
	if err := c.svc.TestPush(ctx.Request.Context(), middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusAccepted, gin.H{"queued": true})
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidToken), errors.Is(err, ErrInvalidPlat):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}
