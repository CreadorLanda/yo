package bots

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// Slash commands (#324). A bot registers what it answers to; a person typing
// `/` sees the commands of the bots in the chat. The registry is public
// metadata. What someone types into a command goes to the bot encrypted
// (the #322 inbox), and an autocomplete query does too.

type OptionType string

const (
	OptString   OptionType = "string"
	OptNumber   OptionType = "number"
	OptUser     OptionType = "user"
	OptDateTime OptionType = "datetime"
	OptChoice   OptionType = "choice"
)

const (
	maxCommands         = 100
	maxOptions          = 10
	maxChoices          = 25
	maxCommandDesc      = 100
	maxChoiceLen        = 100
	autocompleteTimeout = 3 * time.Second
	maxAutocompleteResp = 25
	// EventCommandAutocomplete asks a bot for choices; it answers through
	// POST /api/bot/v1/autocomplete/:request_id within autocompleteTimeout.
	EventCommandAutocomplete = "command.autocomplete"
)

var (
	commandName = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

	ErrInvalidCommand       = errors.New("invalid_command")
	ErrAutocompleteTimeout  = errors.New("autocomplete_timeout")
	ErrAutocompleteNotFound = errors.New("autocomplete_request_not_found")
)

func init() { knownEvents[EventCommandAutocomplete] = true }

// Choice is one value a choice option (or an autocomplete answer) offers.
type Choice struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

// CommandOption is one argument of a command.
type CommandOption struct {
	Name          string     `json:"name"`
	Description   string     `json:"description"`
	DescriptionPT string     `json:"description_pt,omitempty"`
	Type          OptionType `json:"type"`
	Required      bool       `json:"required,omitempty"`
	Choices       []Choice   `json:"choices,omitempty"`
	// Autocomplete asks the bot for choices as the person types.
	Autocomplete bool `json:"autocomplete,omitempty"`
}

// Command is a slash command as a bot registers it.
type Command struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	DescriptionPT string          `json:"description_pt,omitempty"`
	Options       []CommandOption `json:"options"`
}

// ChatCommand is a command as a person sees it in a chat: with its bot.
type ChatCommand struct {
	Command
	Bot CommandBot `json:"bot"`
}

