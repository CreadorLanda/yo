package messages

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/CreadorLanda/yo/server/internal/modules/users"
)

var (
	ErrChatNotFound        = errors.New("chat_not_found")
	ErrNotParticipant      = errors.New("not_participant")
	ErrChatBlocked         = errors.New("chat_blocked")
	ErrPendingChatLimit    = errors.New("pending_chat_limit")
	ErrCannotAcceptOwn     = errors.New("cannot_accept_own_request")
	ErrChatNotPending      = errors.New("chat_not_pending")
	ErrMessageNotFound     = errors.New("message_not_found")
	ErrInvalidReport       = errors.New("invalid_report")
	ErrNotSender           = errors.New("not_message_sender")
	ErrInvalidReceipt      = errors.New("invalid_receipt_status")
	ErrViewsExhausted      = errors.New("views_exhausted")
	ErrUnencryptedMessage  = errors.New("message_must_be_e2ee_envelope")
	ErrInvalidMessageType  = errors.New("invalid_message_type")
	ErrInvalidEnvelopeChat = errors.New("invalid_e2ee_envelope_for_chat")
)

// Broadcaster is satisfied by *realtime.Hub. Kept as an interface so the
// messages module does not import the WS stack into unit tests.
type Broadcaster interface {
	PublishJSON(userIDs []uuid.UUID, typ, chatID string, payload any)
	Online(userID uuid.UUID) bool
}

// PushNotifier enqueues offline push jobs (notifications module).
type PushNotifier interface {
	NotifyUser(ctx context.Context, userID uuid.UUID, category, title, body string, data map[string]string) error
}

// BlockList answers the one question this module asks about blocking.
//
// An interface rather than an import: modules here do not reach into each
// other's storage. Optional — a server wired without it simply enforces no
// blocks, which is what it did before there were any.
type BlockList interface {
	// EitherWay reports whether either person has blocked the other. A
	// one-to-one channel needs both sides willing; who pressed the button does
	// not change who should be spared.
	EitherWay(ctx context.Context, a, b uuid.UUID) (bool, error)
	// Block is for reporting someone and blocking them in the same tap.
	Block(ctx context.Context, blocker, blocked uuid.UUID) error
}

type Service struct {
	repo   *Repository
	users  *users.Repository
	hub    Broadcaster
	push   PushNotifier
	blocks BlockList
}

func NewService(repo *Repository, usersRepo *users.Repository, hub Broadcaster, push PushNotifier) *Service {
	return &Service{repo: repo, users: usersRepo, hub: hub, push: push}
}

// WithBlocks wires block enforcement.
//
// Separate from NewService so the existing call sites and every test that
// builds a Service keep working unchanged — a block list is not something most
// of them have an opinion about.
func (s *Service) WithBlocks(b BlockList) *Service {
	s.blocks = b
	return s
}

// ── Chats ───────────────────────────────────────────────────────────────────

func (s *Service) CreateDirectChat(ctx context.Context, userID, peerID uuid.UUID) (Chat, error) {
	existing, err := s.repo.FindDirectChat(ctx, userID, peerID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Chat{}, err
	}
	if existing != nil {
		return s.loadChat(ctx, existing.ID, userID)
	}

	chatID, err := s.repo.CreateChat(ctx, ChatDirect, userID, []uuid.UUID{userID, peerID}, ChatStatusPending)
	if err != nil {
		return Chat{}, err
	}
	return s.loadChat(ctx, chatID, userID)
}

