package channels

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Visibility string
type PostPermission string
type JoinMode string
type MemberRole string
type PostType string

const (
	VisPublic  Visibility = "public"
	VisPrivate Visibility = "private"

	PostAdmins     PostPermission = "admins"
	PostPublishers PostPermission = "publishers"
	PostEveryone   PostPermission = "everyone"

	JoinOpen    JoinMode = "open"
	JoinRequest JoinMode = "request"
	JoinInvite  JoinMode = "invite"

	RoleOwner     MemberRole = "owner"
	RoleAdmin     MemberRole = "admin"
	RolePublisher MemberRole = "publisher"
	RoleMember    MemberRole = "member"
	RoleNone      MemberRole = "none"

	PostText  PostType = "text"
	PostImage PostType = "image"
	PostVideo PostType = "video"
	PostGame  PostType = "game"
	PostLive  PostType = "live"
	PostVoice PostType = "voice"
)

type Channel struct {
	ID                uuid.UUID      `json:"id"`
	OwnerID           uuid.UUID      `json:"owner_id"`
	Name              string         `json:"name"`
	Handle            string         `json:"handle"`
	Description       string         `json:"description"`
	Category          string         `json:"category"`
	AvatarURL         string         `json:"avatar_url,omitempty"`
	CoverURL          string         `json:"cover_url,omitempty"`
	Visibility        Visibility     `json:"visibility"`
	WhoCanPost        PostPermission `json:"who_can_post"`
	CommentsEnabled   bool           `json:"comments_enabled"`
	AllowAnonComments bool           `json:"allow_anon_comments"`
	ReactionsEnabled  bool           `json:"reactions_enabled"`
	JoinMode          JoinMode       `json:"join_mode"`
	Verified          bool           `json:"verified"`
	Members           int            `json:"members"`
	Following         bool           `json:"following"`
	Role              MemberRole     `json:"role"`
	CreatedAt         time.Time      `json:"created_at"`
	Posts             []Post         `json:"posts,omitempty"`
}

type Post struct {
	ID          uuid.UUID       `json:"id"`
	ChannelID   uuid.UUID       `json:"channel_id"`
	AuthorID    uuid.UUID       `json:"author_id"`
	Text        string          `json:"text"`
	PostType    PostType        `json:"post_type"`
	MediaURL    string          `json:"media_url,omitempty"`
	Views       int             `json:"views"`
	CreatedAt   time.Time       `json:"created_at"`
	MyEmoji     string          `json:"my_emoji,omitempty"`
	MyEmojis    []string        `json:"my_emojis,omitempty"`
	Reactions   []React         `json:"reactions,omitempty"`
	GamePayload json.RawMessage `json:"game_payload,omitempty"`
}

type React struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type Comment struct {
	ID         uuid.UUID  `json:"id"`
	PostID     uuid.UUID  `json:"post_id"`
	ParentID   *uuid.UUID `json:"parent_id,omitempty"`
	AuthorID   *uuid.UUID `json:"author_id,omitempty"`
	AuthorName string     `json:"author_name,omitempty"`
	Text       string     `json:"text"`
	Anonymous  bool       `json:"anonymous"`
	CreatedAt  time.Time  `json:"created_at"`
	MyEmojis   []string   `json:"my_emojis,omitempty"`
	Reactions  []React    `json:"reactions,omitempty"`
}

type CreateChannelRequest struct {
	Name              string         `json:"name" binding:"required"`
	Handle            string         `json:"handle" binding:"required"`
	Description       string         `json:"description"`
	Category          string         `json:"category"`
	AvatarURL         string         `json:"avatar_url"`
	CoverURL          string         `json:"cover_url"`
	Visibility        Visibility     `json:"visibility"`
	WhoCanPost        PostPermission `json:"who_can_post"`
	CommentsEnabled   *bool          `json:"comments_enabled"`
	AllowAnonComments *bool          `json:"allow_anon_comments"`
	ReactionsEnabled  *bool          `json:"reactions_enabled"`
	JoinMode          JoinMode       `json:"join_mode"`
}

type PatchChannelRequest struct {
	Name              *string         `json:"name"`
	Handle            *string         `json:"handle"`
	Description       *string         `json:"description"`
	Category          *string         `json:"category"`
	AvatarURL         *string         `json:"avatar_url"`
	CoverURL          *string         `json:"cover_url"`
	Visibility        *Visibility     `json:"visibility"`
	WhoCanPost        *PostPermission `json:"who_can_post"`
	CommentsEnabled   *bool           `json:"comments_enabled"`
	AllowAnonComments *bool           `json:"allow_anon_comments"`
	ReactionsEnabled  *bool           `json:"reactions_enabled"`
	JoinMode          *JoinMode       `json:"join_mode"`
}

type CreatePostRequest struct {
	Text        string          `json:"text"`
	PostType    PostType        `json:"post_type"`
	MediaURL    string          `json:"media_url"`
	GamePayload json.RawMessage `json:"game_payload"`
}

type ReactRequest struct {
	Emoji     string    `json:"emoji"`
	Reactions *[]string `json:"reactions"`
}

type CommentRequest struct {
	Text      string     `json:"text" binding:"required"`
	Anonymous bool       `json:"anonymous"`
	ParentID  *uuid.UUID `json:"parent_id"`
}
