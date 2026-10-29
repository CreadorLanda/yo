package messages

import (
	"bytes"
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

func TestAdvancedPrivacyHTTPContract(t *testing.T) {
	pool := testDB(t)
	ctx := t.Context()
	svc := newTestService(pool)

	alice := createTestUser(t, pool, "privacy_http_alice_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "privacy_http_bob_"+uuid.NewString()[:8])
	chat, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}

	secret := []byte("advanced-privacy-http-test-secret")
	accessToken := func(userID uuid.UUID) string {
		t.Helper()
		now := time.Now()
		token, err := tokens.Sign(secret, tokens.Claims{
			UserID:   userID,
			DeviceID: uuid.New(),
			Type:     tokens.TypeAccess,
			IssuedAt: now,
			Expires:  now.Add(time.Minute),
		})
		if err != nil {
			t.Fatalf("sign access token: %v", err)
		}
		return token
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	api.Use(middleware.Auth(secret))
	Register(api, NewController(svc, nil, secret))

	request := func(userID uuid.UUID, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+accessToken(userID))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}

	updated := request(alice, http.MethodPatch, "/api/chats/"+chat.ID.String()+"/privacy", ChatPrivacySettingsRequest{
		ForwardingDisabled:       ptr(true),
		ScreenshotProtection:     ptr(true),
		LinksRequireConfirmation: ptr(true),
		AllowedMessageTypes:      ptr([]MessageType{MsgText}),
	})
	if updated.Code != http.StatusOK {
		t.Fatalf("PATCH privacy status = %d, body = %s; want %d", updated.Code, updated.Body.String(), http.StatusOK)
	}
	var responseChat Chat
	if err := json.Unmarshal(updated.Body.Bytes(), &responseChat); err != nil {
		t.Fatalf("decode PATCH privacy response: %v", err)
	}
	if !responseChat.Privacy.ForwardingDisabled || !responseChat.Privacy.ScreenshotProtection || !responseChat.Privacy.LinksRequireConfirmation {
		t.Fatalf("PATCH privacy response did not expose persisted policy: %+v", responseChat.Privacy)
	}

	blockedMessage := request(alice, http.MethodPost, "/api/chats/"+chat.ID.String()+"/messages", SendMessageRequest{
		Content:     testDirectEnvelope("image"),
		MessageType: MsgImage,
	})
	if blockedMessage.Code != http.StatusForbidden {
		t.Fatalf("disallowed message HTTP status = %d, body = %s; want %d", blockedMessage.Code, blockedMessage.Body.String(), http.StatusForbidden)
	}
	allowedMessage := request(alice, http.MethodPost, "/api/chats/"+chat.ID.String()+"/messages", SendMessageRequest{
		Content: testDirectEnvelope("text"),
	})
	if allowedMessage.Code != http.StatusCreated {
		t.Fatalf("allowed message HTTP status = %d, body = %s; want %d", allowedMessage.Code, allowedMessage.Body.String(), http.StatusCreated)
	}

	denied := request(bob, http.MethodPatch, "/api/chats/"+chat.ID.String()+"/privacy", ChatPrivacySettingsRequest{
		ForwardingDisabled: ptr(false),
	})
	if denied.Code != http.StatusForbidden {
		t.Fatalf("non-owner PATCH privacy status = %d, body = %s; want %d", denied.Code, denied.Body.String(), http.StatusForbidden)
	}
}