// AcceptChat lets the recipient (not the creator) promote a pending
// friend-request chat to active.
func (s *Service) AcceptChat(ctx context.Context, chatID, userID uuid.UUID) (Chat, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return Chat{}, err
	}
	chat, err := s.repo.GetChat(ctx, chatID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Chat{}, ErrChatNotFound
		}
		return Chat{}, err
	}
	if chat.Status != ChatStatusPending {
		return Chat{}, ErrChatNotPending
	}
	if chat.CreatedBy == userID {
		return Chat{}, ErrCannotAcceptOwn
	}
	if err := s.repo.UpdateChatStatus(ctx, chatID, ChatStatusActive); err != nil {
		return Chat{}, err
	}

	// Tell the person who asked.
	//
	// Being accepted is the one moment in this flow the requester cannot
	// discover on their own: nothing arrives, the chat simply stops being
	// pending. Without this they have to keep reopening it to find out.
	accepter, err := s.users.ByID(ctx, userID)
	name := "Someone"
	if err == nil && accepter != nil && accepter.DisplayName != "" {
		name = accepter.DisplayName
	}
	s.notifyChatAccepted(ctx, chatID, chat.CreatedBy, name)

	// The requester's open screen should stop showing a pending banner
	// without waiting for a refresh.
	s.broadcast(ctx, chatID, "chat.accepted", map[string]any{
		"chat_id":     chatID.String(),
		"accepted_by": userID.String(),
	})

	return s.loadChat(ctx, chatID, userID)
}

// notifyChatAccepted pushes to the requester only. The accepter performed the
// action and needs no telling.
func (s *Service) notifyChatAccepted(ctx context.Context, chatID, requester uuid.UUID, accepterName string) {
	if s.push == nil {
		return
	}
	if s.hub != nil && s.hub.Online(requester) {
		// The broadcast above already reached them.
		return
	}
	_ = s.push.NotifyUser(ctx, requester, "messages",
		accepterName, "accepted your request",
		map[string]string{"type": "chat.accepted", "chat_id": chatID.String()})
}

// BlockChat marks a chat blocked. Any participant may block.
// ListChats returns one page of the caller's chats. The preview, unread
// count and peer are resolved inside the repository query — no per-chat
// round trips.
func (s *Service) ListChats(ctx context.Context, userID uuid.UUID, opts ListChatsOptions) ([]Chat, error) {
	opts.Normalize()
	chats, err := s.repo.ListChats(ctx, userID, opts)
	if err != nil {
		return nil, err
	}
	s.fillPresence(ctx, userID, chats)
	return chats, nil
}

// UpdateChatSettings toggles pin / mute / archive for the caller only.
func (s *Service) UpdateChatSettings(ctx context.Context, chatID, userID uuid.UUID, req ChatSettingsRequest) (Chat, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return Chat{}, err
	}
	if err := s.repo.UpdateChatSettings(ctx, chatID, userID, req); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Chat{}, ErrChatNotFound
		}
		return Chat{}, err
	}
	return s.loadChat(ctx, chatID, userID)
}

// ClearChatHistory hides existing messages from the caller only.
func (s *Service) ClearChatHistory(ctx context.Context, chatID, userID uuid.UUID) error {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if err := s.repo.ClearHistory(ctx, chatID, userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChatNotFound
		}
		return err
	}
	return nil
}

// DeleteChat removes the chat from the caller's list and clears their copy
// of the history. The peer is unaffected, and the chat returns if they write.
func (s *Service) DeleteChat(ctx context.Context, chatID, userID uuid.UUID) error {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if err := s.repo.HideChat(ctx, chatID, userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChatNotFound
		}
		return err
	}
	return nil
}

// MessageInfo returns per-recipient delivery detail. Restricted to the
// sender: who read your message is yours to see, not the whole chat's.
func (s *Service) MessageInfo(ctx context.Context, chatID uuid.UUID, messageID int64, caller uuid.UUID) ([]ReceiptDetail, error) {
	if err := s.requireParticipant(ctx, chatID, caller); err != nil {
		return nil, err
	}
	sender, owningChat, err := s.repo.MessageSender(ctx, messageID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}
	if owningChat != chatID {
		return nil, ErrMessageNotFound
	}
	if sender != caller {
		return nil, ErrNotSender
	}
	return s.repo.MessageReceipts(ctx, messageID)
}

