package auth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/CreadorLanda/zwosocial/server/internal/config"
)

// Controller adapts HTTP to the auth Service.
type Controller struct {
	svc *Service
	env string
}

func NewController(svc *Service, cfg config.Config) *Controller {
	return &Controller{svc: svc, env: cfg.Env}
}

func (c *Controller) PostStart(ctx *gin.Context) {
	var req StartRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	code, err := c.svc.Start(ctx.Request.Context(), req.Phone)
	if err != nil {
		writeAuthError(ctx, err)
		return
	}
	resp := gin.H{"sent": true}
	// In dev we return the OTP so the mobile client can autofill until SMS is wired.
	if c.env == "dev" {
		resp["dev_code"] = code
	}
	ctx.JSON(http.StatusOK, resp)
}

func (c *Controller) PostVerify(ctx *gin.Context) {
	var req VerifyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	tokens, user, err := c.svc.Verify(ctx.Request.Context(), req)
	if err != nil {
		writeAuthError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"user": user, "tokens": tokens})
}

func (c *Controller) PostRefresh(ctx *gin.Context) {
	var req RefreshRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	tokens, err := c.svc.Refresh(ctx.Request.Context(), req.RefreshToken)
	if err != nil {
		writeAuthError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"tokens": tokens})
}

// PostLogout revokes the family this refresh token belongs to. We accept
// the token in the body (instead of the Authorization header) so a client
// whose access token already expired can still cleanly sign out.
func (c *Controller) PostLogout(ctx *gin.Context) {
	var req RefreshRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	if err := c.svc.Logout(ctx.Request.Context(), req.RefreshToken); err != nil {
		writeAuthError(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

func writeAuthError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidCode), errors.Is(err, ErrCodeExpired), errors.Is(err, ErrInvalidRefresh):
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
	case errors.Is(err, ErrRateLimited):
		ctx.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotImplemented):
		ctx.JSON(http.StatusNotImplemented, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}
