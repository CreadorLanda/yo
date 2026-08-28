package stories

import (
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	KindImage    Kind = "image"
	KindVideo    Kind = "video"
	KindText     Kind = "text"
	KindAudio    Kind = "audio"
	KindPoll     Kind = "poll"
	KindQuestion Kind = "question"
)

type Visibility string

const (
	VisPublic   Visibility = "public"
	VisContacts Visibility = "contacts"
	VisClose    Visibility = "close"
)

type Story struct {
	ID           uuid.UUID  `json:"id"`
	AuthorID     uuid.UUID  `json:"author_id"`
	AuthorName   string     `json:"author_name,omitempty"`
	AuthorUser   string     `json:"author_username,omitempty"`
	AuthorAvatar string     `json:"author_avatar,omitempty"`
	Kind         Kind       `json:"kind"`
	Caption      string     `json:"caption"`
	MediaURL     string     `json:"media_url,omitempty"`
	Accent       string     `json:"accent"`
	Visibility   Visibility `json:"visibility"`
	IsAnonymous  bool       `json:"is_anonymous"`
	// Comment policy, chosen at publish time.
	AllowComments         bool      `json:"allow_comments"`
	AllowAnonymousReplies bool      `json:"allow_anonymous_replies"`
	DurationSec           int       `json:"duration_sec"`
	ExpiresAt             time.Time `json:"expires_at"`
	CreatedAt             time.Time `json:"created_at"`
	Viewers               int       `json:"viewers"`
	IsViewed              bool      `json:"is_viewed"`
	IsOwn                 bool      `json:"is_own"`
	// Every emoji left on the story with how many people left it, busiest
	// first. Always present, empty when nobody has reacted.
	Reactions []Reaction `json:"reactions"`
	// What the reader themselves left, in the order they picked it. Separate
	// from the counts because the client needs both: which chips to fill in,
	// and how big each number is.
	MyReactions []string `json:"my_reactions"`
}

// Reaction is one emoji on a story and how many people left it.
type Reaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

// ReactionCatalogue is the set of emoji this server accepts, so a client
// does not have to carry its own copy and drift from it.
//
// The split is presentation only — a client is free to show them as one row.
type ReactionCatalogue struct {
	Standard []string `json:"standard"`
	Extended []string `json:"extended"`
}

type CreateRequest struct {
	Kind        Kind       `json:"kind" binding:"required"`
	Caption     string     `json:"caption"`
	MediaURL    string     `json:"media_url"`
	Accent      string     `json:"accent"`
	Visibility  Visibility `json:"visibility"`
	IsAnonymous bool       `json:"is_anonymous"`
	// Pointers so an omitted field keeps the default rather than meaning
	// false — a client that does not know about these must not switch
	// comments off for every story it publishes.
	AllowComments         *bool `json:"allow_comments"`
	AllowAnonymousReplies *bool `json:"allow_anonymous_replies"`
	DurationSec           int   `json:"duration_sec"`
	// TTLHours is clamped to [StoryTTLMinHours, StoryTTLMaxHours]; 0 means default.
	TTLHours int `json:"ttl_hours"`
}

// ReactRequest sets the whole set of reactions the caller leaves on a story,
// replacing whatever they left before.
//
// Replace rather than add: the client shows the reaction bar with the
// caller's own picks filled in, so "these are my reactions now" is the state
// it already holds. Adding would need a second call to take one back.
type ReactRequest struct {
	// Emoji is the single-emoji form that shipped first, still sent by older
	// clients. Reactions wins when both arrive.
	Emoji string `json:"emoji"`
	// A pointer so an absent field can be told from `[]`: absent is a
	// malformed request, `[]` clears every reaction.
	Reactions *[]string `json:"reactions"`
}

// Viewer is one row of the "seen by" list. Only the story's author can read
// these: who watched is as private as what they watched.
type Viewer struct {
	UserID      uuid.UUID `json:"user_id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name,omitempty"`
	AvatarURI   string    `json:"avatar_uri,omitempty"`
	ViewedAt    time.Time `json:"viewed_at"`
	// Emoji is the viewer's first reaction, kept for clients that predate
	// multiple ones. Read Emojis instead.
	Emoji string `json:"emoji,omitempty"`
	// Every emoji this viewer left, oldest first. Empty when they left none.
	Emojis []string `json:"emojis,omitempty"`
}

// How long a story may be kept alive, in hours.
//
// Exported so the bound has one definition: the client offers these choices
// and the server enforces them, and a mismatch shows up as a story quietly
// expiring earlier than the author was told it would.
const (
	StoryTTLMinHours     = 1
	StoryTTLDefaultHours = 24
	StoryTTLMaxHours     = 72
)
