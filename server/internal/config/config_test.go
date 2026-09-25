package config

import (
	"strings"
	"testing"
)

func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("POSTGRES_URL", "postgres://test")
	t.Setenv("REDIS_URL", "redis://test")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
}

func TestLoadRejectsProductionWithoutMessageKey(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_ENV", "prod")
	t.Setenv("MESSAGE_KEY", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "MESSAGE_KEY") {
		t.Fatalf("Load() error = %v, want missing MESSAGE_KEY", err)
	}
}

func TestLoadRejectsInvalidProductionMessageKey(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_ENV", "prod")
	t.Setenv("MESSAGE_KEY", "not-a-key")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "64 hex") {
		t.Fatalf("Load() error = %v, want invalid MESSAGE_KEY", err)
	}
}

func TestLoadDefaultsToProduction(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_ENV", "")
	t.Setenv("MESSAGE_KEY", strings.Repeat("a", 64))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Env != "prod" {
		t.Fatalf("Env = %q, want prod", cfg.Env)
	}
}
