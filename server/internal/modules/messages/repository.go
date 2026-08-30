package messages

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/yo/server/internal/crypto"
)

type Repository struct {
	db     *pgxpool.Pool
	msgKey []byte // AES-256 key; nil = plaintext fallback
	keyOK  bool
}

func NewRepository(db *pgxpool.Pool, msgKeyHex string) *Repository {
	r := &Repository{db: db}
	if msgKeyHex != "" {
		key, err := hex.DecodeString(msgKeyHex)
		if err == nil && len(key) == 32 {
			r.msgKey = key
			r.keyOK = true
		}
	}
	return r
}

func (r *Repository) encrypt(plaintext string) string {
	if !r.keyOK || plaintext == "" {
		return plaintext
	}
	enc, err := crypto.Encrypt(plaintext, r.msgKey)
	if err != nil {
		return plaintext
	}
	return enc
}

func (r *Repository) decrypt(stored string) string {
	if !r.keyOK || stored == "" {
		return stored
	}
	dec, err := crypto.Decrypt(stored, r.msgKey)
	if err != nil {
		return stored
	}
	return dec
}

// ── Chats ───────────────────────────────────────────────────────────────────

func (r *Repository) CreateChat(ctx context.Context, chatType ChatType, createdBy uuid.UUID, peerIDs []uuid.UUID, status ChatStatus) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var chatID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO chats (type, created_by, status) VALUES ($1, $2, $3) RETURNING id
	`, string(chatType), createdBy, string(status)).Scan(&chatID); err != nil {
		return uuid.Nil, err
	}

	for _, pid := range peerIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, chatID, pid); err != nil {
			return uuid.Nil, err
		}
	}

	return chatID, tx.Commit(ctx)
}

func (r *Repository) FindDirectChat(ctx context.Context, userID, peerID uuid.UUID) (*Chat, error) {
	const q = `
		SELECT c.id, c.type, c.title, c.avatar_url, c.created_by, c.status, c.created_at
		FROM chats c
		WHERE c.type = 'direct'
		  AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = $1)
		  AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = $2)
		LIMIT 1
	`
	var c Chat
	err := r.db.QueryRow(ctx, q, userID, peerID).Scan(&c.ID, &c.Type, &c.Title, &c.AvatarURL, &c.CreatedBy, &c.Status, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// chatSelectBase resolves a chat row together with its newest visible
// message, the caller's unread count, their per-chat settings and (for
// direct chats) the peer — all in one pass. $1 is always the caller.
// Both ListChats and ChatForUser build on it so the two can never drift.
const chatSelectBase = `
		SELECT
		    c.id, c.type, c.title, c.avatar_url, c.created_by, c.status, c.created_at,
		    c.disappear_seconds,
		    cp.pinned_at, cp.muted_until, cp.archived_at,
		    lm.content, lm.message_type, lm.sender_id, lm.created_at,
		    COALESCE(uc.n, 0),
		    pu.id, pu.username, pu.display_name, pu.avatar_uri
		FROM chats c
		JOIN chat_participants cp
		  ON cp.chat_id = c.id AND cp.user_id = $1
		-- Newest visible message. Drives both the preview and the ordering.
		LEFT JOIN LATERAL (
		    SELECT m.content, m.message_type, m.sender_id, m.created_at
		    FROM messages m
		    WHERE m.chat_id = c.id
		      AND m.deleted_at IS NULL
		      AND (cp.cleared_at IS NULL OR m.created_at > cp.cleared_at)
		    ORDER BY m.id DESC
		    LIMIT 1
		) lm ON TRUE
		LEFT JOIN LATERAL (
		    SELECT COUNT(*) AS n
		    FROM messages m
		    WHERE m.chat_id = c.id
		      AND m.deleted_at IS NULL
		      AND m.sender_id <> $1
		      AND (cp.last_read_message_id IS NULL OR m.id > cp.last_read_message_id)
		      AND (cp.cleared_at IS NULL OR m.created_at > cp.cleared_at)
		) uc ON TRUE
		-- Direct chats show the other participant, not a stored title.
		LEFT JOIN LATERAL (
		    SELECT u.id, u.username, u.display_name, COALESCE(u.avatar_uri, '') AS avatar_uri
		    FROM chat_participants cp2
		    JOIN users u ON u.id = cp2.user_id
		    WHERE cp2.chat_id = c.id AND cp2.user_id <> $1
		    LIMIT 1
		) pu ON c.type = 'direct'
