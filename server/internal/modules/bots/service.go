package bots

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Broadcaster is the realtime hub, narrowed to what installs need: telling
// a chat's members its roster changed so their clients refresh it.
type Broadcaster interface {
	PublishJSON(userIDs []uuid.UUID, typ, chatID string, payload any)
}

const maxDescription = 512

type Service struct {
	repo        *Repository
	broadcaster Broadcaster
	notifier    UpdateNotifier
	// Event delivery (#323): live connections, and the webhook worker.
	sink                 EventSink
	waker                waker
	allowPrivateWebhooks bool
	// Waiting autocomplete requests (#324).
	autocomplete autocompleteBroker
	// Safety (#343): the platform kill switch and rate-limit strikes.
	disabled bool
	strikes  Limiter
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) WithBroadcaster(b Broadcaster) *Service {
	s.broadcaster = b
	return s
}

// ── Owner ───────────────────────────────────────────────────────────────────

// Create makes a bot and its first token. The secret is in the result and
// nowhere else, ever: only its hash is stored.
func (s *Service) Create(ctx context.Context, owner uuid.UUID, req CreateRequest) (Bot, CreatedToken, error) {
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Description = strings.TrimSpace(req.Description)
	if !validBotUsername(req.Username) {
		return Bot{}, CreatedToken{}, ErrInvalidUsername
	}
	if n := utf8.RuneCountInString(req.DisplayName); n < 2 || n > 64 {
		return Bot{}, CreatedToken{}, ErrInvalidName
	}
	if utf8.RuneCountInString(req.Description) > maxDescription {
		return Bot{}, CreatedToken{}, ErrDescriptionLong
	}
	n, err := s.repo.CountByOwner(ctx, owner)
	if err != nil {
		return Bot{}, CreatedToken{}, err
	}
	if n >= MaxBotsPerOwner {
		return Bot{}, CreatedToken{}, ErrTooManyBots
	}
	secret, hash, err := newTokenSecret()
	if err != nil {
		return Bot{}, CreatedToken{}, err
	}
	bot, tok, err := s.repo.Create(ctx, owner, req, hash, tokenDisplayPrefix(secret))
	if err != nil {
		return Bot{}, CreatedToken{}, err
	}
	return bot, CreatedToken{Token: tok, Secret: secret}, nil
}

func (s *Service) ListMine(ctx context.Context, owner uuid.UUID) ([]Bot, error) {
	return s.repo.ListByOwner(ctx, owner)
}

// owned returns the bot only if `owner` owns it. A bot someone else owns is
// reported as not found, so ids cannot be probed.
func (s *Service) owned(ctx context.Context, owner, botID uuid.UUID) (Bot, error) {
	bot, err := s.repo.Get(ctx, botID)
	if err != nil {
		return Bot{}, err
	}
	if bot.OwnerID != owner {
		return Bot{}, ErrNotFound
	}
	return bot, nil
}

func (s *Service) GetMine(ctx context.Context, owner, botID uuid.UUID) (Bot, error) {
	return s.owned(ctx, owner, botID)
}

func (s *Service) Update(ctx context.Context, owner, botID uuid.UUID, req UpdateRequest) (Bot, error) {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return Bot{}, err
	}
	if req.DisplayName != nil {
		v := strings.TrimSpace(*req.DisplayName)
		if n := utf8.RuneCountInString(v); n < 2 || n > 64 {
			return Bot{}, ErrInvalidName
		}
		req.DisplayName = &v
	}
	if req.Description != nil {
		v := strings.TrimSpace(*req.Description)
		if utf8.RuneCountInString(v) > maxDescription {
			return Bot{}, ErrDescriptionLong
		}
		req.Description = &v
	}
	if err := s.repo.Update(ctx, botID, req); err != nil {
		return Bot{}, err
	}
	return s.repo.Get(ctx, botID)
}

func (s *Service) Delete(ctx context.Context, owner, botID uuid.UUID) error {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return err
	}
	return s.repo.Delete(ctx, botID)
}

