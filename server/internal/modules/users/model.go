package users

import (
	"time"

	"github.com/google/uuid"
)

// User is the public-facing shape of a user account. Anything the API
// returns lives here; persistence-only fields stay in the repository.
type User struct {
	ID             uuid.UUID `json:"id"`
	Username       string    `json:"username"`
	DisplayName    string    `json:"display_name"`
	Bio            string    `json:"bio,omitempty"`
	AvatarURI      string    `json:"avatar_uri,omitempty"`
	UsernamePublic bool      `json:"username_public"`
	CreatedAt      time.Time `json:"created_at"`

	// Privacy. Served on /users/me only — see PublicView.
	LastSeenVisibility Visibility `json:"last_seen_visibility"`
	PhotoVisibility    Visibility `json:"photo_visibility"`
	// Reciprocal: off means you neither send read receipts nor see anyone
	// else's. A setting that only hides your own is a way to take without
	// giving.
	ReadReceipts bool `json:"read_receipts"`
	// The wider switch: no read receipts, no typing, no recording indicator.
	// Reciprocal on the same terms — see migration 0042.
	GhostMode bool `json:"ghost_mode"`
	// Pinned at the moment it was switched on — see migration 0043.
	LastSeenFrozen bool `json:"last_seen_frozen"`
	// Buys the exception to reciprocity: freeze yours, still see theirs.
	// Read-only over the API — a client that could set this would be
	// granting itself the entitlement.
	IsPremium bool `json:"is_premium"`
	// NULL until they have been seen at all, which a fresh account genuinely
	// has not been. Not the same as hidden.
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
}

// Visibility is who may see a given detail.
type Visibility string

const (
	VisEveryone Visibility = "everyone"
	VisContacts Visibility = "contacts"
	VisNobody   Visibility = "nobody"
)

func (v Visibility) valid() bool {
	return v == VisEveryone || v == VisContacts || v == VisNobody
}

// PatchRequest is the body of PATCH /users/me. Pointer fields mean "only
// touch the columns the client actually sent".
type PatchRequest struct {
	Username       *string `json:"username,omitempty"        binding:"omitempty,min=3,max=20"`
	DisplayName    *string `json:"display_name,omitempty"    binding:"omitempty,min=1,max=100"`
	Bio            *string `json:"bio,omitempty"             binding:"omitempty,max=500"`
	AvatarURI      *string `json:"avatar_uri,omitempty"      binding:"omitempty,url"`
	UsernamePublic *bool   `json:"username_public,omitempty"`

	LastSeenVisibility *Visibility `json:"last_seen_visibility,omitempty"`
	PhotoVisibility    *Visibility `json:"photo_visibility,omitempty"`
	ReadReceipts       *bool       `json:"read_receipts,omitempty"`
	GhostMode          *bool       `json:"ghost_mode,omitempty"`
	LastSeenFrozen     *bool       `json:"last_seen_frozen,omitempty"`
}

type AvailabilityResponse struct {
	Username  string `json:"username"`
	Available bool   `json:"available"`
}
