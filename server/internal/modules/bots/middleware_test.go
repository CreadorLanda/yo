package bots

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// countingLimiter allows `budget` hits per key, then refuses.
type countingLimiter struct {
	budget int
	hits   map[string]int
	fail   bool
}

func (l *countingLimiter) Allow(_ context.Context, key string, _ int, _ time.Duration) (bool, time.Duration, error) {
	if l.fail {
		return false, 0, errors.New("redis down")
	}
	l.hits[key]++
	return l.hits[key] <= l.budget, 30 * time.Second, nil
}

func botRouter(l Limiter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	bot := uuid.New()
	r.Use(func(c *gin.Context) { middleware.SetBotPrincipal(c, bot, uuid.New()); c.Next() })
	r.Use(RateLimit(l))
	r.POST("/chats/:id/messages", func(c *gin.Context) { c.Status(http.StatusCreated) })
	return r
}

func TestRateLimitRefusesWithRetryAfter(t *testing.T) {
	r := botRouter(&countingLimiter{budget: 2, hits: map[string]int{}})
	path := "/chats/" + uuid.NewString() + "/messages"
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
		if rec.Code != http.StatusCreated {
			t.Fatalf("request %d: status %d, want 201", i, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("third request: status %d, Retry-After %q; want 429 with a header", rec.Code, rec.Header().Get("Retry-After"))
	}
}

func TestRateLimitFailsOpenWhenTheStoreIsDown(t *testing.T) {
	r := botRouter(&countingLimiter{fail: true, hits: map[string]int{}})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/chats/"+uuid.NewString()+"/messages", nil))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d with the limiter down, want the request through", rec.Code)
	}
}

func TestSetBotPrincipalMarksTheRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	id := uuid.New()
	middleware.SetBotPrincipal(c, id, uuid.New())
	if !middleware.IsBot(c) || middleware.UserIDFrom(c) != id {
		t.Fatal("bot principal not visible to controllers")
	}
}

func TestKillSwitchStopsEveryBot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := NewService(nil).WithPlatformDisabled(true)
	r := gin.New()
	r.Use(Auth(svc))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bot zsb_whatever")
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "bots_disabled") {
		t.Fatalf("kill switch: %d %s", rec.Code, rec.Body.String())
	}
}