// RotateToken issues a new secret and revokes the old ones.
func (s *Service) RotateToken(ctx context.Context, owner, botID uuid.UUID) (CreatedToken, error) {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return CreatedToken{}, err
	}
	secret, hash, err := newTokenSecret()
	if err != nil {
		return CreatedToken{}, err
	}
	tok, err := s.repo.RotateToken(ctx, botID, hash, tokenDisplayPrefix(secret))
	if err != nil {
		return CreatedToken{}, err
	}
	return CreatedToken{Token: tok, Secret: secret}, nil
}

func (s *Service) RevokeTokens(ctx context.Context, owner, botID uuid.UUID) error {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return err
	}
	return s.repo.RevokeTokens(ctx, botID)
}

func (s *Service) ListTokens(ctx context.Context, owner, botID uuid.UUID) ([]Token, error) {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return nil, err
	}
	return s.repo.ListTokens(ctx, botID)
}

// ── Anyone ──────────────────────────────────────────────────────────────────

// Public is a bot's profile, by id or username. Bots are public by nature:
// installing one starts from knowing it exists.
func (s *Service) Public(ctx context.Context, idOrUsername string) (Bot, error) {
	if id, err := uuid.Parse(idOrUsername); err == nil {
		return s.repo.Get(ctx, id)
	}
	return s.repo.GetByUsername(ctx, strings.ToLower(strings.TrimPrefix(idOrUsername, "@")))
}

// OpenDirect is a person starting a conversation with a bot.
func (s *Service) OpenDirect(ctx context.Context, person, botID uuid.UUID) (uuid.UUID, bool, error) {
	if _, err := s.repo.Get(ctx, botID); err != nil {
		return uuid.Nil, false, err
	}
	return s.repo.OpenDirect(ctx, person, botID)
}

// ── Installing in groups ────────────────────────────────────────────────────

// requireGroupAdmin is the rule for every change to a group's bots: only an
// admin may add, re-scope or remove one (ADR 0002, "only admins add bots").
func (s *Service) requireGroupAdmin(ctx context.Context, chatID, actor uuid.UUID) error {
	ci, err := s.repo.chatInfo(ctx, chatID, actor)
	if err != nil {
		return err
	}
	if !ci.CallerIsInIt {
		return ErrChatNotFound
	}
	if ci.Type != "group" {
		return ErrChatNotSupported
	}
	if ci.CallerRole != "admin" {
		return ErrNotGroupAdmin
	}
	return nil
}

func (s *Service) Install(ctx context.Context, chatID, actor uuid.UUID, req InstallRequest) (Installation, error) {
	if err := s.requireGroupAdmin(ctx, chatID, actor); err != nil {
		return Installation{}, err
	}
	var bot Bot
	var err error
	switch {
	case req.BotID != nil:
		bot, err = s.repo.Get(ctx, *req.BotID)
	case req.Username != "":
		bot, err = s.Public(ctx, req.Username)
	default:
		return Installation{}, ErrNotFound
	}
	if err != nil {
		return Installation{}, err
	}
	if s.disabled {
		return Installation{}, ErrBotsDisabled
	}
	if bot.Suspended {
		return Installation{}, ErrBotSuspended
	}
	scopes, err := normalizeScopes(req.Scopes)
	if err != nil {
		return Installation{}, err
	}
	if err := s.repo.Install(ctx, chatID, bot.ID, actor, scopes); err != nil {
		return Installation{}, err
	}
	s.repo.addAudit(ctx, chatID, &actor, &bot.ID, AuditAdded, map[string]any{"scopes": scopes})
	if hasScope(scopes, ScopeReadAll) {
		s.repo.addAudit(ctx, chatID, &actor, &bot.ID, AuditReadAllOn, nil)
	}
	s.announce(ctx, chatID)
	inst, err := s.repo.Installation(ctx, chatID, bot.ID)
	if err != nil {
		return Installation{}, err
	}
	inst.Bot = bot
	s.Emit(ctx, bot.ID, EventBotInstalled, &chatID, map[string]any{"scopes": inst.Scopes, "installed_by": actor})
	return inst, nil
}

