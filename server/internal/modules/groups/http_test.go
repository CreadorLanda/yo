package groups

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/messages"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/users"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

func TestBulkMemberManagementRequiresAdminOverHTTP(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	alice := createTestUser(t, pool, "alice_http_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_http_"+uuid.NewString()[:8])
	carol := createTestUser(t, pool, "carol_http_"+uuid.NewString()[:8])
	group, err := NewService(NewRepository(pool)).Create(ctx, alice, CreateGroupRequest{Title: "http", MemberIDs: []uuid.UUID{bob, carol}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	secret := []byte("http-test-secret")
	token, err := tokens.Sign(secret, tokens.Claims{
		UserID: bob, DeviceID: uuid.New(), Type: tokens.TypeAccess,
		IssuedAt: time.Now(), Expires: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	authed := r.Group("/api", middleware.Auth(secret))
	Register(authed, NewController(NewService(NewRepository(pool))))
	req := httptest.NewRequest(http.MethodPost, "/api/groups/"+group.ID.String()+"/members/bulk", bytes.NewBufferString(`{"user_ids":["`+carol.String()+`"],"action":"remove"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("bulk member response = %d body=%s, want 403", res.Code, res.Body.String())
	}
}

func TestGroupMessagePermissionIsEnforcedOverHTTP(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	alice := createTestUser(t, pool, "alice_send_"+uuid.NewString()[:8])
	bob := createTestUser(t, pool, "bob_send_"+uuid.NewString()[:8])
	groupSvc := NewService(NewRepository(pool))
	group, err := groupSvc.Create(ctx, alice, CreateGroupRequest{Title: "send-policy", MemberIDs: []uuid.UUID{bob}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := groupSvc.Patch(ctx, group.ID, alice, PatchGroupRequest{Permissions: &GroupPermissions{
		Text: PermissionAdmin, Stickers: PermissionMember, Audio: PermissionMember,
		Media: PermissionMember, Posting: PermissionMember,
	}}); err != nil {
		t.Fatalf("Patch permissions: %v", err)
	}

	secret := []byte("message-http-secret")
	token, err := tokens.Sign(secret, tokens.Claims{UserID: bob, DeviceID: uuid.New(), Type: tokens.TypeAccess, IssuedAt: time.Now(), Expires: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	msgSvc := messages.NewService(messages.NewRepository(pool, ""), users.NewRepository(pool), nil, nil).WithGroupPolicy(groupSvc)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	authed := r.Group("/api", middleware.Auth(secret))
	messages.Register(authed, messages.NewController(msgSvc, nil, secret))
	req := httptest.NewRequest(http.MethodPost, "/api/chats/"+group.ID.String()+"/messages", bytes.NewBufferString(`{"content":"`+groupEnvelopeForTest(bob)+`","message_type":"text"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("group message response = %d body=%s, want 403", res.Code, res.Body.String())
	}
}

func groupEnvelopeForTest(sender uuid.UUID) string {
	header, _ := json.Marshal(map[string]any{"v": 1, "s": sender.String(), "e": 0, "n": 0})
	return "soc1g." + base64.RawURLEncoding.EncodeToString(header) + ".Y2lwaGVy"
}
