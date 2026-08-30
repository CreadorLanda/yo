// Package messages implements native E2E-encrypted messaging for Socialize.
//
// Message content is an opaque client-generated E2EE envelope. The repository
// may apply an independent at-rest encryption layer; it is not an E2EE key.
package messages

import (
	"time"

	"github.com/google/uuid"
)

// ── Chat ────────────────────────────────────────────────────────────────────

type ChatType string

const (
	ChatDirect ChatType = "direct"
	ChatGroup  ChatType = "group"
)

type ChatStatus string

const (
	ChatStatusActive  ChatStatus = "active"
	ChatStatusPending ChatStatus = "pending"
	ChatStatusBlocked ChatStatus = "blocked"
)

type Chat struct {
	ID          uuid.UUID       `json:"id"`
	Type        ChatType        `json:"type"`
	Title       *string         `json:"title,omitempty"`
	AvatarURL   *string         `json:"avatar_url,omitempty"`
	CreatedBy   uuid.UUID       `json:"created_by"`
	Status      ChatStatus      `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	LastMessage *MessagePreview `json:"last_message,omitempty"`
	UnreadCount int             `json:"unread_count"`
	// Direct-chat peer (client E2EE session establishment).
	PeerUserID   *uuid.UUID `json:"peer_user_id,omitempty"`
	PeerUsername *string    `json:"peer_username,omitempty"`
	// Presence, and only what this viewer is allowed to know. Both nil when
	// they may not know at all; PeerLastSeen nil on its own for someone who
	// has never been seen, which is a different thing.
	PeerOnline   *bool      `json:"peer_online,omitempty"`
	PeerLastSeen *time.Time `json:"peer_last_seen,omitempty"`
	// Per-user settings. Two participants can disagree on all three.
	PinnedAt   *time.Time `json:"pinned_at,omitempty"`
	MutedUntil *time.Time `json:"muted_until,omitempty"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
	// 0 = off. Each message's clock starts when it is read.
	DisappearSeconds int `json:"disappear_seconds"`
}

// ListChatsOptions pages the chat list and selects the archived slice.
type ListChatsOptions struct {
	Limit    int
	Offset   int
	Archived bool
}

// DefaultChatPageSize caps an unbounded list request.
const (
	DefaultChatPageSize = 50
	MaxChatPageSize     = 200
)

// Normalize clamps caller-supplied paging into a sane range.
func (o *ListChatsOptions) Normalize() {
	if o.Limit <= 0 {
		o.Limit = DefaultChatPageSize
	}
	if o.Limit > MaxChatPageSize {
		o.Limit = MaxChatPageSize
	}
	if o.Offset < 0 {
		o.Offset = 0
	}
}

// ChatSettingsRequest is a partial update — nil means "leave unchanged",
// so a client can toggle one flag without reading the others first.
type ChatSettingsRequest struct {
	Pinned   *bool `json:"pinned,omitempty"`
	Muted    *bool `json:"muted,omitempty"`
	Archived *bool `json:"archived,omitempty"`
}

type MessagePreview struct {
	Content string `json:"content"`
	// MessageType lets the chat list label non-text messages ("Sticker",
	// "Photo") instead of rendering their encoded payload.
	MessageType MessageType `json:"message_type"`
	// Absent when the sender deleted their account. See Message.SenderID.
	SenderID  *uuid.UUID `json:"sender_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// ── Message ─────────────────────────────────────────────────────────────────

type MessageType string

const (
	MsgText     MessageType = "text"
	MsgImage    MessageType = "image"
	MsgVideo    MessageType = "video"
	MsgAudio    MessageType = "audio"
	MsgDocument MessageType = "document"
	MsgSticker  MessageType = "sticker"
	MsgLocation MessageType = "location"
	MsgContact  MessageType = "contact"
	MsgPoll     MessageType = "poll"
	MsgEvent    MessageType = "event"
	MsgSystem   MessageType = "system"
	MsgReply    MessageType = "reply"
	MsgGame     MessageType = "game"
	// MsgCall is the row a call leaves in the conversation. Its content is
	// the call id, and the client resolves the outcome from the call log —
	// the outcome changes after the message is written, so it cannot be
	// baked into the text.
	MsgCall MessageType = "call"
)

type Message struct {
	ID     int64     `json:"id"`
	ChatID uuid.UUID `json:"chat_id"`
	// SenderID is absent when the sender deleted their account.
	//
	// Nil rather than a tombstone id: a zero UUID compared against a real one
	// is the kind of thing that reads as working and produces a wrong answer
	// later. Absent means absent, and every comparison against it fails, which
	// is the correct outcome — nobody is the sender of an unattributed message.
	SenderID     *uuid.UUID  `json:"sender_id,omitempty"`
	Content      string      `json:"content"` // plaintext (client input / decrypted output)
	MessageType  MessageType `json:"message_type"`
	ReplyToID    *int64      `json:"reply_to_id,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
	EditedAt     *time.Time  `json:"edited_at,omitempty"`
	DeletedAt    *time.Time  `json:"deleted_at,omitempty"`
	SenderName   string      `json:"sender_name,omitempty"`
	SenderAvatar string      `json:"sender_avatar,omitempty"`
	// Receipt summary for the requesting user / chat (optional enrichment).
	// PollVotes carries per-option tallies for poll messages. The body itself
	// is end-to-end encrypted, so this is the only tally the server can serve.
	PollVotes *PollTally `json:"poll_votes,omitempty"`
	// Set once the message has been read, in a chat with a timer. Null
	// means either no timer or not read yet.
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	// 0 for anything written here; 1+ once it has been passed along.
	ForwardCount    int     `json:"forward_count,omitempty"`
	SourceChannelID *string `json:"source_channel_id,omitempty"`
	SourcePostID    *string `json:"source_post_id,omitempty"`
	DeliveredTo     int     `json:"delivered_to,omitempty"`
	ReadBy          int     `json:"read_by,omitempty"`
	// ViewLimit caps how many times each recipient may open the message.
	// Nil means unlimited.
	ViewLimit *int `json:"view_limit,omitempty"`
	// ViewsLeft is how many opens the requesting user has remaining. Only
	// meaningful when ViewLimit is set.
	ViewsLeft *int `json:"views_left,omitempty"`
	// Reactions on this message. Sent with history because the client had no
	// other way to learn about them — it only ever heard the live event, so
	// every reaction vanished when the chat was reopened.
	Reactions []Reaction `json:"reactions,omitempty"`
}

