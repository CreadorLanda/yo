package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS lets a browser client on another origin call the API.
//
// Native apps do not enforce CORS, so this only matters for the web client.
// It is an allow-list, empty by default: an origin that is not listed gets no
// CORS headers at all and the browser blocks the response. Credentials are
// bearer tokens in a header, never cookies, so nothing here enables them.
func CORS(allowed []string) gin.HandlerFunc {
	set := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		if o = strings.TrimSpace(o); o != "" {
			set[o] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := set[origin]; !ok || origin == "" {
			c.Next()
			return
		}
		h := c.Writer.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Add("Vary", "Origin")
		if c.Request.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id")
			h.Set("Access-Control-Max-Age", "600")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		h.Set("Access-Control-Expose-Headers", "X-Request-Id")
		c.Next()
	}
}
