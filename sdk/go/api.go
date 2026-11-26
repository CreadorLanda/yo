package zwosocial

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// APIError is a non-2xx answer from the Bot API.
type APIError struct {
	Status int
	Code   string
	Detail string
}

func (e *APIError) Error() string { return fmt.Sprintf("%d %s %s", e.Status, e.Code, e.Detail) }

// Client is the Bot API over HTTP. A 429 waits for Retry-After and tries
// again; a 5xx or network failure backs off (0.5 s, 1 s, 2 s…).
type Client struct {
	BaseURL    string
	Token      string
	HTTP       *http.Client
	MaxRetries int
}

func NewClient(baseURL, token string) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTP: &http.Client{Timeout: 30 * time.Second}, MaxRetries: 4}
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+"/api/bot/v1"+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bot "+c.Token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := c.HTTP.Do(req)
		if err != nil {
			if attempt >= c.MaxRetries {
				return err
			}
			if err := sleepCtx(ctx, backoff(attempt)); err != nil {
				return err
			}
			continue
		}
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests && attempt < c.MaxRetries {
			secs, _ := strconv.Atoi(res.Header.Get("Retry-After"))
			if err := sleepCtx(ctx, time.Duration(max(secs, 1))*time.Second); err != nil {
				return err
			}
			continue
		}
		if res.StatusCode >= 500 && res.StatusCode != http.StatusServiceUnavailable && attempt < c.MaxRetries {
			if err := sleepCtx(ctx, backoff(attempt)); err != nil {
				return err
			}
			continue
		}
		if res.StatusCode >= 300 {
			var e struct {
				Error  string `json:"error"`
				Detail string `json:"detail"`
			}
			_ = json.Unmarshal(raw, &e)
			return &APIError{Status: res.StatusCode, Code: e.Error, Detail: e.Detail}
		}
		if out != nil && len(raw) > 0 {
			return json.Unmarshal(raw, out)
		}
		return nil
	}
}

func backoff(attempt int) time.Duration { return time.Duration(500<<attempt) * time.Millisecond }

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (c *Client) Me(ctx context.Context) (BotProfile, error) {
	var p BotProfile
	return p, c.do(ctx, http.MethodGet, "/me", nil, &p)
}

// KeyServer.
func (c *Client) UploadKeys(ctx context.Context, body UploadKeysRequest) (int, error) {
	var res struct {
		OneTimeRemaining int `json:"one_time_remaining"`
	}
	return res.OneTimeRemaining, c.do(ctx, http.MethodPut, "/keys", body, &res)
}

func (c *Client) Bundle(ctx context.Context, username string) (PreKeyBundle, error) {
	var b PreKeyBundle
	return b, c.do(ctx, http.MethodGet, "/users/by-username/"+url.PathEscape(username)+"/keys", nil, &b)
}

func (c *Client) FetchSenderKeys(ctx context.Context, chatID string) (int, []SenderKeyEntry, error) {
	var res struct {
		Epoch int              `json:"epoch"`
		Keys  []SenderKeyEntry `json:"keys"`
	}
	err := c.do(ctx, http.MethodGet, "/groups/"+chatID+"/sender-keys", nil, &res)
	return res.Epoch, res.Keys, err
}

func (c *Client) PublishSenderKeys(ctx context.Context, chatID string, epoch int, entries []SealedKey) error {
	return c.do(ctx, http.MethodPost, "/groups/"+chatID+"/sender-keys", map[string]any{"epoch": epoch, "entries": entries}, nil)
}

// ChatType is "direct" or "group".
func (c *Client) ChatType(ctx context.Context, chatID string) (string, error) {
	info, err := c.Chat(ctx, chatID)
	return info.Type, err
}

// ChatInfo is a chat as the bot sees it.
type ChatInfo struct {
	ID     string   `json:"id"`
	Type   string   `json:"type"`
	Title  string   `json:"title,omitempty"`
	Scopes []string `json:"scopes,omitempty"`
}

// Chat is direct or group; for a group, its title and what the admins allowed the bot.
func (c *Client) Chat(ctx context.Context, chatID string) (ChatInfo, error) {
	var info ChatInfo
	return info, c.do(ctx, http.MethodGet, "/chats/"+chatID, nil, &info)
}

// Moderation (#333): needs members.manage; never works on admins or moderators.

func (c *Client) Mute(ctx context.Context, chatID, userID string, d time.Duration, reason string) error {
	return c.do(ctx, http.MethodPost, "/chats/"+chatID+"/moderation/members/"+userID+"/mute", map[string]any{"seconds": int(d.Seconds()), "reason": reason}, nil)
}

func (c *Client) Unmute(ctx context.Context, chatID, userID string) error {
	return c.do(ctx, http.MethodDelete, "/chats/"+chatID+"/moderation/members/"+userID+"/mute", nil, nil)
}

func (c *Client) Kick(ctx context.Context, chatID, userID, reason string) error {
	return c.do(ctx, http.MethodPost, "/chats/"+chatID+"/moderation/members/"+userID+"/kick", map[string]string{"reason": reason}, nil)
}

func (c *Client) Ban(ctx context.Context, chatID, userID, reason string) error {
	return c.do(ctx, http.MethodPost, "/chats/"+chatID+"/moderation/members/"+userID+"/ban", map[string]string{"reason": reason}, nil)
}

func (c *Client) Unban(ctx context.Context, chatID, userID string) error {
	return c.do(ctx, http.MethodDelete, "/chats/"+chatID+"/moderation/members/"+userID+"/ban", nil, nil)
}

// DeleteAsModerator deletes a member's message for everyone.
func (c *Client) DeleteAsModerator(ctx context.Context, chatID string, messageID int64) error {
	return c.do(ctx, http.MethodDelete, fmt.Sprintf("/chats/%s/moderation/messages/%d", chatID, messageID), nil, nil)
}

func (c *Client) Members(ctx context.Context, chatID string) ([]ChatMember, error) {
	var m []ChatMember
	return m, c.do(ctx, http.MethodGet, "/chats/"+chatID+"/members", nil, &m)
}

func (c *Client) SendMessage(ctx context.Context, chatID, content string, replyTo *int64) (int64, error) {
	body := map[string]any{"content": content, "message_type": "text"}
	if replyTo != nil {
		body["reply_to_id"] = *replyTo
	}
	var res struct {
		ID int64 `json:"id"`
	}
	return res.ID, c.do(ctx, http.MethodPost, "/chats/"+chatID+"/messages", body, &res)
}

func (c *Client) EditMessage(ctx context.Context, chatID string, messageID int64, content string) error {
	return c.do(ctx, http.MethodPatch, fmt.Sprintf("/chats/%s/messages/%d", chatID, messageID), map[string]string{"content": content}, nil)
}

func (c *Client) Ephemeral(ctx context.Context, chatID, userID, content string) error {
	return c.do(ctx, http.MethodPost, "/chats/"+chatID+"/ephemeral", map[string]string{"user_id": userID, "content": content}, nil)
}

func (c *Client) SetCommands(ctx context.Context, commands []Command, chatID string) error {
	path := "/commands"
	if chatID != "" {
		path = "/chats/" + chatID + "/commands"
	}
	for i := range commands {
		if commands[i].Options == nil {
			commands[i].Options = []CommandOption{}
		}
	}
	return c.do(ctx, http.MethodPut, path, map[string]any{"commands": commands}, nil)
}

func (c *Client) AnswerAutocomplete(ctx context.Context, requestID string, choices []Choice) error {
	return c.do(ctx, http.MethodPost, "/autocomplete/"+requestID, map[string]any{"choices": choices}, nil)
}
