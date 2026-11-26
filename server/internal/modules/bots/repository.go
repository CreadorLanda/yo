package bots

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const botColumns = `
	b.user_id, u.username, u.display_name, COALESCE(u.avatar_uri, ''),
	b.description, b.privacy_mode, b.verified, b.owner_id, b.created_at,
	b.suspended_at IS NOT NULL, b.suspended_reason`

func scanBot(row pgx.Row) (Bot, error) {
	var b Bot
	err := row.Scan(&b.ID, &b.Username, &b.DisplayName, &b.AvatarURL,
		&b.Description, &b.PrivacyMode, &b.Verified, &b.OwnerID, &b.CreatedAt,
		&b.Suspended, &b.SuspendedReason)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bot{}, ErrNotFound
	}
	return b, err
}

// CountByOwner is how many bots someone already has.
func (r *Repository) CountByOwner(ctx context.Context, owner uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM bots WHERE owner_id = $1`, owner).Scan(&n)
	return n, err
}

// Create inserts the bot's account, device, bot row and first token in one
// transaction — a bot without a token or a device is unusable, so none of
// them may exist alone.
func (r *Repository) Create(ctx context.Context, owner uuid.UUID, req CreateRequest, tokenHash []byte, tokenPrefix string) (Bot, Token, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return Bot{}, Token{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO users (username, display_name, kind, username_public)
		VALUES ($1, $2, 'bot', TRUE)
		RETURNING id
	`, req.Username, req.DisplayName).Scan(&userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Bot{}, Token{}, ErrUsernameTaken
		}
		return Bot{}, Token{}, fmt.Errorf("insert bot user: %w", err)
	}

	var deviceID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO devices (user_id, name, platform, signal_identity)
		VALUES ($1, 'bot', 'bot', ''::bytea)
		RETURNING id
	`, userID).Scan(&deviceID); err != nil {
		return Bot{}, Token{}, fmt.Errorf("insert bot device: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO bots (user_id, owner_id, device_id, description)
		VALUES ($1, $2, $3, $4)
	`, userID, owner, deviceID, req.Description); err != nil {
		return Bot{}, Token{}, fmt.Errorf("insert bot: %w", err)
	}

	var tok Token
	if err := tx.QueryRow(ctx, `
		INSERT INTO bot_tokens (bot_id, token_hash, prefix)
		VALUES ($1, $2, $3)
		RETURNING id, prefix, created_at
	`, userID, tokenHash, tokenPrefix).Scan(&tok.ID, &tok.Prefix, &tok.CreatedAt); err != nil {
		return Bot{}, Token{}, fmt.Errorf("insert bot token: %w", err)
	}

	bot, err := scanBot(tx.QueryRow(ctx, `
		SELECT `+botColumns+` FROM bots b JOIN users u ON u.id = b.user_id
		WHERE b.user_id = $1
	`, userID))
	if err != nil {
		return Bot{}, Token{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Bot{}, Token{}, err
	}
	return bot, tok, nil
}

func (r *Repository) Get(ctx context.Context, id uuid.UUID) (Bot, error) {
	return scanBot(r.db.QueryRow(ctx, `
		SELECT `+botColumns+` FROM bots b JOIN users u ON u.id = b.user_id
		WHERE b.user_id = $1
	`, id))
}

func (r *Repository) GetByUsername(ctx context.Context, username string) (Bot, error) {
	return scanBot(r.db.QueryRow(ctx, `
		SELECT `+botColumns+` FROM bots b JOIN users u ON u.id = b.user_id
		WHERE u.username = $1
	`, username))
}

