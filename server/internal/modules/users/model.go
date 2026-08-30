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
}

type AvailabilityResponse struct {
	Username  string `json:"username"`
	Available bool   `json:"available"`
}

// PublicView is what one person may see of another.
//
// The `User` struct above carries privacy settings, and `GET /users/search`
// and `GET /users/by-username/:username` were serialising it whole. Searching
// for somebody told you whether they had read receipts off, whether they were
// in ghost mode, and whether their last seen was frozen — which is precisely
// the information those settings exist to withhold. Knowing a person has
// ghost mode on is itself the signal they turned it on to avoid giving.
//
// The comment on `User` has said "Served on /users/me only — see PublicView"
// from the beginning. This is that type; it had never been written.
type PublicView struct {
	ID          uuid.UUID `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Bio         string    `json:"bio,omitempty"`
	AvatarURI   string    `json:"avatar_uri,omitempty"`
}

// PublicViewFor renders a user as seen by someone else.
//
// `share` is whether the two have a chat together — the closest thing this app
// has to being a contact.
//
// Not reciprocal, unlike read receipts or a frozen last seen: hiding your own
// photo does not mean you stop seeing anyone else's. Those settings are
// bargains about a signal you emit; this one is about a picture of your face,
// and there is nothing to trade.
func (u *User) PublicViewFor(share bool) PublicView {
	view := PublicView{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Bio:         u.Bio,
		AvatarURI:   u.AvatarURI,
	}
	if !canSeePhoto(u, share) {
		view.AvatarURI = ""
	}
	return view
}

func canSeePhoto(subject *User, share bool) bool {
	switch subject.PhotoVisibility {
	case VisNobody:
		return false
	case VisContacts:
		return share
	default:
		return true
	}
}
