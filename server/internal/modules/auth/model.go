package auth

import (
	"time"

	"github.com/google/uuid"
)

// User is the persisted view of an account. Phone is stored only as a hash.
type User struct {
	ID              uuid.UUID  `json:"id"`
	Username        string     `json:"username"`
	DisplayName     string     `json:"display_name"`
	CreatedAt       time.Time  `json:"created_at"`
	Email           *string    `json:"email,omitempty"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	PendingEmail    *string    `json:"-"`
}

// Device represents one signed-in client (phone, web, desktop).
type Device struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	Name       string    `json:"name"`
	Platform   string    `json:"platform"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// Tokens are returned after a successful verify.
type Tokens struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// StartRequest begins phone verification.
type StartRequest struct {
	Phone string `json:"phone" binding:"required,e164"`
}

// VerifyRequest exchanges a phone + OTP for tokens.
type VerifyRequest struct {
	Phone    string `json:"phone" binding:"required,e164"`
	Code     string `json:"code"  binding:"required,len=6"`
	Device   string `json:"device" binding:"required"`
	Platform string `json:"platform" binding:"required,oneof=ios android web desktop"`
	Email    string `json:"email" binding:"omitempty,email,max=254"`
	// DeviceKey is generated once per installation and kept by the client, so
	// signing in again reuses that device row instead of creating another.
	// Optional: an older client that does not send one still gets a new row.
	DeviceKey string `json:"device_key" binding:"omitempty,max=64"`
}

type EmailVerificationRequest struct {
	Email      string `json:"email" binding:"required,email,max=254"`
	ReauthCode string `json:"reauth_code" binding:"omitempty,len=6"`
}

type CodeRequest struct {
	Code string `json:"code" binding:"required,len=6"`
}

type ReauthStartRequest struct {
	Phone string `json:"phone" binding:"required,e164"`
}

type PhoneChangeStartRequest struct {
	Phone      string `json:"phone" binding:"required,e164"`
	ReauthCode string `json:"reauth_code" binding:"required,len=6"`
}

type VerificationResponse struct {
	Sent    bool   `json:"sent"`
	DevCode string `json:"dev_code,omitempty"`
}

// RefreshRequest exchanges a refresh token for a new access token.
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}
