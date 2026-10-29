package channels

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

func TestReactionHTTPContractCapsPostAndComment(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))
	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	bob := createUser(t, pool, "bob_"+uuid.NewString()[:8])
	ch, err := svc.Create(ctx, owner, CreateChannelRequest{Name: "HTTP reactions", Handle: "http_" + uuid.NewString()[:8]})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	join(t, svc, ch.ID, bob)
	post, err := svc.CreatePost(ctx, ch.ID, owner, CreatePostRequest{Text: "post"})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	comment, err := svc.Comment(ctx, post.ID, bob, CommentRequest{Text: "comment"})
	if err != nil {
		t.Fatalf("Comment: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Auth([]byte("test-secret")))
	Register(r.Group("/api"), NewController(svc))
	token, err := tokens.Sign([]byte("test-secret"), tokens.Claims{
		UserID: bob, DeviceID: uuid.New(), Type: tokens.TypeAccess,
		IssuedAt: time.Now(), Expires: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	postPath := "/api/channel-posts/" + post.ID.String() + "/react"
	if w := call(http.MethodPost, postPath, `{"reactions":["🔥","👍🏽"]}`); w.Code != http.StatusNoContent {
		t.Fatalf("post reaction status = %d, want 204: %s", w.Code, w.Body.String())
	}
	if w := call(http.MethodPost, postPath, `{"reactions":["🔥","👍🏽","🎉"]}`); w.Code != http.StatusBadRequest {
		t.Fatalf("third post reaction status = %d, want 400: %s", w.Code, w.Body.String())
	}

	commentPath := "/api/channel-comments/" + comment.ID.String() + "/react"
	if w := call(http.MethodPost, commentPath, `{"reactions":["❤️","😂"]}`); w.Code != http.StatusNoContent {
		t.Fatalf("comment reaction status = %d, want 204: %s", w.Code, w.Body.String())
	}
	if w := call(http.MethodPost, commentPath, `{"reactions":["❤️","😂","🎉"]}`); w.Code != http.StatusBadRequest {
		t.Fatalf("third comment reaction status = %d, want 400: %s", w.Code, w.Body.String())
	}
}
