package users

import (
	"time"

	"github.com/google/uuid"
)

// OnboardingPreferences stores user onboarding choices.
type OnboardingPreferences struct {
	UserID          uuid.UUID `json:"user_id" db:"user_id"`
	Notifications   bool      `json:"notifications" db:"notifications"`
	ContactsVisible bool      `json:"contacts_visible" db:"contacts_visible"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}
