// Package posts holds what stays on a profile: carousel posts and reels.
package posts

import (
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	// KindPost is one to MaxMedia photos or videos, shown as a carousel.
	KindPost Kind = "post"
	// KindReel is a single video.
	KindReel Kind = "reel"
)

type Visibility string

const (
	VisPublic   Visibility = "public"
	VisContacts Visibility = "contacts"
)

const (
	// MaxMedia is how many slides a carousel holds.
	MaxMedia = 10
	// MaxCaptionRunes mirrors the CHECK on posts.caption.
	MaxCaptionRunes = 2200
	// DefaultPageSize and MaxPageSize bound one page of a profile grid.
	DefaultPageSize = 30
	MaxPageSize     = 60
)

// Media is one slide.
type Media struct {
	ID   uuid.UUID `json:"id"`
	Kind string    `json:"kind"`
	// URL is the path the client fetches the bytes from (same-origin API).
	URL        string `json:"url"`
	Width      *int   `json:"width,omitempty"`
	Height     *int   `json:"height,omitempty"`
	DurationMs *int   `json:"duration_ms,omitempty"`
}

type Post struct {
	ID           uuid.UUID  `json:"id"`
	AuthorID     uuid.UUID  `json:"author_id"`
	AuthorName   string     `json:"author_name,omitempty"`
	AuthorUser   string     `json:"author_username,omitempty"`
	AuthorAvatar string     `json:"author_avatar,omitempty"`
	Kind         Kind       `json:"kind"`
	Caption      string     `json:"caption"`
	Visibility   Visibility `json:"visibility"`
	// Always present, in slide order. Empty only if every blob was deleted
	// after the post was made.
	Media     []Media   `json:"media"`
	IsOwn     bool      `json:"is_own"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateRequest struct {
	Kind       Kind       `json:"kind" binding:"required"`
	Caption    string     `json:"caption"`
	Visibility Visibility `json:"visibility"`
	// Ids returned by POST /media, in slide order. The caller must own them.
	MediaIDs []uuid.UUID `json:"media_ids" binding:"required"`
}

// ListQuery is one page of one author's grid.
type ListQuery struct {
	Author uuid.UUID
	// Empty means both kinds.
	Kind Kind
	// Zero means from the newest.
	Before time.Time
	Limit  int
}
