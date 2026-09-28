// Package middleware groups cross-cutting handlers used by every module.
package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// RequestID assigns a UUID to each request, exposed as X-Request-Id and
// attached to the context for logging.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-Id")
		if parsed, err := uuid.Parse(id); err != nil || parsed == uuid.Nil {
			id = uuid.NewString()
		}
		c.Set("request_id", id)
		c.Writer.Header().Set("X-Request-Id", id)
		c.Next()
	}
}

// Recovery is a Gin-friendly panic recovery that logs structured errors.
func Recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		log.Error().
			Str("path", c.FullPath()).
			Interface("panic", recovered).
			Msg("panic recovered")
		c.AbortWithStatusJSON(500, gin.H{"error": "internal_error"})
	})
}