// OpenLimitedMessage consumes one view of a limited-view message and
// reports what is left. Returns ErrViewsExhausted once the recipient has
// used them all, so the client can render the burnt state instead of the
// content.
func (s *Service) OpenLimitedMessage(ctx context.Context, chatID uuid.UUID, messageID int64, viewer uuid.UUID) (*int, *int, error) {
	if err := s.requireParticipant(ctx, chatID, viewer); err != nil {
		return nil, nil, err
	}
	limit, left, err := s.repo.RegisterView(ctx, messageID, viewer)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrMessageNotFound
		}
		// Includes ErrViewsExhausted, which the repository decides because
		// only it can tell "this was the last view" from "there was none
		// left" without a second query racing the first.
		return limit, left, err
	}
	return limit, left, nil
}

// ── Messages ────────────────────────────────────────────────────────────────

func (s *Service) SendMessage(ctx context.Context, chatID, senderID uuid.UUID, req SendMessageRequest) (Message, error) {
	if err := s.requireParticipant(ctx, chatID, senderID); err != nil {
		return Message{}, err
	}
	msgType := req.MessageType
	if msgType == "" {
		msgType = MsgText
	}
	status, err := s.repo.ChatStatus(ctx, chatID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrChatNotFound
		}
		return Message{}, err
	}
	chat, err := s.repo.GetChat(ctx, chatID)
	if err != nil {
		return Message{}, err
	}
	// A block stops a one-to-one conversation and nothing else.
	//
	// Groups are deliberately untouched: a group is a place with other people
	// in it, and one member's decision about another is not a reason to take
	// their conversation away. The app tells you who in the room you blocked.
	if s.blocks != nil && chat.Type == ChatDirect {
		peer, err := s.repo.PeerUser(ctx, chatID, senderID)
		if err == nil && peer != nil {
			blocked, err := s.blocks.EitherWay(ctx, senderID, peer.ID)
			if err == nil && blocked {
				return Message{}, ErrChatBlocked
			}
		}
	}

	switch status {
	case ChatStatusBlocked:
		// No longer written by anything — kept so conversations blocked before
		// migration 0039, on a server that has not run it yet, still refuse.
		return Message{}, ErrChatBlocked
	case ChatStatusPending:
		// Only 1 message per user allowed until the recipient accepts.
		count, err := s.repo.MessageCount(ctx, chatID, senderID)
		if err != nil {
			return Message{}, err
		}
		if count >= 1 {
			return Message{}, ErrPendingChatLimit
		}
	}
	if !userSendableMessageType(msgType) {
		return Message{}, ErrInvalidMessageType
	}
	if !validateEnvelopeForChat(req.Content, senderID, chat.Type) {
		return Message{}, envelopeError(req.Content)
	}
	// One more hop than the client claims, and never fewer than zero. Taking
	// the number at face value would let a client reset a chain that has been
	// round the block ten times back to "written just for you".
	// The field being present is what marks this as a forward; its value is
	// the count the source carried. Gating on "> 0" instead meant a channel
	// post — which carries zero, being first-hand where it stands — could
	// never reach one hop, and a chat message at one hop jumped to two.
	origin := Origin{}
	if req.ForwardCount != nil {
		origin.ForwardCount = *req.ForwardCount + 1
	}
	origin.ChannelID = req.SourceChannelID
	origin.PostID = req.SourcePostID

	id, err := s.repo.InsertMessage(ctx, chatID, senderID, req.Content, msgType,
		req.ReplyToID, req.ViewLimit, origin)
	if err != nil {
		return Message{}, err
	}
	msg, err := s.getMessage(ctx, chatID, id)
	if err != nil {
		return Message{}, err
	}
	s.broadcast(ctx, chatID, "message.new", msg)
	s.notifyOffline(ctx, chatID, senderID, msg)
	return msg, nil
}

func (s *Service) ListMessages(ctx context.Context, chatID, userID uuid.UUID, limit int, before int64) ([]Message, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return nil, err
	}
	// The other half of the bargain: with read receipts off you do not see
	// anyone else's either. Enforced on the way out rather than by asking
	// the client to hide them, because a setting the client enforces is a
	// setting the client can decline to enforce.
	hideRead := false
	if u, err := s.users.ByID(ctx, userID); err == nil && (!u.ReadReceipts || u.GhostMode) {
		if chat, err := s.repo.ChatForUser(ctx, chatID, userID); err == nil && chat.Type == ChatDirect {
			hideRead = true
		}
	}

	msgs, err := s.repo.ListMessages(ctx, chatID, userID, limit, before, hideRead)
	if err != nil {
		return nil, err
	}
	s.attachPollTallies(ctx, userID, msgs)
	return msgs, nil
}

