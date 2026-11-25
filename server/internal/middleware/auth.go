package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

// Keys we use to stash the authenticated principal on the gin context.
// Controllers read with UserIDFrom / DeviceIDFrom so the string key never
// leaks.
const (
	ctxUserID   = "auth.user_id"
	ctxDeviceID = "auth.device_id"
)

// Auth verifies the Bearer access token and attaches the user/device IDs
// to the request context. Apply with `router.Use(middleware.Auth(secret))`
// or on subgroups for routes that need an authenticated principal.
func Auth(secret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing_token"})
			return
		}
		raw := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		if raw == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing_token"})
			return
		}
		claims, err := tokens.Parse(secret, raw)
		switch {
		case errors.Is(err, tokens.ErrExpired):
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "expired_token"})
			return
		case err != nil:
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
			return
		}
		if claims.Type != tokens.TypeAccess {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "wrong_token_type"})
			return
		}
		c.Set(ctxUserID, claims.UserID)
		c.Set(ctxDeviceID, claims.DeviceID)
		c.Next()
	}
}

// ctxIsBot marks a principal that authenticated with a bot token rather
// than a user session.
const ctxIsBot = "auth.is_bot"

// SetBotPrincipal attaches a bot as the authenticated principal, with the
// same keys Auth uses — so controllers written for people (send a message,
// publish keys, upload media) serve bots unchanged. Bot authentication lives
// in the bots module; this is the one door it needs into this package.
func SetBotPrincipal(c *gin.Context, botUserID, deviceID uuid.UUID) {
	c.Set(ctxUserID, botUserID)
	c.Set(ctxDeviceID, deviceID)
	c.Set(ctxIsBot, true)
}

// IsBot reports whether the request was authenticated with a bot token.
func IsBot(c *gin.Context) bool {
	v, ok := c.Get(ctxIsBot)
	return ok && v == true
}

// UserIDFrom returns the authenticated user's UUID. Panics if Auth wasn't
// applied to the route — that's a programmer error, not a runtime one.
func UserIDFrom(c *gin.Context) uuid.UUID {
	v, ok := c.Get(ctxUserID)
	if !ok {
		panic("middleware: UserIDFrom called without Auth middleware")
	}
	return v.(uuid.UUID)
}

// DeviceIDFrom returns the authenticated device's UUID. Same rule.
func DeviceIDFrom(c *gin.Context) uuid.UUID {
	v, ok := c.Get(ctxDeviceID)
	if !ok {
		panic("middleware: DeviceIDFrom called without Auth middleware")
	}
	return v.(uuid.UUID)
}
