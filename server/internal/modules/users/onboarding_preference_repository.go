package users

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OnboardingPreferenceRepository handles persistence of onboarding preferences.
type OnboardingPreferenceRepository struct {
	db *pgxpool.Pool
}

// NewOnboardingPreferenceRepository creates a new repository.
func NewOnboardingPreferenceRepository(db *pgxpool.Pool) *OnboardingPreferenceRepository {
	return &OnboardingPreferenceRepository{db: db}
}

// Save persists the onboarding preferences.
func (r *OnboardingPreferenceRepository) Save(ctx context.Context, prefs *OnboardingPreferences) error {
	// Check if user exists
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, prefs.UserID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("user not found: %s", prefs.UserID)
	}

	_, err = r.db.Exec(ctx, `
		UPDATE users SET
			contacts_visible = $2,
			updated_at = NOW()
		WHERE id = $1`,
		prefs.UserID, prefs.ContactsVisible)
	return err
}

// Load retrieves the onboarding preferences.
func (r *OnboardingPreferenceRepository) Load(ctx context.Context, userID uuid.UUID) (*OnboardingPreferences, error) {
	var prefs OnboardingPreferences
	err := r.db.QueryRow(ctx, `
		SELECT contacts_visible, updated_at
		FROM users WHERE id = $1`, userID).Scan(
		&prefs.ContactsVisible, &prefs.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Return default preferences if user not found
			return &OnboardingPreferences{
				UserID:          userID,
				ContactsVisible: true,
			}, nil
		}
		return nil, err
	}
	prefs.UserID = userID
	return &prefs, nil
}

// HasCompletedOnboarding checks if the user has completed onboarding.
func (r *OnboardingPreferenceRepository) HasCompletedOnboarding(ctx context.Context, userID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
