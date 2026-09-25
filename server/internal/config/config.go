// Package config loads environment-based configuration once at startup.
package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Env      string
	HTTP     HTTPConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	JWT      JWTConfig
	Crypto   CryptoConfig
	Media    MediaConfig
	Push     PushConfig
	LiveKit  LiveKitConfig
}

// LiveKitConfig points at the self-hosted SFU.
//
// Empty means calls are disabled: the token endpoint answers 503 rather than
// handing out a token to a room nobody can reach.
type LiveKitConfig struct {
	// URL the client dials, e.g. wss://calls.example.com.
	URL string
	// APIKey and APISecret sign the join tokens. The secret never leaves the
	// server — the client receives a signed token, never the key itself.
	APIKey    string
	APISecret string
}

// PushConfig configures the offline push worker.
type PushConfig struct {
	// WebhookURL optional HTTP endpoint that receives push jobs + device tokens.
	// Useful for n8n/Make or a custom relay alongside FCM/Expo delivery.
	WebhookURL string
	// FCMProjectID is the Firebase project id for HTTP v1 sends.
	FCMProjectID string
	// FCMCredentialsFile path to a service-account JSON (or use FCM_CREDENTIALS_JSON).
	FCMCredentialsFile string
	// FCMCredentialsJSON raw service-account JSON body (takes precedence over file).
	FCMCredentialsJSON string
}

// MediaConfig controls on-disk upload storage (S3/R2 later).
type MediaConfig struct {
	// Dir is the absolute/relative root for stored files.
	Dir string
	// TTL is how long a blob may sit on the server before the sweeper
	// removes it, even if not every recipient fetched it.
	TTL time.Duration
	// SweepEvery is how often the retention sweep runs.
	SweepEvery time.Duration
	// MaxUploadBytes caps a single upload (0 = default 25 MiB).
	MaxUploadBytes int64
}

// CryptoConfig holds keys for at-rest encryption of message content.
type CryptoConfig struct {
	MessageKey string
}

type HTTPConfig struct {
	Addr string
}

type PostgresConfig struct {
	URL string
}

type RedisConfig struct {
	URL string
}

type JWTConfig struct {
	Secret          string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	// OTPPepper is a server-only key used to derive OTP verifiers. It must
	// never be stored alongside Redis, because Redis compromise is the threat
	// this key is intended to limit.
	OTPPepper string
}

func Load() (Config, error) {
	cfg := Config{
		// Production is the safe default. Local development declares APP_ENV=dev
		// in server/.env; an omitted variable must never enable dev-only OTP
		// responses in a deployed process.
		Env: getenv("APP_ENV", "prod"),
		HTTP: HTTPConfig{
			Addr: getenv("HTTP_ADDR", ":8080"),
		},
		Postgres: PostgresConfig{
			URL: os.Getenv("POSTGRES_URL"),
		},
		Redis: RedisConfig{
			URL: os.Getenv("REDIS_URL"),
		},
		JWT: JWTConfig{
			Secret:          os.Getenv("JWT_SECRET"),
			AccessTokenTTL:  getenvDuration("JWT_ACCESS_TTL", 15*time.Minute),
			RefreshTokenTTL: getenvDuration("JWT_REFRESH_TTL", 30*24*time.Hour),
			OTPPepper:       os.Getenv("OTP_PEPPER"),
		},
		Crypto: CryptoConfig{
			// Encrypts message content at rest (see internal/crypto).
			// WA_MESSAGE_KEY is a deprecated alias from the removed WhatsApp
			// bridge — kept so existing deployments keep decrypting. Drop it
			// once every environment sets MESSAGE_KEY.
			MessageKey: getenv("MESSAGE_KEY", os.Getenv("WA_MESSAGE_KEY")),
		},
		Media: MediaConfig{
			Dir:            getenv("MEDIA_DIR", "./data/media"),
			MaxUploadBytes: getenvInt64("MEDIA_MAX_BYTES", 25<<20),
			TTL:            getenvDuration("MEDIA_TTL", 30*24*time.Hour),
			SweepEvery:     getenvDuration("MEDIA_SWEEP_EVERY", time.Hour),
		},
		LiveKit: LiveKitConfig{
			URL:       os.Getenv("LIVEKIT_URL"),
			APIKey:    os.Getenv("LIVEKIT_API_KEY"),
			APISecret: os.Getenv("LIVEKIT_API_SECRET"),
		},
		Push: PushConfig{
			WebhookURL:         os.Getenv("PUSH_WEBHOOK_URL"),
			FCMProjectID:       os.Getenv("FCM_PROJECT_ID"),
			FCMCredentialsFile: os.Getenv("FCM_CREDENTIALS_FILE"),
			FCMCredentialsJSON: os.Getenv("FCM_CREDENTIALS_JSON"),
		},
	}

	var missing []string
	if cfg.Postgres.URL == "" {
		missing = append(missing, "POSTGRES_URL")
	}
	if cfg.Redis.URL == "" {
		missing = append(missing, "REDIS_URL")
	}
	if cfg.JWT.Secret == "" {
		missing = append(missing, "JWT_SECRET")
	}
	if len(missing) > 0 {
		return cfg, fmt.Errorf("missing required env vars: %v", missing)
	}
	if len(cfg.JWT.Secret) < 32 {
		return cfg, errors.New("JWT_SECRET must be at least 32 bytes")
	}
	if cfg.Env != "dev" && cfg.Env != "prod" {
		return cfg, errors.New("APP_ENV must be either dev or prod")
	}
	if cfg.Env == "prod" && cfg.Crypto.MessageKey != "" {
		key, err := hex.DecodeString(cfg.Crypto.MessageKey)
		if err != nil || len(key) != 32 {
			return cfg, errors.New("MESSAGE_KEY must be exactly 32 bytes encoded as 64 hex characters")
		}
	}
	if cfg.Env == "prod" && cfg.Crypto.MessageKey == "" {
		return cfg, errors.New("MESSAGE_KEY is required in prod")
	}
	if cfg.Env == "prod" && len(cfg.JWT.OTPPepper) < 32 {
		return cfg, errors.New("OTP_PEPPER must be at least 32 bytes in prod")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		if secs, err := strconv.Atoi(v); err == nil {
			return time.Duration(secs) * time.Second
		}
	}
	return fallback
}

func getenvInt64(key string, fallback int64) int64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}
