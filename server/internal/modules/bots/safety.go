package bots

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// Safety (#343): bots must not become the easiest way to spam or leak data.
//
//   - A bot that keeps hitting the per-chat send limit is suspended on its
//     own, and its owner is told. The owner can lift that; nothing else.
//   - Operators can suspend any bot, or stop all of them (BOTS_DISABLED).
//   - Each group keeps an audit log of what happened with its bots.
//   - A person can ask the bots they share chats with to delete their data,
//     and deleting an account asks every one of them.

const (
	// SuspendRateLimit is the automatic suspension; the owner can lift it.
	SuspendRateLimit = "rate_limit"

	// A bot that hits the per-chat limit this many times in strikeWindow is
	// suspended.
	maxStrikes   = 5
	strikeWindow = 10 * time.Minute

	// AuditRetention is how long a group's bot audit log is kept.
	AuditRetention = 365 * 24 * time.Hour

	// EventDataDeletion asks a bot to delete what it holds about a person.
	EventDataDeletion = "user.data_deletion"
	// EventBotSuspended tells the owner, over the realtime hub.
	EventBotSuspended = "bot.suspended"
)

var (
	ErrBotSuspended     = errors.New("bot_suspended")
	ErrBotsDisabled     = errors.New("bots_disabled")
	ErrNotOwnerLiftable = errors.New("suspended_by_operators")
)

func init() { knownEvents[EventDataDeletion] = true }

// Audit actions.
const (
	AuditAdded         = "bot.added"
	AuditRemoved       = "bot.removed"
	AuditReadAllOn     = "bot.read_all_on"
	AuditReadAllOff    = "bot.read_all_off"
	AuditScopesChanged = "bot.scopes_changed"
	AuditSuspended     = "bot.suspended"
	AuditCommandRun    = "command.run"
)

// AuditEntry is one line of a group's bot log.
type AuditEntry struct {
	ID        int64           `json:"id"`
	Action    string          `json:"action"`
	ActorID   *uuid.UUID      `json:"actor_id,omitempty"`
	ActorName string          `json:"actor_name,omitempty"`
	BotID     *uuid.UUID      `json:"bot_id,omitempty"`
	BotName   string          `json:"bot_name,omitempty"`
	Detail    json.RawMessage `json:"detail"`
	CreatedAt time.Time       `json:"created_at"`
}

// ── Repository ──────────────────────────────────────────────────────────────

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func (r *Repository) addAudit(ctx context.Context, chatID uuid.UUID, actor, bot *uuid.UUID, action string, detail any) {
	raw, err := json.Marshal(detail)
	if err != nil || detail == nil {
		raw = []byte("{}")
	}
	if _, err := r.db.Exec(ctx, `
		INSERT INTO bot_audit (chat_id, actor_id, bot_id, action, detail) VALUES ($1, $2, $3, $4, $5::jsonb)
	`, chatID, actor, bot, action, string(raw)); err != nil {
		log.Warn().Err(err).Str("action", action).Msg("bot audit not recorded")
	}
}

// Audit is a group's log, newest first.
func (r *Repository) Audit(ctx context.Context, chatID uuid.UUID, limit int) ([]AuditEntry, error) {
	rows, err := r.db.Query(ctx, `
		SELECT a.id, a.action, a.actor_id, COALESCE(ua.display_name, ''), a.bot_id, COALESCE(ub.display_name, ''),
		       a.detail, a.created_at
		FROM bot_audit a
		LEFT JOIN users ua ON ua.id = a.actor_id
		LEFT JOIN users ub ON ub.id = a.bot_id
		WHERE a.chat_id = $1
		ORDER BY a.id DESC
		LIMIT $2
	`, chatID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var detail []byte
		if err := rows.Scan(&e.ID, &e.Action, &e.ActorID, &e.ActorName, &e.BotID, &e.BotName, &detail, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Detail = detail
		e.CreatedAt = e.CreatedAt.UTC()
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repository) PurgeExpiredAudit(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM bot_audit WHERE created_at < NOW() - $1::interval`, AuditRetention.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *Repository) suspend(ctx context.Context, botID uuid.UUID, reason string) (owner uuid.UUID, chats []uuid.UUID, changed bool, err error) {
	err = r.db.QueryRow(ctx, `
		UPDATE bots SET suspended_at = NOW(), suspended_reason = $2, updated_at = NOW()
		WHERE user_id = $1 AND suspended_at IS NULL
		RETURNING owner_id
	`, botID, reason).Scan(&owner)
	if err != nil {
		if isNoRows(err) {
			return uuid.Nil, nil, false, nil
		}
		return uuid.Nil, nil, false, err
	}
	rows, err := r.db.Query(ctx, `SELECT chat_id FROM bot_installations WHERE bot_id = $1`, botID)
	if err != nil {
		return owner, nil, true, err
	}
	defer rows.Close()
	for rows.Next() {
		var c uuid.UUID
		if err := rows.Scan(&c); err != nil {
			return owner, chats, true, err
		}
		chats = append(chats, c)
	}
	return owner, chats, true, rows.Err()
}

func (r *Repository) lift(ctx context.Context, botID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		UPDATE bots SET suspended_at = NULL, suspended_reason = '', updated_at = NOW() WHERE user_id = $1
	`, botID)
	return err
}

// botsSharingChatsWith is every bot in a chat with the person.
func (r *Repository) botsSharingChatsWith(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT b.user_id
		FROM chat_participants me
		JOIN chat_participants other ON other.chat_id = me.chat_id
		JOIN bots b ON b.user_id = other.user_id
		WHERE me.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *Repository) callerRole(ctx context.Context, chatID, userID uuid.UUID) (string, error) {
	var role string
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(role, 'member') FROM chat_participants WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID).Scan(&role)
	if isNoRows(err) {
		return "", nil
	}
	return role, err
}

