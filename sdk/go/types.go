package zwosocial

import (
	"encoding/json"
	"time"
)

// BotProfile is the bot as the API describes it.
type BotProfile struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

// ChatMember is someone in a chat.
type ChatMember struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	IsBot       bool   `json:"is_bot"`
	Role        string `json:"role"`
}

// Choice is one option value.
type Choice struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

// CommandOption is one argument of a command.
type CommandOption struct {
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	DescriptionPT string   `json:"description_pt,omitempty"`
	Type          string   `json:"type"` // string, number, user, datetime, choice
	Required      bool     `json:"required,omitempty"`
	Choices       []Choice `json:"choices,omitempty"`
	Autocomplete  bool     `json:"autocomplete,omitempty"`
}

// Command is a slash command people see when they type `/`.
type Command struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	DescriptionPT string          `json:"description_pt,omitempty"`
	Options       []CommandOption `json:"options"`
}

// Event is what the gateway and webhooks deliver.
type Event struct {
	ID        int64           `json:"id"`
	Type      string          `json:"type"`
	ChatID    string          `json:"chat_id,omitempty"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"created_at"`
}

// Update is an envelope a person's client addressed to the bot.
type Update struct {
	UpdateID  int64  `json:"update_id"`
	ChatID    string `json:"chat_id"`
	SenderID  string `json:"sender_id"`
	Kind      string `json:"kind"`
	Content   string `json:"content"`
	MessageID *int64 `json:"message_id,omitempty"`
}

// ChatMessage is a message as `message.created` carries it.
type ChatMessage struct {
	ID          int64  `json:"id"`
	ChatID      string `json:"chat_id"`
	SenderID    string `json:"sender_id"`
	Content     string `json:"content"`
	MessageType string `json:"message_type"`
}

// Button, Select… are the parts of an interactive message (#325).
type Component map[string]any

// Card is the bot's card.
type Card struct {
	Title       string      `json:"title,omitempty"`
	Description string      `json:"description,omitempty"`
	Fields      []CardField `json:"fields,omitempty"`
	Thumbnail   string      `json:"thumbnail,omitempty"`
	Footer      string      `json:"footer,omitempty"`
	Color       string      `json:"color,omitempty"`
}

type CardField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// Reply is text, optionally with a card and rows of components.
type Reply struct {
	Text       string        `json:"text"`
	Card       *Card         `json:"card,omitempty"`
	Components [][]Component `json:"components,omitempty"`
	ExpiresAt  string        `json:"expires_at,omitempty"`
}

// Text is a plain reply.
func Text(s string) Reply { return Reply{Text: s} }

// Button is a button component.
func Button(id, label, style string) Component {
	return Component{"type": "button", "id": id, "label": label, "style": style}
}

// LinkButton opens an https link.
func LinkButton(label, url string) Component {
	return Component{"type": "button", "label": label, "style": "link", "url": url}
}

func (r Reply) encode() string {
	if r.Card == nil && len(r.Components) == 0 {
		return r.Text
	}
	b, _ := json.Marshal(map[string]Reply{"zi1": r})
	return string(b)
}
