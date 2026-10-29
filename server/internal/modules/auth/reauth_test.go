package auth

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/CreadorLanda/zwosocial/server/internal/config"
)

func TestReauthInvalidAttemptsInvalidateCode(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		url = os.Getenv("REDIS_URL")
	}
	if url == "" {
		t.Skip("TEST_REDIS_URL or REDIS_URL not set — skipping Redis integration test")
	}
	rdb, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse redis URL: %v", err)
	}
	client := redis.NewClient(rdb)
	t.Cleanup(func() { client.Close() })

	ctx := context.Background()
	userID := uuid.New()
	service := &Service{rdb: client, cfg: config.JWTConfig{OTPPepper: "test-reauth-pepper"}}
	key := reauthKey(userID)
	attemptsKey := reauthAttemptsKey(userID)
	t.Cleanup(func() { client.Del(ctx, key, attemptsKey) })
	if err := client.Set(ctx, key, otpDigest(userID.String(), "123456", service.cfg.OTPPepper), otpTTL).Err(); err != nil {
		t.Fatalf("set reauth code: %v", err)
	}

	for attempt := 1; attempt < maxOTPVerifyAttempts; attempt++ {
		if err := service.consumeReauth(ctx, userID, "000000"); !errors.Is(err, ErrReauthentication) {
			t.Fatalf("attempt %d = %v, want ErrReauthentication", attempt, err)
		}
	}
	if err := service.consumeReauth(ctx, userID, "000000"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("threshold attempt = %v, want ErrRateLimited", err)
	}
	if exists, err := client.Exists(ctx, key).Result(); err != nil || exists != 0 {
		t.Fatalf("reauth code exists=%d err=%v after lockout; want deleted", exists, err)
	}
	if err := service.consumeReauth(ctx, userID, "123456"); !errors.Is(err, ErrReauthentication) {
		t.Fatalf("correct code after lockout = %v, want invalidated", err)
	}
}