// ── Service ─────────────────────────────────────────────────────────────────

// WithPlatformDisabled is the kill switch: every bot stops.
func (s *Service) WithPlatformDisabled(disabled bool) *Service {
	s.disabled = disabled
	return s
}

// WithStrikeLimiter counts rate-limit strikes towards a suspension.
func (s *Service) WithStrikeLimiter(l Limiter) *Service {
	s.strikes = l
	return s
}

// Disabled reports the kill switch.
func (s *Service) Disabled() bool { return s.disabled }

// Strike records that a bot hit the per-chat limit, and suspends it once
// it keeps doing so.
func (s *Service) Strike(ctx context.Context, botID uuid.UUID) {
	if s.strikes == nil {
		return
	}
	ok, _, err := s.strikes.Allow(ctx, "strike:"+botID.String(), maxStrikes, strikeWindow)
	if err != nil || ok {
		return
	}
	if err := s.Suspend(ctx, botID, SuspendRateLimit); err != nil {
		log.Warn().Err(err).Str("bot", botID.String()).Msg("automatic bot suspension failed")
	}
}

// Suspend stops a bot: its token stops working, every group it is in logs
// it, and its owner is told.
func (s *Service) Suspend(ctx context.Context, botID uuid.UUID, reason string) error {
	owner, chats, changed, err := s.repo.suspend(ctx, botID, reason)
	if err != nil || !changed {
		return err
	}
	for _, c := range chats {
		s.repo.addAudit(ctx, c, nil, &botID, AuditSuspended, map[string]string{"reason": reason})
	}
	if s.broadcaster != nil {
		s.broadcaster.PublishJSON([]uuid.UUID{owner}, EventBotSuspended, "", map[string]any{"bot_id": botID, "reason": reason})
	}
	log.Warn().Str("bot", botID.String()).Str("reason", reason).Msg("bot suspended")
	return nil
}

// Reactivate lifts an automatic suspension, for the owner.
func (s *Service) Reactivate(ctx context.Context, owner, botID uuid.UUID) (Bot, error) {
	bot, err := s.owned(ctx, owner, botID)
	if err != nil {
		return Bot{}, err
	}
	if !bot.Suspended {
		return bot, nil
	}
	if bot.SuspendedReason != SuspendRateLimit {
		return Bot{}, ErrNotOwnerLiftable
	}
	if err := s.repo.lift(ctx, botID); err != nil {
		return Bot{}, err
	}
	return s.repo.Get(ctx, botID)
}

// Audit is a group's bot log, for its admins.
func (s *Service) Audit(ctx context.Context, chatID, caller uuid.UUID) ([]AuditEntry, error) {
	if err := s.requireGroupAdmin(ctx, chatID, caller); err != nil {
		return nil, err
	}
	return s.repo.Audit(ctx, chatID, 100)
}

func (s *Service) PurgeExpiredAudit(ctx context.Context) (int64, error) {
	return s.repo.PurgeExpiredAudit(ctx)
}

// NotifyDataDeletion asks every bot the person shares a chat with to delete
// what it holds about them. Called before the account goes, while the
// memberships that say which bots those are still exist.
func (s *Service) NotifyDataDeletion(ctx context.Context, userID uuid.UUID) error {
	bots, err := s.repo.botsSharingChatsWith(ctx, userID)
	if err != nil {
		return err
	}
	for _, b := range bots {
		s.Emit(ctx, b, EventDataDeletion, nil, map[string]any{"user_id": userID, "reason": "account_deleted"})
	}
	return nil
}

// ForgetMe asks one bot to delete the caller's data. It must share a chat
// with them; otherwise there is nothing it could hold.
func (s *Service) ForgetMe(ctx context.Context, botID, caller uuid.UUID) error {
	bots, err := s.repo.botsSharingChatsWith(ctx, caller)
	if err != nil {
		return err
	}
	for _, b := range bots {
		if b == botID {
			s.Emit(ctx, botID, EventDataDeletion, nil, map[string]any{"user_id": caller, "reason": "requested"})
			return nil
		}
	}
	return ErrNotFound
}

// auditCommand logs a command run by a group admin (never its content).
func (s *Service) auditCommand(ctx context.Context, chatID, botID, sender uuid.UUID) {
	role, err := s.repo.callerRole(ctx, chatID, sender)
	if err != nil || role != "admin" {
		return
	}
	s.repo.addAudit(ctx, chatID, &sender, &botID, AuditCommandRun, nil)
}

// ── Controllers ─────────────────────────────────────────────────────────────

// GetChatBotAudit: GET /chats/:id/bots/audit (group admins).
func (c *Controller) GetChatBotAudit(ctx *gin.Context) {
	chatID, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	list, err := c.svc.Audit(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// PostReactivate: POST /bots/:id/reactivate (owner).
func (c *Controller) PostReactivate(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	bot, err := c.svc.Reactivate(ctx.Request.Context(), middleware.UserIDFrom(ctx), id)
	if errors.Is(err, ErrNotOwnerLiftable) {
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, bot)
}

// PostForgetMe: POST /bots/:id/forget-me (any person sharing a chat with it).
func (c *Controller) PostForgetMe(ctx *gin.Context) {
	id, ok := paramUUID(ctx, "id")
	if !ok {
		return
	}
	if err := c.svc.ForgetMe(ctx.Request.Context(), id, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusAccepted)
}
