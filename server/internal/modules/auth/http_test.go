package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/CreadorLanda/zwosocial/server/internal/config"
	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		url = os.Getenv("REDIS_URL")
	}
	if url == "" {
		t.Skip("TEST_REDIS_URL or REDIS_URL not set — skipping Redis integration test")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse test redis url: %v", err)
	}
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		rdb.Close()
		t.Skipf("test Redis unavailable: %v", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

func TestCredentialChangesHTTPContract(t *testing.T) {
	pool := testDB(t)
	rdb := testRedis(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	secret := "test-secret-that-is-long-enough-for-auth-http"
	cfg := config.Config{Env: "dev", JWT: config.JWTConfig{
		Secret:          secret,
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 30 * 24 * time.Hour,
		OTPPepper:       "test-otp-pepper",
	}}
	svc := NewService(repo, rdb, cfg.JWT).WithDevVerificationCodes(true)
	controller := NewController(svc, cfg)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	Register(api, controller)
	protected := api.Group("")
	protected.Use(middleware.Auth([]byte(secret)))
	RegisterAuthed(protected, controller)

	phone := uniqueTestPhone()
	start := doJSON(t, router, http.MethodPost, "/api/auth/start", "", StartRequest{Phone: phone})
	if start.Code != http.StatusOK {
		t.Fatalf("auth/start status = %d, body=%s", start.Code, start.Body.String())
	}
	var startBody VerificationResponse
	decodeJSON(t, start, &startBody)
	if startBody.DevCode == "" {
		t.Fatal("dev auth/start response did not include a code")
	}

	conflictingSignupEmail := uniqueTestEmail("signup-conflict")
	emailOwner := createTestUser(t, pool)
	emailOwnerCode := []byte("signup-conflict-code")
	if err := repo.SetEmailChallenge(ctx, emailOwner, conflictingSignupEmail, emailOwnerCode, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("set signup conflict email: %v", err)
	}
	if _, err := repo.VerifyEmail(ctx, emailOwner, emailOwnerCode, time.Now()); err != nil {
		t.Fatalf("verify signup conflict email: %v", err)
	}
	conflictingSignup := doJSON(t, router, http.MethodPost, "/api/auth/verify", "", VerifyRequest{
		Phone: phone, Code: startBody.DevCode, Device: "http-test", Platform: "android", Email: conflictingSignupEmail,
	})
	if conflictingSignup.Code != http.StatusConflict || strings.TrimSpace(conflictingSignup.Body.String()) != `{"error":"credential_unavailable"}` {
		t.Fatalf("signup email conflict response = %d %s", conflictingSignup.Code, conflictingSignup.Body.String())
	}
	start = doJSON(t, router, http.MethodPost, "/api/auth/start", "", StartRequest{Phone: phone})
	decodeJSON(t, start, &startBody)

	email := uniqueTestEmail("first")
	verify := doJSON(t, router, http.MethodPost, "/api/auth/verify", "", VerifyRequest{
		Phone: phone, Code: startBody.DevCode, Device: "http-test", Platform: "android", Email: email,
	})
	if verify.Code != http.StatusOK {
		t.Fatalf("auth/verify status = %d, body=%s", verify.Code, verify.Body.String())
	}
	var verifyBody struct {
		User              User                 `json:"user"`
		Tokens            Tokens               `json:"tokens"`
		EmailVerification VerificationResponse `json:"email_verification"`
	}
	decodeJSON(t, verify, &verifyBody)
	if verifyBody.User.Email == nil || *verifyBody.User.Email != email {
		t.Fatalf("signup email = %v, want %q", verifyBody.User.Email, email)
	}
	if verifyBody.EmailVerification.DevCode == "" {
		t.Fatal("auth/verify response did not include the email verification code in dev")
	}
	access := verifyBody.Tokens.AccessToken
	refresh := verifyBody.Tokens.RefreshToken

	emailVerify := doJSON(t, router, http.MethodPost, "/api/auth/email/verify", access, CodeRequest{Code: verifyBody.EmailVerification.DevCode})
	if emailVerify.Code != http.StatusOK {
		t.Fatalf("email/verify status = %d, body=%s", emailVerify.Code, emailVerify.Body.String())
	}

	wrongReauth := doJSON(t, router, http.MethodPost, "/api/auth/reauth/start", access, ReauthStartRequest{Phone: "+244900000001"})
	if wrongReauth.Code != http.StatusUnauthorized || strings.TrimSpace(wrongReauth.Body.String()) != `{"error":"reauthentication_required"}` {
		t.Fatalf("wrong reauth response = %d %s", wrongReauth.Code, wrongReauth.Body.String())
	}
	reauth := doJSON(t, router, http.MethodPost, "/api/auth/reauth/start", access, ReauthStartRequest{Phone: phone})
	if reauth.Code != http.StatusOK {
		t.Fatalf("reauth/start status = %d, body=%s", reauth.Code, reauth.Body.String())
	}
	var reauthBody VerificationResponse
	decodeJSON(t, reauth, &reauthBody)

	newEmail := uniqueTestEmail("second")
	emailRequest := doJSON(t, router, http.MethodPost, "/api/auth/email/request", access, EmailVerificationRequest{Email: newEmail, ReauthCode: reauthBody.DevCode})
	if emailRequest.Code != http.StatusOK {
		t.Fatalf("email/request status = %d, body=%s", emailRequest.Code, emailRequest.Body.String())
	}
	var emailRequestBody VerificationResponse
	decodeJSON(t, emailRequest, &emailRequestBody)
	wrongEmail := doJSON(t, router, http.MethodPost, "/api/auth/email/verify", access, CodeRequest{Code: "000000"})
	if wrongEmail.Code != http.StatusUnprocessableEntity {
		t.Fatalf("wrong email code status = %d, body=%s", wrongEmail.Code, wrongEmail.Body.String())
	}
	validEmail := doJSON(t, router, http.MethodPost, "/api/auth/email/verify", access, CodeRequest{Code: emailRequestBody.DevCode})
	if validEmail.Code != http.StatusOK {
		t.Fatalf("valid email code status = %d, body=%s", validEmail.Code, validEmail.Body.String())
	}

	other := createTestUser(t, pool)
	otherCode := []byte("other-email-code")
	if err := repo.SetEmailChallenge(ctx, other, "taken@example.com", otherCode, time.Now().Add(10*time.Minute)); err != nil {
		t.Fatalf("set conflicting email: %v", err)
	}
	if _, err := repo.VerifyEmail(ctx, other, otherCode, time.Now()); err != nil {
		t.Fatalf("verify conflicting email owner: %v", err)
	}
	reauth = doJSON(t, router, http.MethodPost, "/api/auth/reauth/start", access, ReauthStartRequest{Phone: phone})
	decodeJSON(t, reauth, &reauthBody)
	conflict := doJSON(t, router, http.MethodPost, "/api/auth/email/request", access, EmailVerificationRequest{Email: "taken@example.com", ReauthCode: reauthBody.DevCode})
	if conflict.Code != http.StatusConflict || strings.TrimSpace(conflict.Body.String()) != `{"error":"credential_unavailable"}` {
		t.Fatalf("email conflict response = %d %s", conflict.Code, conflict.Body.String())
	}

	reauth = doJSON(t, router, http.MethodPost, "/api/auth/reauth/start", access, ReauthStartRequest{Phone: phone})
	decodeJSON(t, reauth, &reauthBody)
	newPhone := uniqueTestPhone()
	phoneStart := doJSON(t, router, http.MethodPost, "/api/auth/phone/change/start", access, PhoneChangeStartRequest{Phone: newPhone, ReauthCode: reauthBody.DevCode})
	if phoneStart.Code != http.StatusOK {
		t.Fatalf("phone/change/start status = %d, body=%s", phoneStart.Code, phoneStart.Body.String())
	}
	var phoneStartBody VerificationResponse
	decodeJSON(t, phoneStart, &phoneStartBody)
	phoneConfirm := doJSON(t, router, http.MethodPost, "/api/auth/phone/change/confirm", access, CodeRequest{Code: phoneStartBody.DevCode})
	if phoneConfirm.Code != http.StatusOK || strings.TrimSpace(phoneConfirm.Body.String()) != `{"changed":true,"sessions_revoked":true}` {
		t.Fatalf("phone/change/confirm response = %d %s", phoneConfirm.Code, phoneConfirm.Body.String())
	}
	changedHash, err := repo.PhoneHashByUser(ctx, verifyBody.User.ID)
	if err != nil {
		t.Fatalf("read changed phone: %v", err)
	}
	if string(changedHash) != string(sha256Bytes(newPhone)) {
		t.Fatalf("phone hash did not change to the verified destination")
	}
	refreshResponse := doJSON(t, router, http.MethodPost, "/api/auth/refresh", "", RefreshRequest{RefreshToken: refresh})
	if refreshResponse.Code != http.StatusUnauthorized {
		t.Fatalf("refresh after phone change status = %d, body=%s", refreshResponse.Code, refreshResponse.Body.String())
	}
}

func doJSON(t *testing.T, router http.Handler, method, path, access string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	if access != "" {
		req.Header.Set("Authorization", "Bearer "+access)
	}
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func decodeJSON(t *testing.T, resp *httptest.ResponseRecorder, dst any) {
	t.Helper()
	if err := json.Unmarshal(resp.Body.Bytes(), dst); err != nil {
		t.Fatalf("decode response %q: %v", resp.Body.String(), err)
	}
}

func uniqueTestPhone() string {
	return fmt.Sprintf("+2449%09d", time.Now().UnixNano()%1_000_000_000)
}

func uniqueTestEmail(prefix string) string {
	return fmt.Sprintf("%s-%s@example.com", prefix, uuid.NewString()[:8])
}