`

// ListChats returns one page of the user's chats, pinned first and then
// most-recently-active. Ordering by last activity — not chat creation —
// is what makes the list behave like a messenger.
func (r *Repository) ListChats(ctx context.Context, userID uuid.UUID, opts ListChatsOptions) ([]Chat, error) {
	q := chatSelectBase + `
		WHERE
		    -- A deleted chat stays gone until the peer writes again.
		    (cp.hidden_at IS NULL OR (lm.created_at IS NOT NULL AND lm.created_at > cp.hidden_at))
		    AND (CASE WHEN $2 THEN cp.archived_at IS NOT NULL ELSE cp.archived_at IS NULL END)
		ORDER BY (cp.pinned_at IS NOT NULL) DESC,
		         cp.pinned_at DESC NULLS LAST,
		         COALESCE(lm.created_at, c.created_at) DESC
		LIMIT $3 OFFSET $4
	`
	rows, err := r.db.Query(ctx, q, userID, opts.Archived, opts.Limit, opts.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return r.scanChatRows(rows)
}

// ChatForUser resolves a single chat with the same enrichment as the list,
// scoped to a participant. Returns pgx.ErrNoRows when the user is not in
// the chat, which callers translate to ErrChatNotFound.
func (r *Repository) ChatForUser(ctx context.Context, chatID, userID uuid.UUID) (*Chat, error) {
	q := chatSelectBase + `
		WHERE c.id = $2
	`
	rows, err := r.db.Query(ctx, q, userID, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chats, err := r.scanChatRows(rows)
	if err != nil {
		return nil, err
	}
	if len(chats) == 0 {
		return nil, pgx.ErrNoRows
	}
	return &chats[0], nil
}

// scanChatRows decodes the chatSelectBase column list. Both callers share
// it so the query and the scan cannot fall out of sync.
func (r *Repository) scanChatRows(rows pgx.Rows) ([]Chat, error) {
	var out []Chat
	for rows.Next() {
		var (
			c         Chat
			lmContent *string
			lmType    *string
			lmSender  *uuid.UUID
			lmAt      *time.Time
			peerID    *uuid.UUID
			peerUser  *string
			peerName  *string
			peerAva   *string
		)
		if err := rows.Scan(
			&c.ID, &c.Type, &c.Title, &c.AvatarURL, &c.CreatedBy, &c.Status, &c.CreatedAt,
			&c.DisappearSeconds,
			&c.PinnedAt, &c.MutedUntil, &c.ArchivedAt,
			&lmContent, &lmType, &lmSender, &lmAt,
			&c.UnreadCount,
			&peerID, &peerUser, &peerName, &peerAva,
		); err != nil {
			return nil, err
		}
		// lmSender may be NULL — the sender deleted their account. The preview
		// is still worth showing; it simply has nobody to attribute it to.
		if lmContent != nil && lmAt != nil {
			preview := &MessagePreview{
				// Same at-rest decryption LastMessage did; without this the
				// list preview would render raw ciphertext.
				Content:   r.decrypt(*lmContent),
				SenderID:  lmSender,
				CreatedAt: *lmAt,
			}
			if lmType != nil {
				preview.MessageType = MessageType(*lmType)
			}
			c.LastMessage = preview
		}
		// Direct chats derive their identity from the peer, mirroring what
		// enrichDirectPeer used to do one query at a time.
		if peerID != nil {
			c.PeerUserID = peerID
			c.PeerUsername = peerUser
			if peerName != nil && *peerName != "" {
				c.Title = peerName
			}
			if peerAva != nil && *peerAva != "" {
				c.AvatarURL = peerAva
			}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// mutedForever is the sentinel stored for "mute with no end date". Kept
// far enough out that it never expires in practice, while still letting
// the column stay a plain timestamp the list query can compare.
//
// Deliberately NOT year 9999: encoding/json refuses to marshal a time
// whose year falls outside [0,9999], and a positive UTC offset pushes
// 9999-12-31T23:59:59Z over that edge — which made every list containing
// a muted chat fail to serialise.
var mutedForever = time.Date(9000, 1, 1, 0, 0, 0, 0, time.UTC)

// UpdateChatSettings applies a partial settings change for one participant.
// Nil fields are left untouched, so toggling one flag never clobbers another.
func (r *Repository) UpdateChatSettings(ctx context.Context, chatID, userID uuid.UUID, req ChatSettingsRequest) error {
	const q = `
		UPDATE chat_participants SET
		    pinned_at = CASE
		        WHEN $3::bool IS NULL THEN pinned_at
		        WHEN $3 THEN COALESCE(pinned_at, NOW())
		        ELSE NULL END,
		    muted_until = CASE
		        WHEN $4::bool IS NULL THEN muted_until
		        WHEN $4 THEN $5::timestamptz
		        ELSE NULL END,
		    archived_at = CASE
		        WHEN $6::bool IS NULL THEN archived_at
		        WHEN $6 THEN COALESCE(archived_at, NOW())
		        ELSE NULL END
		WHERE chat_id = $1 AND user_id = $2
	`
	tag, err := r.db.Exec(ctx, q, chatID, userID, req.Pinned, req.Muted, mutedForever, req.Archived)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ClearHistory hides every existing message from this user only. The rows
// stay put for the other participants.
func (r *Repository) ClearHistory(ctx context.Context, chatID, userID uuid.UUID) error {
	const q = `
		UPDATE chat_participants SET cleared_at = NOW()
		WHERE chat_id = $1 AND user_id = $2
	`
	tag, err := r.db.Exec(ctx, q, chatID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// HideChat is "delete chat" for one side: clears the caller's history and
// drops the chat from their list. It reappears if the peer writes again,
// which is why this is not a DELETE of the participant row.
func (r *Repository) HideChat(ctx context.Context, chatID, userID uuid.UUID) error {
	const q = `
		UPDATE chat_participants
		SET cleared_at = NOW(), hidden_at = NOW(), pinned_at = NULL
		WHERE chat_id = $1 AND user_id = $2
	`
	tag, err := r.db.Exec(ctx, q, chatID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// IsMuted reports whether the user currently has push suppressed for the
// chat. Used by the send path before enqueuing a notification.
func (r *Repository) IsMuted(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	const q = `
		SELECT muted_until IS NOT NULL AND muted_until > NOW()
		FROM chat_participants WHERE chat_id = $1 AND user_id = $2
	`
	var muted bool
	if err := r.db.QueryRow(ctx, q, chatID, userID).Scan(&muted); err != nil {
		return false, err
	}
	return muted, nil
}

// PeerUser holds minimal info about a chat's peer for direct chats.
type PeerUser struct {
	ID          uuid.UUID
	Username    string
	DisplayName string
	AvatarURI   string
}

func (r *Repository) PeerUser(ctx context.Context, chatID, userID uuid.UUID) (*PeerUser, error) {
	const q = `
		SELECT u.id, u.username, u.display_name, COALESCE(u.avatar_uri, '')
		FROM chat_participants cp
		JOIN users u ON u.id = cp.user_id
		WHERE cp.chat_id = $1 AND cp.user_id <> $2
		LIMIT 1
	`
	var p PeerUser
	if err := r.db.QueryRow(ctx, q, chatID, userID).Scan(&p.ID, &p.Username, &p.DisplayName, &p.AvatarURI); err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) GetChat(ctx context.Context, chatID uuid.UUID) (*Chat, error) {
	const q = `
		SELECT id, type, title, avatar_url, created_by, status, created_at
		FROM chats WHERE id = $1
	`
	var c Chat
	err := r.db.QueryRow(ctx, q, chatID).Scan(
		&c.ID, &c.Type, &c.Title, &c.AvatarURL, &c.CreatedBy, &c.Status, &c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) IsParticipant(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2
		)
	`, chatID, userID).Scan(&exists)
	return exists, err
}

