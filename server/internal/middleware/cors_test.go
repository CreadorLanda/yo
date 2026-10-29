package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func corsRouter(allowed []string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS(allowed))
	r.GET("/ping", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	return r
}

func TestCORSAllowedOrigin(t *testing.T) {
	r := corsRouter([]string{"http://localhost:8082"})
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "http://localhost:8082")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:8082" {
		t.Fatalf("allow-origin = %q", got)
	}
}

func TestCORSUnlistedOriginGetsNoHeaders(t *testing.T) {
	r := corsRouter([]string{"http://localhost:8082"})
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unlisted origin got allow-origin %q", got)
	}
}

func TestCORSPreflight(t *testing.T) {
	r := corsRouter([]string{"http://localhost:8082"})
	req := httptest.NewRequest(http.MethodOptions, "/ping", nil)
	req.Header.Set("Origin", "http://localhost:8082")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Headers") == "" {
		t.Fatal("preflight missing allow-headers")
	}
}

func TestCORSEmptyListIsOff(t *testing.T) {
	r := corsRouter(nil)
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "http://localhost:8082")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("empty allow-list must send no CORS headers")
	}
}