func (r *Repository) ListByOwner(ctx context.Context, owner uuid.UUID) ([]Bot, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+botColumns+` FROM bots b JOIN users u ON u.id = b.user_id
		WHERE b.owner_id = $1
		ORDER BY b.created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Bot{}
	for rows.Next() {
		b, err := scanBot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (r *Repository) Update(ctx context.Context, id uuid.UUID, req UpdateRequest) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if req.DisplayName != nil || req.AvatarURL != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE users SET
				display_name = COALESCE($2, display_name),
				avatar_uri   = COALESCE($3, avatar_uri),
				updated_at   = NOW()
			WHERE id = $1 AND kind = 'bot'
		`, id, req.DisplayName, req.AvatarURL); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE bots SET
			description  = COALESCE($2, description),
			privacy_mode = COALESCE($3, privacy_mode),
			updated_at   = NOW()
		WHERE user_id = $1
	`, id, req.Description, req.PrivacyMode); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Delete removes the bot; the trigger from 0059 removes its account.
func (r *Repository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM bots WHERE user_id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RotateToken revokes every live token and issues a new one, atomically, so
// a bot is never left with two valid secrets or none.
func (r *Repository) RotateToken(ctx context.Context, botID uuid.UUID, hash []byte, prefix string) (Token, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return Token{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE bot_tokens SET revoked_at = NOW()
		WHERE bot_id = $1 AND revoked_at IS NULL
	`, botID); err != nil {
		return Token{}, err
	}
	var tok Token
	if err := tx.QueryRow(ctx, `
		INSERT INTO bot_tokens (bot_id, token_hash, prefix)
		VALUES ($1, $2, $3)
		RETURNING id, prefix, created_at
	`, botID, hash, prefix).Scan(&tok.ID, &tok.Prefix, &tok.CreatedAt); err != nil {
		return Token{}, err
	}
	return tok, tx.Commit(ctx)
}

