package channels

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
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

func TestGamePostHTTPIsPersistedAndImmutable(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	owner := createUser(t, pool, "http_game_owner_"+uuid.NewString()[:8])
	svc := NewService(NewRepository(pool))
	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "HTTP games", Handle: "http_games_" + uuid.NewString()[:8], WhoCanPost: PostAdmins,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	secret := []byte("http-test-secret")
	now := time.Now().Truncate(time.Second)
	token, err := tokens.Sign(secret, tokens.Claims{
		UserID: owner, DeviceID: uuid.New(), Type: tokens.TypeAccess,
		IssuedAt: now, Expires: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	authed := router.Group("", middleware.Auth(secret))
	Register(authed, NewController(svc))

	payload := map[string]any{
		"kind": "game", "game": "truth-or-dare", "action": "start",
		"seed": "http-seed", "maxRounds": 5, "playerId": owner.String(),
	}
	body, _ := json.Marshal(map[string]any{
		"post_type": "game", "game_payload": payload,
	})
	request := httptest.NewRequest(http.MethodPost, "/channels/"+ch.ID.String()+"/posts", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	created := httptest.NewRecorder()
	router.ServeHTTP(created, request)
	if created.Code != http.StatusCreated {
		t.Fatalf("POST game: status=%d body=%s", created.Code, created.Body.String())
	}
	var post Post
	if err := json.Unmarshal(created.Body.Bytes(), &post); err != nil {
		t.Fatalf("decode created post: %v", err)
	}
	if post.ID == uuid.Nil || post.PostType != PostGame {
		t.Fatalf("POST did not return persisted game post: %+v", post)
	}

	for _, method := range []string{http.MethodPatch, http.MethodDelete} {
		var requestBody *bytes.Reader
		if method == http.MethodPatch {
			patch, _ := json.Marshal(map[string]string{"text": "tampered"})
			requestBody = bytes.NewReader(patch)
		} else {
			requestBody = bytes.NewReader(nil)
		}
		request := httptest.NewRequest(method, "/channel-posts/"+post.ID.String(), requestBody)
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusConflict {
			t.Fatalf("%s game: status=%d body=%s, want %d", method, response.Code, response.Body.String(), http.StatusConflict)
		}
	}
}
