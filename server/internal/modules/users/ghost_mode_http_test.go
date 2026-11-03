package users

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

func TestGhostModeHTTPContract(t *testing.T) {
	pool := ghostTestDB(t)
	userID := ghostTestUser(t, pool)
	secret := []byte("ghost-mode-http-test-secret")
	now := time.Now().UTC()
	access, err := tokens.Sign(secret, tokens.Claims{
		UserID:   userID,
		DeviceID: uuid.New(),
		Type:     tokens.TypeAccess,
		IssuedAt: now,
		Expires:  now.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("sign access token: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	api.Use(middleware.Auth(secret))
	Register(api, NewController(NewService(NewRepository(pool)), nil))

	request := func(method string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/users/me/ghost-mode", nil)
		req.Header.Set("Authorization", "Bearer "+access)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	unauthenticated := httptest.NewRecorder()
	router.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodPost, "/api/users/me/ghost-mode", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated activation status = %d; want %d", unauthenticated.Code, http.StatusUnauthorized)
	}

	activated := request(http.MethodPost)
	if activated.Code != http.StatusOK {
		t.Fatalf("activate status = %d, body = %s; want %d", activated.Code, activated.Body.String(), http.StatusOK)
	}
	var active User
	if err := json.Unmarshal(activated.Body.Bytes(), &active); err != nil {
		t.Fatalf("decode activation response: %v", err)
	}
	if !active.GhostMode || active.GhostModeExpiresAt == nil {
		t.Fatalf("activation response = %+v", active)
	}

	repeated := request(http.MethodPost)
	if repeated.Code != http.StatusConflict {
		t.Fatalf("repeated activation status = %d, body = %s; want %d", repeated.Code, repeated.Body.String(), http.StatusConflict)
	}

	deactivated := request(http.MethodDelete)
	if deactivated.Code != http.StatusOK {
		t.Fatalf("deactivation status = %d, body = %s; want %d", deactivated.Code, deactivated.Body.String(), http.StatusOK)
	}
	var inactive User
	if err := json.Unmarshal(deactivated.Body.Bytes(), &inactive); err != nil {
		t.Fatalf("decode deactivation response: %v", err)
	}
	if inactive.GhostMode || inactive.GhostModeExpiresAt != nil {
		t.Fatalf("deactivation response = %+v", inactive)
	}
}
