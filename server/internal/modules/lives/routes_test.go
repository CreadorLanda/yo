package lives

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// TestRoutesRegister catches a route that collides with another one, which
// gin reports by panicking when the server starts.
func TestRoutesRegister(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	Register(r.Group("/api"), NewController(nil))
	if len(r.Routes()) < 20 {
		t.Fatalf("only %d routes registered", len(r.Routes()))
	}
}