// CommandBot is the little of a bot the command list shows.
type CommandBot struct {
	ID          uuid.UUID `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	AvatarURL   string    `json:"avatar_url,omitempty"`
}

// CommandsRequest replaces a set of commands.
type CommandsRequest struct {
	Commands []Command `json:"commands"`
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidCommand, fmt.Sprintf(format, args...))
}

func validText(s string, max int, required bool) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	return n <= max && (!required || n > 0)
}

// validateCommands checks a full set before anything is stored.
func validateCommands(in []Command) error {
	if len(in) > maxCommands {
		return invalid("at most %d commands", maxCommands)
	}
	seen := map[string]bool{}
	for _, c := range in {
		if !commandName.MatchString(c.Name) {
			return invalid("name %q: 1-32 of a-z 0-9 _ -", c.Name)
		}
		if seen[c.Name] {
			return invalid("duplicate command %q", c.Name)
		}
		seen[c.Name] = true
		if !validText(c.Description, maxCommandDesc, true) || !validText(c.DescriptionPT, maxCommandDesc, false) {
			return invalid("%s: description 1-%d characters", c.Name, maxCommandDesc)
		}
		if len(c.Options) > maxOptions {
			return invalid("%s: at most %d options", c.Name, maxOptions)
		}
		optSeen := map[string]bool{}
		optional := false
		for _, o := range c.Options {
			if !commandName.MatchString(o.Name) || optSeen[o.Name] {
				return invalid("%s: option name %q", c.Name, o.Name)
			}
			optSeen[o.Name] = true
			if !validText(o.Description, maxCommandDesc, true) || !validText(o.DescriptionPT, maxCommandDesc, false) {
				return invalid("%s.%s: description 1-%d characters", c.Name, o.Name, maxCommandDesc)
			}
			switch o.Type {
			case OptString, OptNumber, OptUser, OptDateTime:
				if len(o.Choices) > 0 {
					return invalid("%s.%s: only choice options have choices", c.Name, o.Name)
				}
			case OptChoice:
				if len(o.Choices) == 0 || len(o.Choices) > maxChoices {
					return invalid("%s.%s: 1-%d choices", c.Name, o.Name, maxChoices)
				}
				for _, ch := range o.Choices {
					if !validChoice(ch) {
						return invalid("%s.%s: choice %q", c.Name, o.Name, ch.Name)
					}
				}
			default:
				return invalid("%s.%s: type %q", c.Name, o.Name, o.Type)
			}
			if o.Autocomplete && o.Type != OptString && o.Type != OptNumber {
				return invalid("%s.%s: autocomplete is for string and number options", c.Name, o.Name)
			}
			if o.Required && optional {
				return invalid("%s.%s: required options come before optional ones", c.Name, o.Name)
			}
			optional = optional || !o.Required
		}
	}
	return nil
}

func validChoice(ch Choice) bool {
	if !validText(ch.Name, maxChoiceLen, true) {
		return false
	}
	switch v := ch.Value.(type) {
	case string:
		return utf8.RuneCountInString(v) <= maxChoiceLen
	case float64:
		return true
	}
	return false
}

// ── Repository ──────────────────────────────────────────────────────────────

// ReplaceCommands swaps one scope's commands (global when chatID is nil).
func (r *Repository) ReplaceCommands(ctx context.Context, botID uuid.UUID, chatID *uuid.UUID, cmds []Command) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		DELETE FROM bot_commands WHERE bot_id = $1 AND chat_id IS NOT DISTINCT FROM $2
	`, botID, chatID); err != nil {
		return err
	}
	for i, c := range cmds {
		opts, err := json.Marshal(nonNilOptions(c.Options))
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO bot_commands (bot_id, chat_id, name, description, description_pt, options, position)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
		`, botID, chatID, c.Name, strings.TrimSpace(c.Description), strings.TrimSpace(c.DescriptionPT), string(opts), i); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func nonNilOptions(o []CommandOption) []CommandOption {
	if o == nil {
		return []CommandOption{}
	}
	return o
}

// BotCommands is a bot's commands for one scope.
func (r *Repository) BotCommands(ctx context.Context, botID uuid.UUID, chatID *uuid.UUID) ([]Command, error) {
	rows, err := r.db.Query(ctx, `
		SELECT name, description, description_pt, options
		FROM bot_commands WHERE bot_id = $1 AND chat_id IS NOT DISTINCT FROM $2
		ORDER BY position
	`, botID, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Command{}
	for rows.Next() {
		var c Command
		var opts []byte
		if err := rows.Scan(&c.Name, &c.Description, &c.DescriptionPT, &opts); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(opts, &c.Options); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ChatCommands is what `/` shows in a chat: the commands of every bot there
// that listens for commands, a chat's own set replacing the global one by name.
func (r *Repository) ChatCommands(ctx context.Context, chatID uuid.UUID) ([]ChatCommand, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT ON (bc.bot_id, bc.name)
		       bc.name, bc.description, bc.description_pt, bc.options,
		       b.user_id, u.username, u.display_name, COALESCE(u.avatar_uri, '')
		FROM chat_participants cp
		JOIN bots b ON b.user_id = cp.user_id
		JOIN users u ON u.id = b.user_id
		JOIN bot_commands bc ON bc.bot_id = b.user_id AND (bc.chat_id IS NULL OR bc.chat_id = $1)
		LEFT JOIN bot_installations bi ON bi.chat_id = $1 AND bi.bot_id = b.user_id
		JOIN chats c ON c.id = $1
		WHERE cp.chat_id = $1
		  -- In a group the installation must let the bot hear commands; a
		  -- direct chat with a bot always does.
		  AND (c.type = 'direct' OR 'messages.read.commands' = ANY(bi.scopes) OR 'messages.read.all' = ANY(bi.scopes))
		ORDER BY bc.bot_id, bc.name, (bc.chat_id IS NULL), bc.position
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatCommand{}
	for rows.Next() {
		var c ChatCommand
		var opts []byte
		if err := rows.Scan(&c.Name, &c.Description, &c.DescriptionPT, &opts,
			&c.Bot.ID, &c.Bot.Username, &c.Bot.DisplayName, &c.Bot.AvatarURL); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(opts, &c.Options); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Autocomplete broker ─────────────────────────────────────────────────────

type autocompleteBroker struct {
	mu      sync.Mutex
	pending map[string]pendingAutocomplete
}

type pendingAutocomplete struct {
	botID uuid.UUID
	reply chan []Choice
}

func newRequestID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (b *autocompleteBroker) open(botID uuid.UUID) (string, chan []Choice) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.pending == nil {
		b.pending = map[string]pendingAutocomplete{}
	}
	id := newRequestID()
	ch := make(chan []Choice, 1)
	b.pending[id] = pendingAutocomplete{botID: botID, reply: ch}
	return id, ch
}

func (b *autocompleteBroker) close(id string) {
	b.mu.Lock()
	delete(b.pending, id)
	b.mu.Unlock()
}

// answer delivers a bot's choices; only the bot that was asked can answer.
func (b *autocompleteBroker) answer(id string, botID uuid.UUID, choices []Choice) bool {
	b.mu.Lock()
	p, ok := b.pending[id]
	if ok && p.botID == botID {
		delete(b.pending, id)
	}
	b.mu.Unlock()
	if !ok || p.botID != botID {
		return false
	}
	p.reply <- choices
	return true
}

// ── Service ─────────────────────────────────────────────────────────────────

// SetCommands replaces a bot's global commands, or a chat's when chatID is set.
func (s *Service) SetCommands(ctx context.Context, botID uuid.UUID, chatID *uuid.UUID, cmds []Command) error {
	if err := validateCommands(cmds); err != nil {
		return err
	}
	if chatID != nil {
		if _, err := s.repo.Installation(ctx, *chatID, botID); err != nil {
			return err
		}
	}
	return s.repo.ReplaceCommands(ctx, botID, chatID, cmds)
}

func (s *Service) BotCommands(ctx context.Context, botID uuid.UUID, chatID *uuid.UUID) ([]Command, error) {
	return s.repo.BotCommands(ctx, botID, chatID)
}

// ChatCommands is the `/` list for a member of the chat.
func (s *Service) ChatCommands(ctx context.Context, chatID, caller uuid.UUID) ([]ChatCommand, error) {
	ci, err := s.repo.chatInfo(ctx, chatID, caller)
	if err != nil {
		return nil, err
	}
	if !ci.CallerIsInIt {
		return nil, ErrChatNotFound
	}
	return s.repo.ChatCommands(ctx, chatID)
}

// AutocompleteRequest is a person's client asking a bot for choices. The
// typed value is a pairwise envelope for the bot; the server sees which
// command and option, never what was typed.
type AutocompleteRequest struct {
	Command string `json:"command" binding:"required"`
	Option  string `json:"option" binding:"required"`
	Content string `json:"content" binding:"required"`
}

// Autocomplete asks the bot and waits briefly for its answer.
func (s *Service) Autocomplete(ctx context.Context, chatID, botID, caller uuid.UUID, req AutocompleteRequest) ([]Choice, error) {
	if !commandName.MatchString(req.Command) || !commandName.MatchString(req.Option) || !validDirectEnvelope(req.Content) {
		return nil, ErrInvalidCommand
	}
	cmds, err := s.ChatCommands(ctx, chatID, caller)
	if err != nil {
		return nil, err
	}
	if !hasAutocompleteOption(cmds, botID, req.Command, req.Option) {
		return nil, ErrInvalidCommand
	}
	id, reply := s.autocomplete.open(botID)
	defer s.autocomplete.close(id)
	s.Emit(ctx, botID, EventCommandAutocomplete, &chatID, map[string]any{
		"request_id": id, "sender_id": caller, "command": req.Command, "option": req.Option, "content": req.Content,
	})
	select {
	case choices := <-reply:
		return choices, nil
	case <-time.After(autocompleteTimeout):
		return nil, ErrAutocompleteTimeout
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func hasAutocompleteOption(cmds []ChatCommand, botID uuid.UUID, command, option string) bool {
	for _, c := range cmds {
		if c.Bot.ID != botID || c.Name != command {
			continue
		}
		for _, o := range c.Options {
			if o.Name == option && o.Autocomplete {
				return true
			}
		}
	}
	return false
}

// AnswerAutocomplete is the bot's reply. Choices are the bot's own
// suggestions, checked like registered ones.
func (s *Service) AnswerAutocomplete(botID uuid.UUID, requestID string, choices []Choice) error {
	if len(choices) > maxAutocompleteResp {
		choices = choices[:maxAutocompleteResp]
	}
	for _, ch := range choices {
		if !validChoice(ch) {
			return ErrInvalidCommand
		}
	}
	if choices == nil {
		choices = []Choice{}
	}
	if !s.autocomplete.answer(requestID, botID, choices) {
		return ErrAutocompleteNotFound
	}
	return nil
}

// ── Controllers ─────────────────────────────────────────────────────────────

func writeCommandErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidCommand):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": ErrInvalidCommand.Error(), "detail": err.Error()})
	case errors.Is(err, ErrAutocompleteTimeout):
		ctx.JSON(http.StatusGatewayTimeout, gin.H{"error": err.Error()})
	case errors.Is(err, ErrAutocompleteNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	default:
		writeErr(ctx, err)
	}
}

// PutCommands: PUT /bot/v1/commands (global) and /bot/v1/chats/:id/commands.
func (c *Controller) PutCommands(ctx *gin.Context) {
	var chatID *uuid.UUID
	if raw := ctx.Param("id"); raw != "" {
		id, ok := paramUUID(ctx, "id")
		if !ok {
			return
		}
		chatID = &id
	}
	var req CommandsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if err := c.svc.SetCommands(ctx.Request.Context(), middleware.UserIDFrom(ctx), chatID, req.Commands); err != nil {
		writeCommandErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// GetBotCommands: GET /bot/v1/commands and /bot/v1/chats/:id/commands.
func (c *Controller) GetBotCommands(ctx *gin.Context) {
	var chatID *uuid.UUID
	if raw := ctx.Param("id"); raw != "" {
		id, ok := paramUUID(ctx, "id")
		if !ok {
			return
		}
		chatID = &id
	}
	list, err := c.svc.BotCommands(ctx.Request.Context(), middleware.UserIDFrom(ctx), chatID)
	if err != nil {
		writeCommandErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// PostAutocompleteAnswer: POST /bot/v1/autocomplete/:request_id {choices}.
func (c *Controller) PostAutocompleteAnswer(ctx *gin.Context) {
	var body struct {
		Choices []Choice `json:"choices"`
	}
	if err := ctx.ShouldBindJSON(&body); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if err := c.svc.AnswerAutocomplete(middleware.UserIDFrom(ctx), ctx.Param("request_id"), body.Choices); err != nil {
		writeCommandErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// GetChatCommands: GET /chats/:id/commands (person).
func (c *Controller) GetChatCommands(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.ChatCommands(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeCommandErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// PostAutocomplete: POST /chats/:id/bots/:botId/autocomplete (person).
func (c *Controller) PostAutocomplete(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	botID, ok := paramUUID(ctx, "botId")
	if !ok {
		return
	}
	var req AutocompleteRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	choices, err := c.svc.Autocomplete(ctx.Request.Context(), chatID, botID, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeCommandErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"choices": choices})
}
