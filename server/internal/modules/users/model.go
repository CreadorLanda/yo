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
}

type AvailabilityResponse struct {
	Username  string `json:"username"`
	Available bool   `json:"available"`
}