// RevokeTokens turns every live token off. The bot stops working until its
// owner rotates a new one in.
func (r *Repository) RevokeTokens(ctx context.Context, botID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		UPDATE bot_tokens SET revoked_at = NOW()
		WHERE bot_id = $1 AND revoked_at IS NULL
	`, botID)
	return err
}

func (r *Repository) ListTokens(ctx context.Context, botID uuid.UUID) ([]Token, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, prefix, created_at, last_used_at FROM bot_tokens
		WHERE bot_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Token{}
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.ID, &t.Prefix, &t.CreatedAt, &t.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Authenticate resolves a token hash to its bot, and records the use at most
// once a minute so a busy bot does not write on every request.
func (r *Repository) Authenticate(ctx context.Context, hash []byte) (Principal, error) {
	var p Principal
	var tokenID uuid.UUID
	var suspended bool
	err := r.db.QueryRow(ctx, `
		SELECT t.id, b.user_id, b.device_id, b.suspended_at IS NOT NULL
		FROM bot_tokens t JOIN bots b ON b.user_id = t.bot_id
		WHERE t.token_hash = $1 AND t.revoked_at IS NULL
	`, hash).Scan(&tokenID, &p.BotID, &p.DeviceID, &suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrInvalidToken
	}
	if err != nil {
		return Principal{}, err
	}
	if suspended {
		return Principal{}, ErrBotSuspended
	}
	_, _ = r.db.Exec(ctx, `
		UPDATE bot_tokens SET last_used_at = NOW()
		WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')
	`, tokenID)
	return p, nil
}

// chatInfo is what install decisions need about a chat and the caller.
type chatInfo struct {
	Type          string
	IsSelf        bool
	CallerRole    string
	CallerIsInIt  bool
	PeerIsBotID   *uuid.UUID
	ParticipantsN int
}

func (r *Repository) chatInfo(ctx context.Context, chatID, caller uuid.UUID) (chatInfo, error) {
	var ci chatInfo
	var role *string
	err := r.db.QueryRow(ctx, `
		SELECT c.type, c.is_self,
		       (SELECT COALESCE(cp.role, 'member') FROM chat_participants cp
		         WHERE cp.chat_id = c.id AND cp.user_id = $2),
		       (SELECT COUNT(*) FROM chat_participants cp WHERE cp.chat_id = c.id)
		FROM chats c WHERE c.id = $1
	`, chatID, caller).Scan(&ci.Type, &ci.IsSelf, &role, &ci.ParticipantsN)
	if errors.Is(err, pgx.ErrNoRows) {
		return chatInfo{}, ErrChatNotFound
	}
	if err != nil {
		return chatInfo{}, err
	}
	if role != nil {
		ci.CallerIsInIt = true
		ci.CallerRole = *role
	}
	return ci, nil
}

// Install adds the bot to the chat and records what it may do, with a system
// message so every member can see a bot arrived.
func (r *Repository) Install(ctx context.Context, chatID, botID, actor uuid.UUID, scopes []Scope) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `
		INSERT INTO bot_installations (chat_id, bot_id, installed_by, scopes)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (chat_id, bot_id) DO NOTHING
	`, chatID, botID, actor, scopeStrings(scopes))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAlreadyInstalled
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id, role)
		VALUES ($1, $2, 'member')
		ON CONFLICT (chat_id, user_id) DO NOTHING
	`, chatID, botID); err != nil {
		return err
	}
	if err := insertSystem(ctx, tx, chatID, actor, fmt.Sprintf("bot:added:%s:%s", actor, botID)); err != nil {
		return err
	}
	if hasScope(scopes, ScopeReadAll) {
		if err := insertSystem(ctx, tx, chatID, actor, fmt.Sprintf("bot:read_all:%s:%s:on", actor, botID)); err != nil {
			return err
		}
		if err := rotateGroupKey(ctx, tx, chatID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// UpdateScopes replaces an installation's scopes. Turning full read on or off
// is announced to the chat — ADR 0002 makes that visible to everyone.
func (r *Repository) UpdateScopes(ctx context.Context, chatID, botID, actor uuid.UUID, scopes []Scope) (bool, bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var before []string
	err = tx.QueryRow(ctx, `
		SELECT scopes FROM bot_installations WHERE chat_id = $1 AND bot_id = $2 FOR UPDATE
	`, chatID, botID).Scan(&before)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, ErrNotInstalled
	}
	if err != nil {
		return false, false, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE bot_installations SET scopes = $3, updated_at = NOW()
		WHERE chat_id = $1 AND bot_id = $2
	`, chatID, botID, scopeStrings(scopes)); err != nil {
		return false, false, err
	}
	hadAll := hasScope(toScopes(before), ScopeReadAll)
	hasAll := hasScope(scopes, ScopeReadAll)
	if hadAll != hasAll {
		state := "off"
		if hasAll {
			state = "on"
		}
		if err := insertSystem(ctx, tx, chatID, actor, fmt.Sprintf("bot:read_all:%s:%s:%s", actor, botID, state)); err != nil {
			return false, false, err
		}
		if err := rotateGroupKey(ctx, tx, chatID); err != nil {
			return false, false, err
		}
	}
	return hadAll, hasAll, tx.Commit(ctx)
}

// Uninstall removes the bot from the chat and says so.
func (r *Repository) Uninstall(ctx context.Context, chatID, botID, actor uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var scopes []string
	err = tx.QueryRow(ctx, `
		DELETE FROM bot_installations WHERE chat_id = $1 AND bot_id = $2
		RETURNING scopes
	`, chatID, botID).Scan(&scopes)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotInstalled
	}
	if err != nil {
		return err
	}
	if hasScope(toScopes(scopes), ScopeReadAll) {
		if err := rotateGroupKey(ctx, tx, chatID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2`, chatID, botID); err != nil {
		return err
	}
	if err := insertSystem(ctx, tx, chatID, actor, fmt.Sprintf("bot:removed:%s:%s", actor, botID)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Installation is the bot's grant in one chat.
func (r *Repository) Installation(ctx context.Context, chatID, botID uuid.UUID) (Installation, error) {
	var inst Installation
	var scopes []string
	err := r.db.QueryRow(ctx, `
		SELECT chat_id, scopes, installed_by, created_at
		FROM bot_installations WHERE chat_id = $1 AND bot_id = $2
	`, chatID, botID).Scan(&inst.ChatID, &scopes, &inst.InstalledBy, &inst.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Installation{}, ErrNotInstalled
	}
	if err != nil {
		return Installation{}, err
	}
	inst.Scopes = toScopes(scopes)
	return inst, nil
}

func (r *Repository) ListInstallations(ctx context.Context, chatID uuid.UUID) ([]Installation, error) {
	rows, err := r.db.Query(ctx, `
		SELECT i.chat_id, i.scopes, i.installed_by, i.created_at, `+botColumns+`
		FROM bot_installations i
		JOIN bots b ON b.user_id = i.bot_id
		JOIN users u ON u.id = b.user_id
		WHERE i.chat_id = $1
		ORDER BY i.created_at
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Installation{}
	for rows.Next() {
		var inst Installation
		var scopes []string
		b := &inst.Bot
		if err := rows.Scan(&inst.ChatID, &scopes, &inst.InstalledBy, &inst.CreatedAt,
			&b.ID, &b.Username, &b.DisplayName, &b.AvatarURL, &b.Description,
			&b.PrivacyMode, &b.Verified, &b.OwnerID, &b.CreatedAt,
			&b.Suspended, &b.SuspendedReason); err != nil {
			return nil, err
		}
		inst.Scopes = toScopes(scopes)
		out = append(out, inst)
	}
	return out, rows.Err()
}

// Members lists who is in a chat, for a bot with members.read.
func (r *Repository) Members(ctx context.Context, chatID uuid.UUID) ([]Member, error) {
	rows, err := r.db.Query(ctx, `
		SELECT u.id, u.username, u.display_name, u.kind = 'bot', COALESCE(cp.role, 'member')
		FROM chat_participants cp JOIN users u ON u.id = cp.user_id
		WHERE cp.chat_id = $1
		ORDER BY cp.joined_at
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName, &m.IsBot, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// OpenDirect returns the direct chat between a person and a bot, creating it
// if needed. It is active at once: there is no request to accept, because
// the person is the one asking to talk.
func (r *Repository) OpenDirect(ctx context.Context, person, botID uuid.UUID) (uuid.UUID, bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var chatID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT c.id FROM chats c
		JOIN chat_participants a ON a.chat_id = c.id AND a.user_id = $1
		JOIN chat_participants b ON b.chat_id = c.id AND b.user_id = $2
		WHERE c.type = 'direct' AND NOT c.is_self
		LIMIT 1
	`, person, botID).Scan(&chatID)
	if err == nil {
		return chatID, false, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, err
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO chats (type, created_by, status) VALUES ('direct', $1, 'active')
		RETURNING id
	`, person).Scan(&chatID); err != nil {
		return uuid.Nil, false, fmt.Errorf("create bot dm: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)
	`, chatID, person, botID); err != nil {
		return uuid.Nil, false, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO bot_installations (chat_id, bot_id, installed_by, scopes)
		VALUES ($1, $2, $3, $4)
	`, chatID, botID, person, scopeStrings(DefaultScopes)); err != nil {
		return uuid.Nil, false, err
	}
	return chatID, true, tx.Commit(ctx)
}

// rotateGroupKey starts a new sender-key epoch. ADR 0002: a bot granted full
// read only receives keys from the next epoch (never history), and one that
// loses it — or leaves — stops being able to read from the next epoch on.
func rotateGroupKey(ctx context.Context, tx pgx.Tx, chatID uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE chats SET key_epoch = key_epoch + 1 WHERE id = $1`, chatID)
	return err
}

// insertSystem writes a system message the same way the groups module does,
// as `bot:<event>:<actor>:<bot>[:<extra>]`; the client renders it (#326).
func insertSystem(ctx context.Context, tx pgx.Tx, chatID, actor uuid.UUID, content string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO messages (chat_id, sender_id, content, message_type)
		VALUES ($1, $2, $3, 'system')
	`, chatID, actor, content)
	return err
}

func scopeStrings(in []Scope) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = string(s)
	}
	return out
}

func toScopes(in []string) []Scope {
	out := make([]Scope, len(in))
	for i, s := range in {
		out[i] = Scope(s)
	}
	return out
}