// EditMessage updates content (sender only) and fans out over WS.
func (s *Service) EditMessage(ctx context.Context, chatID, userID uuid.UUID, msgID int64, content string) (Message, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return Message{}, err
	}
	existing, err := s.repo.GetMessage(ctx, chatID, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrMessageNotFound
		}
		return Message{}, err
	}
	if existing.DeletedAt != nil {
		return Message{}, ErrMessageNotFound
	}
	// Nil sender means the account is gone, and nobody inherits the right to
	// edit what it wrote. The comparison failing is the correct answer.
	if existing.SenderID == nil || *existing.SenderID != userID {
		return Message{}, ErrNotSender
	}
	if existing.MessageType == MsgSystem || existing.MessageType == MsgCall {
		return Message{}, ErrInvalidMessageType
	}
	chat, err := s.repo.GetChat(ctx, chatID)
	if err != nil {
		return Message{}, err
	}
	if !validateEnvelopeForChat(content, userID, chat.Type) {
		return Message{}, envelopeError(content)
	}
	if err := s.repo.EditMessage(ctx, chatID, userID, msgID, content); err != nil {
		return Message{}, err
	}
	msg, err := s.getMessage(ctx, chatID, msgID)
	if err != nil {
		return Message{}, err
	}
	s.broadcast(ctx, chatID, "message.edited", msg)
	return msg, nil
}

// DeleteMessage soft-deletes (sender only).
func (s *Service) DeleteMessage(ctx context.Context, chatID, userID uuid.UUID, msgID int64) (Message, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return Message{}, err
	}
	existing, err := s.repo.GetMessage(ctx, chatID, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrMessageNotFound
		}
		return Message{}, err
	}
	if existing.SenderID == nil || *existing.SenderID != userID {
		return Message{}, ErrNotSender
	}
	if err := s.repo.SoftDeleteMessage(ctx, chatID, userID, msgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrMessageNotFound
		}
		return Message{}, err
	}
	msg, err := s.repo.GetMessage(ctx, chatID, msgID)
	if err != nil {
		return Message{}, err
	}
	s.broadcast(ctx, chatID, "message.deleted", msg)
	return *msg, nil
}

// SetReceipts marks messages delivered/read for the caller and notifies peers.
func (s *Service) SetReceipts(ctx context.Context, chatID, userID uuid.UUID, req ReceiptRequest) error {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if req.Status != ReceiptDelivered && req.Status != ReceiptRead {
		return ErrInvalidReceipt
	}

	// Read receipts are reciprocal, and only in one-to-one chats — the same
	// bargain other messengers strike. With them off, a "read" is recorded
	// as no more than delivered: you cannot withhold yours and still send
	// them, or the setting would mean nothing.
	//
	// Groups are exempt because a group read receipt is about a room rather
	// than about you, and hiding one person's would make the rest wrong.
	if req.Status == ReceiptRead {
		if chat, err := s.repo.ChatForUser(ctx, chatID, userID); err == nil && chat.Type == ChatDirect {
			if u, err := s.users.ByID(ctx, userID); err == nil && (!u.ReadReceipts || u.GhostMode) {
				req.Status = ReceiptDelivered
			}
		}
	}
	ids, err := s.repo.MessageIDsInChat(ctx, chatID, req.MessageIDs)
	if err != nil {
		return err
	}
	// Reading is what starts a disappearing message's clock. Done here
	// rather than in the client so it cannot be skipped by not asking.
	if req.Status == ReceiptRead {
		if sec, err := s.repo.DisappearSeconds(ctx, chatID); err == nil && sec > 0 {
			_ = s.repo.StartExpiryClock(ctx, ids, sec)
		}
	}

	var maxID int64
	for _, id := range ids {
		if err := s.repo.UpsertReceipt(ctx, id, userID, req.Status); err != nil {
			return err
		}
		if id > maxID {
			maxID = id
		}
		s.broadcast(ctx, chatID, "receipt", Receipt{
			MessageID: id,
			UserID:    userID,
			Status:    req.Status,
		})
	}
	if req.Status == ReceiptRead && maxID > 0 {
		_ = s.repo.SetLastRead(ctx, chatID, userID, maxID)
	}
	return nil
}