// ReceiptStatus is the delivery lifecycle of a message for one recipient.
type ReceiptStatus string

const (
	ReceiptDelivered ReceiptStatus = "delivered"
	ReceiptRead      ReceiptStatus = "read"
)

// ReceiptDetail is one recipient's delivery state, for the message-info
// screen. Only the sender may read this.
type ReceiptDetail struct {
	UserID      uuid.UUID     `json:"user_id"`
	DisplayName string        `json:"display_name"`
	Username    string        `json:"username"`
	Status      ReceiptStatus `json:"status"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

type Receipt struct {
	MessageID int64         `json:"message_id"`
	UserID    uuid.UUID     `json:"user_id"`
	Status    ReceiptStatus `json:"status"`
	UpdatedAt time.Time     `json:"updated_at"`
}

type Reaction struct {
	MessageID int64     `json:"message_id"`
	UserID    uuid.UUID `json:"user_id"`
	Emoji     string    `json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
}

// ── Requests / Responses ────────────────────────────────────────────────────

type CreateChatRequest struct {
	// For direct chats, the peer's user ID (resolved from username server-side).
	PeerUserID uuid.UUID `json:"peer_user_id" binding:"required"`
}

type CreateChatResponse struct {
	ChatID uuid.UUID `json:"chat_id"`
	Chat   Chat      `json:"chat"`
}

type SendMessageRequest struct {
	Content     string      `json:"content" binding:"required"`
	MessageType MessageType `json:"message_type"`
	ReplyToID   *int64      `json:"reply_to_id,omitempty"`
	// ViewLimit makes this a limited-view message. Nil = unlimited.
	ViewLimit *int `json:"view_limit,omitempty"`
	// ForwardCount is the count carried by the content being forwarded. The
	// server stores one more than this, so a client cannot launder a
	// heavily-forwarded message by claiming zero.
	ForwardCount *int `json:"forward_count,omitempty"`
	// Where a forwarded channel post came from, so the bubble can link back.
	SourceChannelID *string `json:"source_channel_id,omitempty"`
	SourcePostID    *string `json:"source_post_id,omitempty"`
}

type EditMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

type ReceiptRequest struct {
	// MessageIDs to mark delivered/read in one shot.
	MessageIDs []int64       `json:"message_ids" binding:"required"`
	Status     ReceiptStatus `json:"status" binding:"required"`
}

type MarkReadRequest struct {
	// Up to and including this message id.
	MessageID int64 `json:"message_id" binding:"required"`
}

type TypingRequest struct {
	Typing bool `json:"typing"`
	// Kind distinguishes composing from holding the mic. They look identical
	// from the other side and mean very different things to the person
	// waiting: typing resolves in seconds, a voice note can take a minute.
	//
	// Empty means "typing", so an older client keeps working unchanged.
	Kind string `json:"kind,omitempty"`
}

type ReactRequest struct {
	Emoji string `json:"emoji" binding:"required"`
}

type ListMessagesQuery struct {
	Limit  int `form:"limit"`
	Before int `form:"before"` // cursor: message ID to fetch older than
}

// ── Internal row shapes ─────────────────────────────────────────────────────

type messageRow struct {
	ID          int64
	ChatID      uuid.UUID
	SenderID    *uuid.UUID
	Content     string // ciphertext hex
	MessageType string
	ReplyToID   *int64
	CreatedAt   time.Time
	EditedAt    *time.Time
	DeletedAt   *time.Time
}

// PollTally is the vote state of one poll, as the server can see it: counts
// keyed by the client's opaque option ids, and which of them the caller chose.
type PollTally struct {
	Counts map[string]int `json:"counts"`
	Mine   []string       `json:"mine"`
}
