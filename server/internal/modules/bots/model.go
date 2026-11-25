// Package bots is the bot platform: bot accounts, their tokens, where they
// are installed and with which permissions, and the auth that lets a bot use
// the API (#321). How bots fit end-to-end encryption is decided in
// docs/decisions/0002-bots-and-e2ee.md: a bot is a participant with its own
// keys, never something the server decrypts for.
package bots

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Scope is one permission a chat grants a bot.
type Scope string

const (
	// ScopeReadCommands lets the bot receive what is addressed to it: slash
	// commands, mentions, replies and interactions. Privacy mode (ADR 0002).
	ScopeReadCommands Scope = "messages.read.commands"
	// ScopeReadAll lets the bot read every message in the chat. Explicit,
	// visible to every member, and admin-only.
	ScopeReadAll Scope = "messages.read.all"
	ScopeSend    Scope = "messages.send"
	ScopeMembers Scope = "members.read"
	// ScopeManage lets the bot change membership. Reserved for moderation.
	ScopeManage Scope = "members.manage"
	ScopeEvents Scope = "events.manage"
)

// DefaultScopes is what a bot gets when the installer asks for nothing
// specific: answer what is addressed to it, and know who it is talking to.
var DefaultScopes = []Scope{ScopeReadCommands, ScopeSend, ScopeMembers}

var knownScopes = map[Scope]bool{
	ScopeReadCommands: true, ScopeReadAll: true, ScopeSend: true,
	ScopeMembers: true, ScopeManage: true, ScopeEvents: true,
}

// MaxBotsPerOwner bounds how many bots one person can create.
const MaxBotsPerOwner = 20

var (
	ErrNotFound         = errors.New("bot_not_found")
	ErrNotOwner         = errors.New("not_bot_owner")
	ErrInvalidUsername  = errors.New("invalid_bot_username")
	ErrUsernameTaken    = errors.New("username_taken")
	ErrInvalidName      = errors.New("invalid_bot_name")
	ErrDescriptionLong  = errors.New("description_too_long")
	ErrTooManyBots      = errors.New("too_many_bots")
	ErrInvalidScope     = errors.New("invalid_scope")
	ErrChatNotFound     = errors.New("chat_not_found")
	ErrNotGroupAdmin    = errors.New("not_group_admin")
	ErrNotInstalled     = errors.New("bot_not_installed")
	ErrAlreadyInstalled = errors.New("bot_already_installed")
	ErrChatNotSupported = errors.New("chat_not_supported")
	ErrInvalidToken     = errors.New("invalid_bot_token")
	ErrScopeMissing     = errors.New("scope_missing")
	ErrRateLimited      = errors.New("rate_limited")
)

// Bot is what an owner, an installer or the bot itself sees.
type Bot struct {
	ID          uuid.UUID `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	AvatarURL   string    `json:"avatar_url,omitempty"`
	Description string    `json:"description"`
	PrivacyMode bool      `json:"privacy_mode"`
	Verified    bool      `json:"verified"`
	OwnerID     uuid.UUID `json:"owner_id"`
	CreatedAt   time.Time `json:"created_at"`
	// Suspended bots cannot authenticate (#343).
	Suspended       bool   `json:"suspended,omitempty"`
	SuspendedReason string `json:"suspended_reason,omitempty"`
}

// Token is a bot token's metadata. The secret itself is only ever in
// CreatedToken, returned once.
type Token struct {
	ID         uuid.UUID  `json:"id"`
	Prefix     string     `json:"prefix"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

// CreatedToken is the one response that carries the secret.
type CreatedToken struct {
	Token
	Secret string `json:"token"`
}

// Installation is a bot in a chat, with what that chat allowed it.
type Installation struct {
	ChatID      uuid.UUID  `json:"chat_id"`
	Bot         Bot        `json:"bot"`
	Scopes      []Scope    `json:"scopes"`
	InstalledBy *uuid.UUID `json:"installed_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Member is a chat participant as a bot with members.read sees it.
type Member struct {
	UserID      uuid.UUID `json:"user_id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	IsBot       bool      `json:"is_bot"`
	Role        string    `json:"role"`
}

// CreateRequest makes a bot.
type CreateRequest struct {
	Username    string `json:"username" binding:"required"`
	DisplayName string `json:"display_name" binding:"required"`
	Description string `json:"description"`
}

// UpdateRequest edits a bot; nil fields are left alone.
type UpdateRequest struct {
	DisplayName *string `json:"display_name"`
	Description *string `json:"description"`
	AvatarURL   *string `json:"avatar_url"`
	PrivacyMode *bool   `json:"privacy_mode"`
}

// InstallRequest adds a bot to a chat. Either BotID or Username.
type InstallRequest struct {
	BotID    *uuid.UUID `json:"bot_id"`
	Username string     `json:"username"`
	Scopes   []Scope    `json:"scopes"`
}

// ScopesRequest replaces an installation's scopes.
type ScopesRequest struct {
	Scopes []Scope `json:"scopes" binding:"required"`
}

// Principal is the bot a request authenticated as.
type Principal struct {
	BotID    uuid.UUID
	DeviceID uuid.UUID
}