// MarkRead is a convenience: mark everything up to messageID as read.
func (s *Service) MarkRead(ctx context.Context, chatID, userID uuid.UUID, messageID int64) error {
	return s.SetReceipts(ctx, chatID, userID, ReceiptRequest{
		MessageIDs: []int64{messageID},
		Status:     ReceiptRead,
	})
}

// Typing broadcasts a composing indicator (ephemeral — not persisted).
//
// `kind` says what they are doing: composing text, or holding the mic. Anything
// unrecognised is treated as typing, which is what an older client sends.
func (s *Service) Typing(ctx context.Context, chatID, userID uuid.UUID, typing bool, kind string) error {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if kind != "recording" {
		kind = "typing"
	}
	// Ghost mode covers both halves of this signal. Sending nothing is the
	// point of it; receiving nothing is the price, on the same terms read
	// receipts have been on since 0029.
	if u, err := s.users.ByID(ctx, userID); err == nil && u.GhostMode {
		return nil
	}
	ids, err := s.repo.NonGhostParticipantIDs(ctx, chatID)
	if err != nil || len(ids) == 0 {
		return nil
	}
	if s.hub != nil {
		s.hub.PublishJSON(ids, "typing", chatID.String(), map[string]any{
			"user_id": userID,
			"typing":  typing,
			"kind":    kind,
		})
	}
	return nil
}

// React toggles an emoji reaction on a message.
func (s *Service) React(ctx context.Context, chatID, userID uuid.UUID, msgID int64, emoji string, remove bool) ([]Reaction, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return nil, err
	}
	if _, err := s.repo.GetMessage(ctx, chatID, msgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}
	if remove {
		if err := s.repo.RemoveReaction(ctx, msgID, userID, emoji); err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.AddReaction(ctx, msgID, userID, emoji); err != nil {
			return nil, err
		}
	}
	list, err := s.repo.ListReactions(ctx, msgID)
	if err != nil {
		return nil, err
	}
	s.broadcast(ctx, chatID, "message.reaction", map[string]any{
		"message_id": msgID,
		"user_id":    userID,
		"emoji":      emoji,
		"removed":    remove,
		"reactions":  list,
	})
	return list, nil
}

// ── Internal helpers ────────────────────────────────────────────────────────

func (s *Service) requireParticipant(ctx context.Context, chatID, userID uuid.UUID) error {
	ok, err := s.repo.IsParticipant(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotParticipant
	}
	return nil
}

func (s *Service) enrichDirectPeer(ctx context.Context, c *Chat, forUser uuid.UUID) {
	if c.Type != ChatDirect {
		return
	}
	peer, err := s.repo.PeerUser(ctx, c.ID, forUser)
	if err != nil {
		return
	}
	c.Title = &peer.DisplayName
	if peer.AvatarURI != "" {
		c.AvatarURL = &peer.AvatarURI
	}
	id := peer.ID
	c.PeerUserID = &id
	uname := peer.Username
	c.PeerUsername = &uname
}

func (s *Service) loadChat(ctx context.Context, chatID uuid.UUID, forUser uuid.UUID) (Chat, error) {
	c, err := s.repo.ChatForUser(ctx, chatID, forUser)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Chat{}, ErrChatNotFound
		}
		return Chat{}, err
	}
	// Same presence rules as the list. The chat screen's header is where a
	// person actually reads "online" or "last seen", so leaving it out here
	// would mean the dot lit in the list and nowhere else.
	one := []Chat{*c}
	s.fillPresence(ctx, forUser, one)
	return one[0], nil
}