func (s *Service) UpdateScopes(ctx context.Context, chatID, botID, actor uuid.UUID, scopes []Scope) (Installation, error) {
	if err := s.requireGroupAdmin(ctx, chatID, actor); err != nil {
		return Installation{}, err
	}
	norm, err := normalizeScopes(scopes)
	if err != nil {
		return Installation{}, err
	}
	hadAll, hasAll, err := s.repo.UpdateScopes(ctx, chatID, botID, actor, norm)
	if err != nil {
		return Installation{}, err
	}
	switch {
	case !hadAll && hasAll:
		s.repo.addAudit(ctx, chatID, &actor, &botID, AuditReadAllOn, nil)
	case hadAll && !hasAll:
		s.repo.addAudit(ctx, chatID, &actor, &botID, AuditReadAllOff, nil)
	default:
		s.repo.addAudit(ctx, chatID, &actor, &botID, AuditScopesChanged, map[string]any{"scopes": norm})
	}
	if hadAll != hasAll {
		// Full read on or off changes who may hold the group key; clients
		// rotate the epoch on this signal (#322).
		s.announce(ctx, chatID)
	}
	inst, err := s.repo.Installation(ctx, chatID, botID)
	if err != nil {
		return Installation{}, err
	}
	bot, err := s.repo.Get(ctx, botID)
	if err != nil {
		return Installation{}, err
	}
	inst.Bot = bot
	return inst, nil
}

func (s *Service) Uninstall(ctx context.Context, chatID, botID, actor uuid.UUID) error {
	if err := s.requireGroupAdmin(ctx, chatID, actor); err != nil {
		return err
	}
	// The removed bot hears it too, so it can stop work for this chat.
	members, _ := s.repo.Members(ctx, chatID)
	if err := s.repo.Uninstall(ctx, chatID, botID, actor); err != nil {
		return err
	}
	s.repo.addAudit(ctx, chatID, &actor, &botID, AuditRemoved, nil)
	s.publish(chatID, members, botID)
	s.Emit(ctx, botID, EventBotRemoved, &chatID, map[string]any{"removed_by": actor})
	return nil
}

// ListForChat is the bots in a chat, for any member of it.
func (s *Service) ListForChat(ctx context.Context, chatID, caller uuid.UUID) ([]Installation, error) {
	ci, err := s.repo.chatInfo(ctx, chatID, caller)
	if err != nil {
		return nil, err
	}
	if !ci.CallerIsInIt {
		return nil, ErrChatNotFound
	}
	return s.repo.ListInstallations(ctx, chatID)
}

func (s *Service) announce(ctx context.Context, chatID uuid.UUID) {
	if s.broadcaster == nil {
		return
	}
	members, err := s.repo.Members(ctx, chatID)
	if err != nil {
		return
	}
	s.publish(chatID, members)
}

func (s *Service) publish(chatID uuid.UUID, members []Member, extra ...uuid.UUID) {
	if s.broadcaster == nil {
		return
	}
	ids := make([]uuid.UUID, 0, len(members)+len(extra))
	for _, m := range members {
		ids = append(ids, m.UserID)
	}
	ids = append(ids, extra...)
	s.broadcaster.PublishJSON(ids, "group.members.changed", chatID.String(), map[string]string{
		"group_id": chatID.String(),
	})
}

// ── The bot itself ──────────────────────────────────────────────────────────

// Authenticate resolves a bot token from the Authorization header.
func (s *Service) Authenticate(ctx context.Context, header string) (Principal, error) {
	secret, ok := parseBotAuthorization(header)
	if !ok {
		return Principal{}, ErrInvalidToken
	}
	return s.repo.Authenticate(ctx, hashToken(secret))
}

func (s *Service) Me(ctx context.Context, botID uuid.UUID) (Bot, error) {
	return s.repo.Get(ctx, botID)
}

// RequireScope fails unless the bot is installed in the chat with `scope`.
func (s *Service) RequireScope(ctx context.Context, chatID, botID uuid.UUID, scope Scope) error {
	inst, err := s.repo.Installation(ctx, chatID, botID)
	if errors.Is(err, ErrNotInstalled) {
		return ErrNotInstalled
	}
	if err != nil {
		return err
	}
	if !hasScope(inst.Scopes, scope) {
		return fmt.Errorf("%w: %s", ErrScopeMissing, scope)
	}
	return nil
}

func (s *Service) Members(ctx context.Context, chatID, botID uuid.UUID) ([]Member, error) {
	if err := s.RequireScope(ctx, chatID, botID, ScopeMembers); err != nil {
		return nil, err
	}
	return s.repo.Members(ctx, chatID)
}
