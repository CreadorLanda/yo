package lives

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/livekit"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

const httpTestSecret = "http-test-secret-long-enough"

func liveHTTPRouter(svc *Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	authed := router.Group("/api")
	authed.Use(middleware.Auth([]byte(httpTestSecret)))
	Register(authed, NewController(svc))
	return router
}

func liveAccessToken(t *testing.T, userID uuid.UUID) string {
	t.Helper()
	token, err := tokens.Sign([]byte(httpTestSecret), tokens.Claims{
		UserID:   userID,
		DeviceID: uuid.New(),
		Type:     tokens.TypeAccess,
		IssuedAt: time.Now(),
		Expires:  time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("sign access token: %v", err)
	}
	return token
}

func TestLiveHTTPStartJoinAndEnd(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()
	host, viewer := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, viewer)
	svc := NewService(
		livekit.NewSigner(livekit.Config{
			URL: "wss://live.example", APIKey: testKey, APISecret: testSecret,
		}),
		NewRepo(pool),
		fakeAudience{inChat: map[uuid.UUID]bool{host: true, viewer: true}},
		fakeUsers{name: "Host"},
		&fakeAnnouncer{},
	)
	router := liveHTTPRouter(svc)

	startBody, _ := json.Marshal(map[string]any{"chat_id": chat, "title": "HTTP live"})
	start := httptest.NewRecorder()
	startReq := httptest.NewRequest(http.MethodPost, "/api/lives", bytes.NewReader(startBody))
	startReq.Header.Set("Authorization", "Bearer "+liveAccessToken(t, host))
	router.ServeHTTP(start, startReq)
	if start.Code != http.StatusOK {
		t.Fatalf("start status = %d, body %s", start.Code, start.Body.String())
	}
	var hostGrant Grant
	if err := json.Unmarshal(start.Body.Bytes(), &hostGrant); err != nil {
		t.Fatalf("decode start grant: %v", err)
	}

	join := httptest.NewRecorder()
	joinReq := httptest.NewRequest(http.MethodPost, "/api/lives/"+hostGrant.Live.ID.String()+"/join", nil)
	joinReq.Header.Set("Authorization", "Bearer "+liveAccessToken(t, viewer))
	router.ServeHTTP(join, joinReq)
	if join.Code != http.StatusOK {
		t.Fatalf("join status = %d, body %s", join.Code, join.Body.String())
	}

	end := httptest.NewRecorder()
	endReq := httptest.NewRequest(http.MethodPost, "/api/lives/"+hostGrant.Live.ID.String()+"/end", nil)
	endReq.Header.Set("Authorization", "Bearer "+liveAccessToken(t, host))
	router.ServeHTTP(end, endReq)
	if end.Code != http.StatusNoContent {
		t.Fatalf("end status = %d, body %s", end.Code, end.Body.String())
	}

	ended, err := NewRepo(pool).Get(ctx, hostGrant.Live.ID)
	if err != nil {
		t.Fatalf("get ended live: %v", err)
	}
	if ended.EndedAt == nil {
		t.Fatal("end HTTP request returned success without persisting ended_at")
	}
}
