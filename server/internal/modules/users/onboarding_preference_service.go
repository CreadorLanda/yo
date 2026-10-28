package users

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// OnboardingService handles business logic for onboarding preferences.
type OnboardingService struct {
	repo *OnboardingPreferenceRepository
}

// NewOnboardingService creates a new service.
func NewOnboardingService(repo *OnboardingPreferenceRepository) *OnboardingService {
	return &OnboardingService{repo: repo}
}

// SavePreferences persists the onboarding preferences.
func (s *OnboardingService) SavePreferences(ctx context.Context, userID uuid.UUID, notifications bool, contactsVisible bool) error {
	prefs := &OnboardingPreferences{
		UserID:          userID,
		Notifications:   notifications,
		ContactsVisible: contactsVisible,
		UpdatedAt:       time.Now(),
	}
	return s.repo.Save(ctx, prefs)
}

// GetPreferences retrieves the onboarding preferences.
func (s *OnboardingService) GetPreferences(ctx context.Context, userID uuid.UUID) (*OnboardingPreferences, error) {
	return s.repo.Load(ctx, userID)
}

// MarkOnboardingCompleted marks onboarding as completed.
func (s *OnboardingService) MarkOnboardingCompleted(ctx context.Context, userID uuid.UUID) error {
	// Set both preferences to true as part of completing onboarding
	return s.repo.Save(ctx, &OnboardingPreferences{
		UserID:          userID,
		Notifications:   true,
		ContactsVisible: true,
		UpdatedAt:       time.Now(),
	})
}
