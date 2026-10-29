package messages

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

func TestPostSelfChatHTTPRequiresAuthAndUsesAuthenticatedUser(t *testing.T) {
	pool := testDB(t)
	ctx := httptest.NewRecorder()
	svc := newTestService(pool)
	alice := createTestUser(t, pool, "http_self_"+uuid.NewString()[:8])
	secret := []byte("controller-test-secret")

	router := gin.New()
	protected := router.Group("/api")
	protected.Use(middleware.Auth(secret))
	Register(protected, NewController(svc, nil, secret))

	unauthenticated := httptest.NewRequest(http.MethodPost, "/api/chats/self", nil)
	router.ServeHTTP(ctx, unauthenticated)
	if ctx.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want %d", ctx.Code, http.StatusUnauthorized)
	}

	accessToken, err := tokens.Sign(secret, tokens.Claims{
		UserID:   alice,
		DeviceID: uuid.New(),
		Type:     tokens.TypeAccess,
		IssuedAt: time.Now().Add(-time.Minute),
		Expires:  time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("sign access token: %v", err)
	}

	post := func() CreateChatResponse {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/chats/self", nil)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("authenticated status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
		var response CreateChatResponse
		if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
			t.Fatalf("decode authenticated response: %v", err)
		}
		return response
	}

	first := post()
	second := post()
	if first.ChatID == uuid.Nil || first.ChatID != second.ChatID {
		t.Fatalf("HTTP self-chat ids = %s and %s, want one stable id", first.ChatID, second.ChatID)
	}
	if !first.Chat.IsSelf || first.Chat.CreatedBy != alice || first.Chat.Status != ChatStatusActive {
		t.Fatalf("HTTP self-chat = %+v, want authenticated active self-chat", first.Chat)
	}
	if first.Chat.PeerUserID == nil || *first.Chat.PeerUserID != alice {
		t.Fatalf("HTTP self-chat peer = %v, want authenticated user %s", first.Chat.PeerUserID, alice)
	}
}