func (r *Repository) UpdateChatStatus(ctx context.Context, chatID uuid.UUID, status ChatStatus) error {
	_, err := r.db.Exec(ctx, `UPDATE chats SET status = $1 WHERE id = $2`, string(status), chatID)
	return err
}

func (r *Repository) ChatStatus(ctx context.Context, chatID uuid.UUID) (ChatStatus, error) {
	var status ChatStatus
	err := r.db.QueryRow(ctx, `SELECT status FROM chats WHERE id = $1`, chatID).Scan(&status)
	return status, err
}

func (r *Repository) MessageCount(ctx context.Context, chatID, userID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM messages WHERE chat_id = $1 AND sender_id = $2`, chatID, userID).Scan(&n)
	return n, err
}

// ── Messages ────────────────────────────────────────────────────────────────

// InsertMessage stores a message with encrypted content. Returns the new ID.
// Origin carries where forwarded content came from. Zero value means the
// message was written in place.
type Origin struct {
	ForwardCount int
	ChannelID    *string
	PostID       *string
}

func (r *Repository) InsertMessage(ctx context.Context, chatID, senderID uuid.UUID, content string, msgType MessageType, replyToID *int64, viewLimit *int, origin Origin) (int64, error) {
	const q = `
		INSERT INTO messages (chat_id, sender_id, content, message_type, reply_to_id, view_limit,
		                      forward_count, source_channel_id, source_post_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`
	encrypted := r.encrypt(content)
	var id int64
	err := r.db.QueryRow(ctx, q, chatID, senderID, encrypted, string(msgType), replyToID, viewLimit,
		origin.ForwardCount, origin.ChannelID, origin.PostID).Scan(&id)
	return id, err
}

// RegisterView records one open and reports how many remain.
//
// Enforced here rather than on the device: a reinstall would otherwise
// reset the count, which would make "view once" a suggestion.
func (r *Repository) RegisterView(ctx context.Context, messageID int64, userID uuid.UUID) (limit *int, left *int, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	if err = tx.QueryRow(ctx,
		`SELECT view_limit FROM messages WHERE id = $1`, messageID).Scan(&limit); err != nil {
		return nil, nil, err
	}
	// Unlimited messages are not tracked at all.
	if limit == nil {
		return nil, nil, tx.Commit(ctx)
	}

	// The limit is enforced by the statement, not by a check around it.
	//
	// Counting first and judging afterwards made the last permitted view
	// look like one too many: a view_limit of 1 left zero remaining on the
	// very first open, which the caller read as exhausted. A "view once"
	// message could not be viewed once.
	//
	// Doing it in one statement also settles the race — two devices opening
	// at the same moment cannot both pass a check and then both increment.
	var used int
	err = tx.QueryRow(ctx, `
		INSERT INTO message_views (message_id, user_id, views)
		SELECT $1, $2, 1 WHERE $3 > 0
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET views = message_views.views + 1, last_at = NOW()
		WHERE message_views.views < $3
		RETURNING views
	`, messageID, userID, *limit).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing was written: the allowance was already spent.
		return limit, new(int), ErrViewsExhausted
	}
	if err != nil {
		return nil, nil, err
	}

	remaining := *limit - used
	if remaining < 0 {
		remaining = 0
	}
	return limit, &remaining, tx.Commit(ctx)
}

// ListMessages returns messages for a chat, newest first, with cursor-based
// pagination. Content is decrypted on read. Sender display name/avatar are
// joined in the same query to avoid N+1 lookups.
// messageSelectBase is shared by the paginated and first-page branches of
// ListMessages so the two can never drift in the columns they project.
//
// The receipt counts are what drive the sender's tick state. They are folded
// in here rather than fetched per-message because the client reads them on
// every history load: without them a reloaded chat always renders one tick,
// even for messages the peer read days ago.
//
// `delivered` deliberately counts 'read' as well — a message that was read
// was necessarily delivered, and the client's precedence check reads
// read_by first, so leaving them disjoint would flicker a read message back
// to one tick if the delivered receipt never arrived on its own.
// $1 is the reader. Views are per-person, so a limited message cannot be
// described without knowing who is asking.
const messageSelectBase = `
	SELECT m.id, m.chat_id, m.sender_id, m.content, m.message_type, m.reply_to_id,
	       m.created_at, m.edited_at, m.deleted_at,
	       COALESCE(u.display_name, ''), COALESCE(u.avatar_uri, ''),
	       rc.delivered_to, rc.read_by,
	       m.forward_count, m.source_channel_id::text, m.source_post_id::text,
	       m.expires_at,
	       m.view_limit, COALESCE(mv.views, 0),
	       COALESCE(rx.list, '[]')
	FROM messages m
	LEFT JOIN users u ON u.id = m.sender_id
	-- Joined rather than queried per row: a page of fifty messages must not
	-- become fifty-one round trips because one of them might be a view-once.
	LEFT JOIN message_views mv ON mv.message_id = m.id AND mv.user_id = $1
	-- What this reader is allowed to see.
	--
	-- chats.history_enabled has promised this since migration 0010 and nothing
	-- ever read it, so every new member saw the entire history regardless of
	-- what the group was set to. Enforced here, in the read path, because a
	-- rule applied anywhere else is a rule a different client can skip.
	JOIN chat_participants cpv
	     ON cpv.chat_id = m.chat_id AND cpv.user_id = $1
	-- Reactions came back only over the websocket, so reopening a chat lost
	-- every one of them: the map started empty and nothing on the read path
	-- refilled it. Aggregated here rather than queried per message — a page
	-- of fifty must not become fifty-one round trips.
	LEFT JOIN LATERAL (
	    SELECT json_agg(json_build_object(
	               'message_id', mr.message_id,
	               'user_id',    mr.user_id,
	               'emoji',      mr.emoji,
	               'created_at', mr.created_at
	           ) ORDER BY mr.created_at)::text AS list
	    FROM message_reactions mr
	    WHERE mr.message_id = m.id
	) rx ON TRUE
	LEFT JOIN LATERAL (
	    SELECT count(*) FILTER (WHERE mr.status IN ('delivered', 'read')) AS delivered_to,
	           count(*) FILTER (WHERE mr.status = 'read')                 AS read_by
	    FROM message_receipts mr
	    WHERE mr.message_id = m.id AND mr.user_id <> m.sender_id
	) rc ON TRUE
`

// NonGhostParticipantIDs is ParticipantIDs minus anyone in ghost mode.
//
// The other half of the ghost bargain, and it has to happen here: an
// ephemeral signal like typing is fanned out to a chat, so "do not show me
// theirs" cannot be a decision the recipient makes — by then it has already
// been sent, and a client that would rather not honour it simply would not.
func (r *Repository) NonGhostParticipantIDs(ctx context.Context, chatID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `
		SELECT cp.user_id
		FROM chat_participants cp
		JOIN users u ON u.id = cp.user_id
		WHERE cp.chat_id = $1 AND NOT u.ghost_mode
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListMessages returns a page of history.
//
// hideRead blanks the read counts, for a caller who has turned read receipts
// off: the reciprocity is applied here so it cannot be skipped by a client
// that would rather not.
func (r *Repository) ListMessages(ctx context.Context, chatID, viewerID uuid.UUID, limit int, before int64, hideRead bool) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var rows pgx.Rows
	var err error

	if before > 0 {
		const q = messageSelectBase + `
			WHERE m.chat_id = $2 AND m.id < $3 AND m.deleted_at IS NULL
			  AND (cpv.history_from IS NULL OR m.created_at >= cpv.history_from)
			  -- Past its deadline but not yet swept: hide it now rather
			  -- than let the sweep interval decide how long it lingers.
			  AND (m.expires_at IS NULL OR m.expires_at > NOW())
			ORDER BY m.id DESC
			LIMIT $4
		`
		rows, err = r.db.Query(ctx, q, viewerID, chatID, before, limit)
	} else {
		const q = messageSelectBase + `
			WHERE m.chat_id = $2 AND m.deleted_at IS NULL
			  AND (cpv.history_from IS NULL OR m.created_at >= cpv.history_from)
			  AND (m.expires_at IS NULL OR m.expires_at > NOW())
			ORDER BY m.id DESC
			LIMIT $3
		`
		rows, err = r.db.Query(ctx, q, viewerID, chatID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Message
	for rows.Next() {
		var m messageRow
		var senderName, senderAvatar string
		var deliveredTo, readBy, forwardCount int
		var srcChannel, srcPost *string
		var expiresAt *time.Time
		var viewLimit *int
		var viewsUsed int
		var reactionsJSON string
		if err := rows.Scan(&m.ID, &m.ChatID, &m.SenderID, &m.Content,
			&m.MessageType, &m.ReplyToID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt,
			&senderName, &senderAvatar, &deliveredTo, &readBy,
			&forwardCount, &srcChannel, &srcPost, &expiresAt,
			&viewLimit, &viewsUsed, &reactionsJSON); err != nil {
			return nil, err
		}
		var reactions []Reaction
		if reactionsJSON != "" && reactionsJSON != "[]" {
			// A malformed aggregate must not sink the whole page: the message
			// is worth more than its reactions.
			_ = json.Unmarshal([]byte(reactionsJSON), &reactions)
		}
		// Reported without consuming anything. Scrolling past a view-once
		// must not spend it — only opening it does, through RegisterView.
		var viewsLeft *int
		if viewLimit != nil {
			remaining := *viewLimit - viewsUsed
			if remaining < 0 {
				remaining = 0
			}
			viewsLeft = &remaining
		}
		out = append(out, Message{
			ID:              m.ID,
			ChatID:          m.ChatID,
			SenderID:        m.SenderID,
			Content:         r.decrypt(m.Content),
			MessageType:     MessageType(m.MessageType),
			ReplyToID:       m.ReplyToID,
			CreatedAt:       m.CreatedAt,
			EditedAt:        m.EditedAt,
			DeletedAt:       m.DeletedAt,
			SenderName:      senderName,
			SenderAvatar:    senderAvatar,
			DeliveredTo:     deliveredTo,
			ReadBy:          readByFor(readBy, hideRead),
			ForwardCount:    forwardCount,
			ViewLimit:       viewLimit,
			ViewsLeft:       viewsLeft,
			Reactions:       reactions,
			SourceChannelID: srcChannel,
			SourcePostID:    srcPost,
			ExpiresAt:       expiresAt,
		})
	}
	return out, rows.Err()
}

// LastMessage returns the most-recent non-deleted message with
// decrypted content for chat list previews.
func (r *Repository) LastMessage(ctx context.Context, chatID uuid.UUID) (*MessagePreview, error) {
	const q = `
		SELECT content, message_type, sender_id, created_at
		FROM messages
		WHERE chat_id = $1 AND deleted_at IS NULL
		ORDER BY id DESC
		LIMIT 1
	`
	var preview MessagePreview
	var ciphertext string
	if err := r.db.QueryRow(ctx, q, chatID).Scan(&ciphertext, &preview.MessageType, &preview.SenderID, &preview.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	preview.Content = r.decrypt(ciphertext)
	return &preview, nil
}

// ParticipantIDs lists every user in a chat (for WS fan-out).
func (r *Repository) ParticipantIDs(ctx context.Context, chatID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `
		SELECT user_id FROM chat_participants WHERE chat_id = $1
	`, chatID)
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

// GetMessage fetches a single message (including soft-deleted for tombstones).
func (r *Repository) GetMessage(ctx context.Context, chatID uuid.UUID, msgID int64) (*Message, error) {
	const q = `
		SELECT m.id, m.chat_id, m.sender_id, m.content, m.message_type, m.reply_to_id,
		       m.created_at, m.edited_at, m.deleted_at,
		       COALESCE(u.display_name, ''), COALESCE(u.avatar_uri, '')
		FROM messages m
		LEFT JOIN users u ON u.id = m.sender_id
		WHERE m.chat_id = $1 AND m.id = $2
	`
	var m messageRow
	var senderName, senderAvatar string
	err := r.db.QueryRow(ctx, q, chatID, msgID).Scan(
		&m.ID, &m.ChatID, &m.SenderID, &m.Content, &m.MessageType, &m.ReplyToID,
		&m.CreatedAt, &m.EditedAt, &m.DeletedAt, &senderName, &senderAvatar,
	)
	if err != nil {
		return nil, err
	}
	content := ""
	if m.DeletedAt == nil {
		content = r.decrypt(m.Content)
	}
	return &Message{
		ID:           m.ID,
		ChatID:       m.ChatID,
		SenderID:     m.SenderID,
		Content:      content,
		MessageType:  MessageType(m.MessageType),
		ReplyToID:    m.ReplyToID,
		CreatedAt:    m.CreatedAt,
		EditedAt:     m.EditedAt,
		DeletedAt:    m.DeletedAt,
		SenderName:   senderName,
		SenderAvatar: senderAvatar,
	}, nil
}

func (r *Repository) EditMessage(ctx context.Context, chatID, senderID uuid.UUID, msgID int64, content string) error {
	encrypted := r.encrypt(content)
	tag, err := r.db.Exec(ctx, `
		UPDATE messages
		SET content = $1, edited_at = NOW()
		WHERE id = $2 AND chat_id = $3 AND sender_id = $4 AND deleted_at IS NULL
	`, encrypted, msgID, chatID, senderID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) SoftDeleteMessage(ctx context.Context, chatID, senderID uuid.UUID, msgID int64) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE messages
		SET deleted_at = NOW(), content = ''
		WHERE id = $1 AND chat_id = $2 AND sender_id = $3 AND deleted_at IS NULL
	`, msgID, chatID, senderID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpsertReceipt sets delivered/read for (message, user). Read upgrades delivered.
func (r *Repository) UpsertReceipt(ctx context.Context, messageID int64, userID uuid.UUID, status ReceiptStatus) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO message_receipts (message_id, user_id, status, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (message_id, user_id) DO UPDATE
		SET status = CASE
			WHEN message_receipts.status = 'read' THEN 'read'
			WHEN EXCLUDED.status = 'read' THEN 'read'
			ELSE EXCLUDED.status
		END,
		updated_at = NOW()
	`, messageID, userID, string(status))
	return err
}

func (r *Repository) SetLastRead(ctx context.Context, chatID, userID uuid.UUID, messageID int64) error {
	_, err := r.db.Exec(ctx, `
		UPDATE chat_participants
		SET last_read_message_id = CASE
			WHEN last_read_message_id IS NULL OR last_read_message_id < $3 THEN $3
			ELSE last_read_message_id
		END,
		last_read_at = NOW()
		WHERE chat_id = $1 AND user_id = $2
	`, chatID, userID, messageID)
	return err
}

// MessageIDsInChat validates that every id belongs to the chat and returns
// those that do (filters invalid ids silently).
func (r *Repository) MessageIDsInChat(ctx context.Context, chatID uuid.UUID, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT id FROM messages WHERE chat_id = $1 AND id = ANY($2)
	`, chatID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *Repository) AddReaction(ctx context.Context, messageID int64, userID uuid.UUID, emoji string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO message_reactions (message_id, user_id, emoji)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, messageID, userID, emoji)
	return err
}

func (r *Repository) RemoveReaction(ctx context.Context, messageID int64, userID uuid.UUID, emoji string) error {
	_, err := r.db.Exec(ctx, `
		DELETE FROM message_reactions
		WHERE message_id = $1 AND user_id = $2 AND emoji = $3
	`, messageID, userID, emoji)
	return err
}

func (r *Repository) ListReactions(ctx context.Context, messageID int64) ([]Reaction, error) {
	rows, err := r.db.Query(ctx, `
		SELECT message_id, user_id, emoji, created_at
		FROM message_reactions WHERE message_id = $1
		ORDER BY created_at ASC
	`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reaction
	for rows.Next() {
		var rct Reaction
		if err := rows.Scan(&rct.MessageID, &rct.UserID, &rct.Emoji, &rct.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rct)
	}
	return out, rows.Err()
}

// UnreadCount counts messages after the user's last_read cursor that they did not send.
func (r *Repository) UnreadCount(ctx context.Context, chatID, userID uuid.UUID) (int, error) {
	const q = `
		SELECT COUNT(*)
		FROM messages m
		JOIN chat_participants cp ON cp.chat_id = m.chat_id AND cp.user_id = $2
		WHERE m.chat_id = $1
		  AND m.deleted_at IS NULL
		  AND m.sender_id <> $2
		  AND (cp.last_read_message_id IS NULL OR m.id > cp.last_read_message_id)
	`
	var n int
	err := r.db.QueryRow(ctx, q, chatID, userID).Scan(&n)
	return n, err
}

// MessageReceipts lists who received or read one message, with names, so
// the client can show a per-recipient breakdown instead of a single tick.
func (r *Repository) MessageReceipts(ctx context.Context, messageID int64) ([]ReceiptDetail, error) {
	const q = `
		SELECT r.user_id, u.display_name, u.username, r.status, r.updated_at
		FROM message_receipts r
		JOIN users u ON u.id = r.user_id
		WHERE r.message_id = $1
		ORDER BY r.updated_at
	`
	rows, err := r.db.Query(ctx, q, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ReceiptDetail
	for rows.Next() {
		var d ReceiptDetail
		if err := rows.Scan(&d.UserID, &d.DisplayName, &d.Username, &d.Status, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// MessageSender is used to check the caller owns the message before
// revealing who read it.
func (r *Repository) MessageSender(ctx context.Context, messageID int64) (uuid.UUID, uuid.UUID, error) {
	var sender, chat uuid.UUID
	err := r.db.QueryRow(ctx,
		`SELECT sender_id, chat_id FROM messages WHERE id = $1`, messageID).Scan(&sender, &chat)
	return sender, chat, err
}

// SetPollVotes replaces a voter's selections on one poll.
//
// Replace rather than append: a single-choice poll must not accumulate the
// options someone clicked through on the way to their answer, and unvoting
// arrives here as an empty list.
func (r *Repository) SetPollVotes(ctx context.Context, messageID int64, userID uuid.UUID, optionIDs []string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`DELETE FROM message_poll_votes WHERE message_id = $1 AND user_id = $2`,
		messageID, userID); err != nil {
		return err
	}
	for _, opt := range optionIDs {
		if opt == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO message_poll_votes (message_id, user_id, option_id)
			VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING
		`, messageID, userID, opt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// PollTallies returns per-option counts plus the caller's own selections for
// each of the given messages. Messages with no votes are simply absent.
func (r *Repository) PollTallies(ctx context.Context, messageIDs []int64, userID uuid.UUID) (map[int64]*PollTally, error) {
	out := map[int64]*PollTally{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT message_id, option_id, count(*) AS votes,
		       bool_or(user_id = $2) AS mine
		FROM message_poll_votes
		WHERE message_id = ANY($1)
		GROUP BY message_id, option_id
	`, messageIDs, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var mid int64
		var opt string
		var votes int
		var mine bool
		if err := rows.Scan(&mid, &opt, &votes, &mine); err != nil {
			return nil, err
		}
		t := out[mid]
		if t == nil {
			t = &PollTally{Counts: map[string]int{}, Mine: []string{}}
			out[mid] = t
		}
		t.Counts[opt] = votes
		if mine {
			t.Mine = append(t.Mine, opt)
		}
	}
	return out, rows.Err()
}

// InsertReport files or updates the caller's report on a chat.
//
// One row per reporter per chat: filing again replaces the reason rather
// than stacking, so the queue reflects how many distinct people complained
// and not how many times one person tapped the button.
func (r *Repository) InsertReport(ctx context.Context, chatID, reporterID uuid.UUID, reason, note string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO chat_reports (chat_id, reporter_id, reason, note)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		ON CONFLICT (chat_id, reporter_id) DO UPDATE
		   SET reason = EXCLUDED.reason,
		       note = EXCLUDED.note,
		       status = 'open',
		       created_at = NOW()
	`, chatID, reporterID, reason, note)
	return err
}

// readByFor drops the read count when the caller has opted out of receipts.
// Delivered is untouched: knowing a message arrived is not the same as
// knowing it was read, and only the second is what the setting is about.
func readByFor(readBy int, hide bool) int {
	if hide {
		return 0
	}
	return readBy
}
