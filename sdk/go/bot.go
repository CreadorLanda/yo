// Package zwosocial is the Go SDK for ZwoSocial bots: end-to-end
// encryption, slash commands, buttons, the gateway and webhooks.
//
//	bot := zwosocial.New(os.Getenv("BOT_TOKEN"), os.Getenv("API_URL"), nil)
//	bot.Command("ping", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("pong")) })
//	log.Fatal(bot.Run(context.Background()))
package zwosocial

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"strings"
	"sync"
)

// Handler answers a command, message or click.
type Handler func(c *Context) error

// AutocompleteHandler returns suggestions for what someone is typing.
type AutocompleteHandler func(c *Context, value string) ([]Choice, error)

// Context is what happened, and how to answer it.
type Context struct {
	Bot      *Bot
	Ctx      context.Context
	ChatID   string
	SenderID string
	IsGroup  bool
	Text     string
	// MessageID is the message it is about, when there is one.
	MessageID *int64
	// Command is set for a slash command.
	Command *Invocation
	// ComponentID and Values are set for a click.
	ComponentID string
	Values      json.RawMessage
}

// Invocation is a parsed slash command.
type Invocation struct {
	Name    string
	Options map[string]string
}

// Reply answers in the chat, encrypted, as a reply to the message.
func (c *Context) Reply(r Reply) error {
	_, err := c.Bot.Send(c.Ctx, c.ChatID, r, c.IsGroup, c.SenderID, c.MessageID)
	return err
}

// ReplyPrivately answers only the person ("Only you can see this").
func (c *Context) ReplyPrivately(r Reply) error {
	content, err := c.Bot.E2EE.Encrypt(c.Ctx, c.SenderID, r.encode(), "")
	if err != nil {
		return err
	}
	return c.Bot.API.Ephemeral(c.Ctx, c.ChatID, c.SenderID, content)
}

// Bot is a ZwoSocial bot.
type Bot struct {
	API     *Client
	E2EE    *E2EE
	Me      BotProfile
	Store   Store
	Intents []string

	commands      map[string]Handler
	interactions  map[string]Handler
	autocompletes map[string]AutocompleteHandler
	messages      []Handler
	events        map[string][]func(Event) error

	mu        sync.Mutex
	seq       int64
	groupChat map[string]bool
	initOnce  sync.Once
	initErr   error
}

// New makes a bot. store nil means a FileStore at ./.zwosocial-bot.json.
func New(token, apiURL string, store Store) *Bot {
	if store == nil {
		store = NewFileStore(".zwosocial-bot.json")
	}
	return &Bot{
		API:           NewClient(apiURL, token),
		Store:         store,
		commands:      map[string]Handler{},
		interactions:  map[string]Handler{},
		autocompletes: map[string]AutocompleteHandler{},
		events:        map[string][]func(Event) error{},
		groupChat:     map[string]bool{},
	}
}

// Command answers `/name`.
func (b *Bot) Command(name string, h Handler) { b.commands[strings.ToLower(name)] = h }

// OnMessage receives any message the bot can read.
func (b *Bot) OnMessage(h Handler) { b.messages = append(b.messages, h) }

// OnInteraction receives clicks on a component id ("*" for any).
func (b *Bot) OnInteraction(componentID string, h Handler) { b.interactions[componentID] = h }

// OnAutocomplete suggests values for an option registered with autocomplete.
func (b *Bot) OnAutocomplete(command, option string, h AutocompleteHandler) {
	b.autocompletes[command+":"+option] = h
}

// On receives raw events, e.g. "bot.installed" or "user.data_deletion".
func (b *Bot) On(eventType string, h func(Event) error) {
	b.events[eventType] = append(b.events[eventType], h)
}

// SetCommands registers the commands people see when they type `/`.
func (b *Bot) SetCommands(ctx context.Context, commands []Command) error {
	return b.API.SetCommands(ctx, commands, "")
}

// Init signs in and publishes the bot's keys.
func (b *Bot) Init(ctx context.Context) error {
	b.initOnce.Do(func() {
		if b.Me, b.initErr = b.API.Me(ctx); b.initErr != nil {
			return
		}
		b.E2EE = NewE2EE(b.Store, b.Me.ID, b.API)
		if b.initErr = b.E2EE.PublishKeys(ctx); b.initErr != nil {
			return
		}
		_, _ = b.Store.Get("gateway:seq", &b.seq)
		log.Printf("[bot] signed in as @%s", b.Me.Username)
	})
	return b.initErr
}