func (s *Service) getMessage(ctx context.Context, chatID uuid.UUID, msgID int64) (Message, error) {
	m, err := s.repo.GetMessage(ctx, chatID, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrMessageNotFound
		}
		return Message{}, err
	}
	return *m, nil
}

func (s *Service) broadcast(ctx context.Context, chatID uuid.UUID, typ string, payload any) {
	if s.hub == nil {
		return
	}
	ids, err := s.repo.ParticipantIDs(ctx, chatID)
	if err != nil || len(ids) == 0 {
		return
	}
	s.hub.PublishJSON(ids, typ, chatID.String(), payload)
}

func (s *Service) notifyOffline(ctx context.Context, chatID, senderID uuid.UUID, msg Message) {
	if s.push == nil {
		return
	}
	ids, err := s.repo.ParticipantIDs(ctx, chatID)
	if err != nil {
		return
	}
	// The body does not come from here.
	//
	// This used to send msg.Content, under a comment claiming the content was
	// already decrypted. It is not: the server decrypts the at-rest layer and
	// never the end-to-end one, so what reached the phone was the `soc1.`
	// envelope, displayed verbatim.
	//
	// It cannot be fixed by decrypting — the server has no key, and the point
	// is that it never does. So an encrypted message is sent as data only, and
	// the device builds the notification once it has decrypted the text.
	encrypted := isEncryptedEnvelope(msg.Content)
	body := msg.Content
	if len(body) > 120 {
		body = body[:117] + "…"
	}
	if body == "" || encrypted {
		body = ""
	}
	title := msg.SenderName
	if title == "" {
		title = "Socialize"
	}
	category := "messages"
	// Groups use same chats table; treat multi-party as groups category.
	if len(ids) > 2 {
		category = "groups"
	}
	data := map[string]string{
		"type":       "message.new",
		"chat_id":    chatID.String(),
		"message_id": fmt.Sprintf("%d", msg.ID),
		// Everything the device needs to render the notification itself: the
		// ciphertext to decrypt, and who it is from. A notification saying only
		// "new message" is barely better than showing the envelope.
		// Guarded: SenderID is a pointer now, and calling String() on a nil one
		// compiles and panics. A push for an unattributed message is unlikely —
		// the sender just sent it — but "unlikely" is how a nil dereference gets
		// into a release.
		"sender_id":     uuidStr(msg.SenderID),
		"sender_name":   msg.SenderName,
		"sender_avatar": msg.SenderAvatar,
		// Only a structurally valid envelope is safe to forward to a device.
		// Invalid or historical rows must never become notification plaintext.
		"content": func() string {
			if encrypted {
				return msg.Content
			}
			return ""
		}(),
		"encrypted": boolStr(encrypted),
	}
	for _, uid := range ids {
		if uid == senderID {
			continue
		}
		// Sent even to someone holding a websocket.
		//
		// Being connected means the app is running, not that this conversation
		// is on screen — someone reading a different thread misses the message
		// that matters. The client decides whether to show it, because only the
		// client knows which chat is open.
		_ = uid
		// Respect a per-user mute on this chat.
		if muted, err := s.repo.IsMuted(ctx, chatID, uid); err == nil && muted {
			continue
		}
		_ = s.push.NotifyUser(ctx, uid, category, title, body, data)
	}
}

// VotePoll records the caller's selections on a poll message.
//
// A separate endpoint rather than an edit of the message: editing is the
// author's alone, so voting on someone else's poll was rejected outright —
// and the body is end-to-end encrypted, so the server could not have merged
// a tally into it even for the author.
func (s *Service) VotePoll(ctx context.Context, chatID, userID uuid.UUID, msgID int64, optionIDs []string) (*PollTally, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return nil, err
	}
	ids, err := s.repo.MessageIDsInChat(ctx, chatID, []int64{msgID})
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, ErrMessageNotFound
	}
	if err := s.repo.SetPollVotes(ctx, msgID, userID, optionIDs); err != nil {
		return nil, err
	}
	tallies, err := s.repo.PollTallies(ctx, []int64{msgID}, userID)
	if err != nil {
		return nil, err
	}
	t := tallies[msgID]
	if t == nil {
		t = &PollTally{Counts: map[string]int{}, Mine: []string{}}
	}
	s.broadcast(ctx, chatID, "poll.voted", map[string]any{
		"message_id": msgID,
		"poll_votes": t,
	})
	return t, nil
}

// attachPollTallies fills PollVotes on every poll message in a page.
//
// Without it a reload showed zero votes on every poll: the counts live in
// their own table now, so nothing in the message body carries them.
func (s *Service) attachPollTallies(ctx context.Context, userID uuid.UUID, msgs []Message) {
	var ids []int64
	for i := range msgs {
		if msgs[i].MessageType == MsgPoll {
			ids = append(ids, msgs[i].ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	tallies, err := s.repo.PollTallies(ctx, ids, userID)
	if err != nil {
		return // tallies are cosmetic; never fail a history load over them
	}
	for i := range msgs {
		if t := tallies[msgs[i].ID]; t != nil {
			msgs[i].PollVotes = t
		}
	}
}

// ReportChat files a moderation report, optionally blocking the chat too.
//
// Blocking in the same call is deliberate: reporting someone and then still
// hearing from them is the worst outcome for the person doing it, and making
// it two separate taps means some people only manage the first.
func (s *Service) ReportChat(ctx context.Context, chatID, userID uuid.UUID, reason, note string, alsoBlock bool) error {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if reason == "" {
		return ErrInvalidReport
	}
	if err := s.repo.InsertReport(ctx, chatID, userID, reason, note); err != nil {
		return err
	}
	if alsoBlock {
		// A block belongs to a person now, not to the conversation, so
		// reporting a group and blocking cannot mean "block the group". It
		// blocks the peer of a one-to-one chat and does nothing otherwise —
		// the report still stands, which is the part that matters.
		if s.blocks == nil {
			return nil
		}
		peer, err := s.repo.PeerUser(ctx, chatID, userID)
		if err != nil || peer == nil {
			return nil
		}
		return s.blocks.Block(ctx, userID, peer.ID)
	}
	return nil
}

// isEncryptedEnvelope reports whether the content is an E2EE payload the
// server cannot read. Both prefixes: pairwise messages and group ones.
func isEncryptedEnvelope(content string) bool {
	return validateEnvelope(content)
}

// uuidStr renders an optional id, empty when there is nobody to name.
func uuidStr(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// fillPresence adds the peer's online state and last seen to direct chats,
// as far as this viewer is allowed to know it.
//
// Done here rather than in SQL because two of the three gates are the
// *viewer's* own settings, not the subject's: someone who froze their last
// seen, or went ghost, stops seeing everyone else's, and premium buys the
// exception. A join could express the subject's visibility; it could not
// express a bargain.
//
// Online comes from the hub — it is the only thing that knows who is holding
// a socket right now — and last seen from the row, which is what survives a
// restart.
func (s *Service) fillPresence(ctx context.Context, viewerID uuid.UUID, chats []Chat) {
	if s.users == nil {
		return
	}
	viewer, err := s.users.ByID(ctx, viewerID)
	if err != nil {
		return
	}
	// One early exit for the reciprocity case: a viewer who cannot see any
	// presence should not cost a query per chat to be told so.
	if (viewer.LastSeenFrozen || viewer.GhostMode) && !viewer.IsPremium {
		return
	}

	for i := range chats {
		peer := chats[i].PeerUserID
		if peer == nil {
			continue
		}
		subject, err := s.users.ByID(ctx, *peer)
		if err != nil {
			continue
		}
		// Sharing a chat is the closest thing this app has to being a
		// contact, and this list is made of chats they share.
		if !users.CanSeePresence(viewer, subject, true) {
			continue
		}
		online := false
		if s.hub != nil {
			online = s.hub.Online(*peer)
		}
		// A frozen last seen must not be contradicted by a live dot. They
		// asked to appear at one moment; being shown as here now is the
		// opposite of that.
		if subject.LastSeenFrozen {
			online = false
		}
		chats[i].PeerOnline = &online
		chats[i].PeerLastSeen = subject.LastSeenAt
	}
}