// Run connects to the gateway and handles events until ctx ends.
func (b *Bot) Run(ctx context.Context) error {
	if err := b.Init(ctx); err != nil {
		return err
	}
	runGateway(ctx, b.API.BaseURL, b.API.Token, b.Intents, func() int64 {
		b.mu.Lock()
		defer b.mu.Unlock()
		return b.seq
	}, func(e Event) {
		if err := b.Handle(ctx, e); err != nil {
			log.Printf("[bot] %s: %v", e.Type, err)
		}
	})
	return ctx.Err()
}

// Handle processes one event; duplicates (resumes, retried webhooks) are skipped.
func (b *Bot) Handle(ctx context.Context, e Event) error {
	if err := b.Init(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	if e.ID <= b.seq && e.Type != "ping" {
		b.mu.Unlock()
		return nil
	}
	b.mu.Unlock()
	err := b.dispatch(ctx, e)
	b.mu.Lock()
	if e.ID > b.seq {
		b.seq = e.ID
		_ = b.Store.Set("gateway:seq", b.seq)
	}
	b.mu.Unlock()
	return err
}

func (b *Bot) dispatch(ctx context.Context, e Event) error {
	for _, h := range b.events[e.Type] {
		if err := h(e); err != nil {
			return err
		}
	}
	switch e.Type {
	case "command.invoked", "interaction.created":
		var u Update
		if err := json.Unmarshal(e.Data, &u); err != nil {
			return err
		}
		return b.onUpdate(ctx, u)
	case "message.created":
		var probe struct {
			UpdateID int64 `json:"update_id"`
		}
		_ = json.Unmarshal(e.Data, &probe)
		if probe.UpdateID != 0 {
			var u Update
			_ = json.Unmarshal(e.Data, &u)
			return b.onUpdate(ctx, u)
		}
		var m ChatMessage
		if err := json.Unmarshal(e.Data, &m); err != nil {
			return err
		}
		return b.onMessage(ctx, m)
	case "command.autocomplete":
		return b.onAutocomplete(ctx, e)
	}
	return nil
}

func (b *Bot) isGroup(ctx context.Context, chatID string) (bool, error) {
	b.mu.Lock()
	known, ok := b.groupChat[chatID]
	b.mu.Unlock()
	if ok {
		return known, nil
	}
	t, err := b.API.ChatType(ctx, chatID)
	if err != nil {
		return false, err
	}
	b.mu.Lock()
	b.groupChat[chatID] = t == "group"
	b.mu.Unlock()
	return t == "group", nil
}

func (b *Bot) onUpdate(ctx context.Context, u Update) error {
	plain, err := b.E2EE.Decrypt(u.SenderID, u.Content)
	if err != nil {
		log.Printf("[bot] could not open an update from %s: %v", u.SenderID, err)
		return nil
	}
	var p struct {
		Kind        string          `json:"kind"`
		Text        string          `json:"text"`
		MessageID   *int64          `json:"message_id"`
		ComponentID string          `json:"component_id"`
		Values      json.RawMessage `json:"values"`
		Command     *struct {
			Name    string            `json:"name"`
			Options map[string]string `json:"options"`
		} `json:"command"`
	}
	if err := json.Unmarshal([]byte(plain), &p); err != nil {
		return nil
	}
	group, err := b.isGroup(ctx, u.ChatID)
	if err != nil {
		return err
	}
	c := &Context{Bot: b, Ctx: ctx, ChatID: u.ChatID, SenderID: u.SenderID, IsGroup: group, Text: p.Text, MessageID: p.MessageID}
	if c.MessageID == nil {
		c.MessageID = u.MessageID
	}
	if p.Kind == "interaction" {
		c.ComponentID, c.Values = p.ComponentID, p.Values
		h := b.interactions[p.ComponentID]
		if h == nil {
			h = b.interactions["*"]
		}
		if h == nil {
			return nil
		}
		return h(c)
	}
	if p.Command != nil {
		c.Command = &Invocation{Name: p.Command.Name, Options: p.Command.Options}
	} else {
		c.Command = ParseInvocation(p.Text)
	}
	return b.route(c)
}

func (b *Bot) onMessage(ctx context.Context, m ChatMessage) error {
	if m.SenderID == "" || m.SenderID == b.Me.ID || m.MessageType != "text" {
		return nil
	}
	var body string
	var err error
	switch {
	case IsGroupEnvelope(m.Content):
		body, err = b.E2EE.DecryptGroup(ctx, m.ChatID, m.Content)
	case IsEnvelope(m.Content):
		body, err = b.E2EE.Decrypt(m.SenderID, m.Content)
	default:
		return nil
	}
	if errors.Is(err, ErrDecrypt) {
		log.Printf("[bot] could not open message %d: %v", m.ID, err)
		return nil
	}
	if err != nil {
		return err
	}
	text := TextOf(body)
	id := m.ID
	c := &Context{Bot: b, Ctx: ctx, ChatID: m.ChatID, SenderID: m.SenderID, IsGroup: IsGroupEnvelope(m.Content), Text: text, MessageID: &id, Command: ParseInvocation(text)}
	return b.route(c)
}

func (b *Bot) route(c *Context) error {
	if c.Command != nil {
		if h := b.commands[c.Command.Name]; h != nil {
			return h(c)
		}
	}
	for _, h := range b.messages {
		if err := h(c); err != nil {
			return err
		}
	}
	return nil
}

func (b *Bot) onAutocomplete(ctx context.Context, e Event) error {
	var d struct {
		RequestID string `json:"request_id"`
		SenderID  string `json:"sender_id"`
		Command   string `json:"command"`
		Option    string `json:"option"`
		Content   string `json:"content"`
	}
	if err := json.Unmarshal(e.Data, &d); err != nil {
		return err
	}
	h := b.autocompletes[d.Command+":"+d.Option]
	if h == nil {
		return nil
	}
	plain, err := b.E2EE.Decrypt(d.SenderID, d.Content)
	if err != nil {
		return nil
	}
	var v struct {
		Value any `json:"value"`
	}
	_ = json.Unmarshal([]byte(plain), &v)
	value, _ := v.Value.(string)
	group, err := b.isGroup(ctx, e.ChatID)
	if err != nil {
		return err
	}
	choices, err := h(&Context{Bot: b, Ctx: ctx, ChatID: e.ChatID, SenderID: d.SenderID, IsGroup: group, Text: value}, value)
	if err != nil {
		return err
	}
	if len(choices) > 25 {
		choices = choices[:25]
	}
	return b.API.AnswerAutocomplete(ctx, d.RequestID, choices)
}

// Send posts an encrypted message. In a direct chat, to is the person.
func (b *Bot) Send(ctx context.Context, chatID string, r Reply, isGroup bool, to string, replyTo *int64) (int64, error) {
	if err := b.Init(ctx); err != nil {
		return 0, err
	}
	content, err := b.seal(ctx, chatID, r.encode(), isGroup, to)
	if err != nil {
		return 0, err
	}
	return b.API.SendMessage(ctx, chatID, content, replyTo)
}

// Edit replaces one of the bot's messages, e.g. to disable buttons.
func (b *Bot) Edit(ctx context.Context, chatID string, messageID int64, r Reply, isGroup bool, to string) error {
	content, err := b.seal(ctx, chatID, r.encode(), isGroup, to)
	if err != nil {
		return err
	}
	return b.API.EditMessage(ctx, chatID, messageID, content)
}

func (b *Bot) seal(ctx context.Context, chatID, body string, isGroup bool, to string) (string, error) {
	if !isGroup {
		return b.E2EE.Encrypt(ctx, to, body, "")
	}
	epoch, err := b.E2EE.SyncGroupKeys(ctx, chatID)
	if err != nil {
		return "", err
	}
	members, err := b.API.Members(ctx, chatID)
	if err != nil {
		return "", err
	}
	ms := make([]Member, 0, len(members))
	for _, m := range members {
		ms = append(ms, Member{UserID: m.UserID, Username: m.Username})
	}
	return b.E2EE.EncryptForGroup(ctx, chatID, body, epoch, ms)
}

var invocationHead = regexp.MustCompile(`(?i)^/([a-z0-9_-]{1,32})(?:@([a-z0-9_]{3,32}))?(\s|$)`)
var invocationOpt = regexp.MustCompile(`(?i)([a-z0-9_-]{1,32}):(?:"((?:[^"\\]|\\.)*)"|(\S+))`)
var unescape = regexp.MustCompile(`\\(.)`)

// ParseInvocation reads `/remind@bot when:… what:"two words"` (the app's rules).
func ParseInvocation(text string) *Invocation {
	t := strings.TrimSpace(text)
	head := invocationHead.FindStringSubmatchIndex(t)
	if head == nil {
		return nil
	}
	inv := &Invocation{Name: strings.ToLower(t[head[2]:head[3]]), Options: map[string]string{}}
	for _, m := range invocationOpt.FindAllStringSubmatch(t[head[1]:], -1) {
		v := m[3]
		if m[2] != "" || strings.Contains(m[0], `:"`) {
			v = unescape.ReplaceAllString(m[2], "$1")
		}
		inv.Options[strings.ToLower(m[1])] = v
	}
	return inv
}

// TextOf is the words of a body, whatever card or preview rides with them.
func TextOf(body string) string {
	if strings.HasPrefix(body, `{"zl1"`) || strings.HasPrefix(body, `{"zi1"`) {
		var o map[string]struct {
			Text string `json:"text"`
		}
		if json.Unmarshal([]byte(body), &o) == nil {
			if v, ok := o["zl1"]; ok {
				return v.Text
			}
			return o["zi1"].Text
		}
	}
	return body
}
