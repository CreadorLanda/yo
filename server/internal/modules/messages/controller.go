package messages

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/yo/server/internal/middleware"
	"github.com/CreadorLanda/yo/server/internal/modules/users"
	"github.com/CreadorLanda/yo/server/internal/platform/realtime"
	"github.com/CreadorLanda/yo/server/internal/platform/tokens"
)

type Controller struct {
	svc    *Service
	hub    *realtime.Hub
	secret []byte
}

func NewController(svc *Service, hub *realtime.Hub, jwtSecret []byte) *Controller {
	return &Controller{svc: svc, hub: hub, secret: jwtSecret}
}

// PostChat — POST /chats
func (c *Controller) PostChat(ctx *gin.Context) {
	var req CreateChatRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	chat, err := c.svc.CreateDirectChat(ctx.Request.Context(), middleware.UserIDFrom(ctx), req.PeerUserID)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, CreateChatResponse{ChatID: chat.ID, Chat: chat})
}

// GetChats — GET /chats?limit=&offset=&archived=
func (c *Controller) GetChats(ctx *gin.Context) {
	limit, _ := strconv.Atoi(ctx.Query("limit"))
	offset, _ := strconv.Atoi(ctx.Query("offset"))
	opts := ListChatsOptions{
		Limit:    limit,
		Offset:   offset,
		Archived: ctx.Query("archived") == "true",
	}
	chats, err := c.svc.ListChats(ctx.Request.Context(), middleware.UserIDFrom(ctx), opts)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if chats == nil {
		chats = []Chat{}
	}
	ctx.JSON(http.StatusOK, chats)
}

// PostMessage — POST /chats/:id/messages
func (c *Controller) PostMessage(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req SendMessageRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	msg, err := c.svc.SendMessage(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, msg)
}

// PatchMessage — PATCH /chats/:id/messages/:mid
func (c *Controller) PatchMessage(ctx *gin.Context) {
	chatID, msgID, ok := parseChatMsg(ctx)
	if !ok {
		return
	}
	var req EditMessageRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	msg, err := c.svc.EditMessage(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), msgID, req.Content)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, msg)
}

// DeleteMessage — DELETE /chats/:id/messages/:mid
func (c *Controller) DeleteMessage(ctx *gin.Context) {
	chatID, msgID, ok := parseChatMsg(ctx)
	if !ok {
		return
	}
	msg, err := c.svc.DeleteMessage(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), msgID)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, msg)
}

// PostReceipts — POST /chats/:id/receipts
func (c *Controller) PostReceipts(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req ReceiptRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	if err := c.svc.SetReceipts(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// PostRead — POST /chats/:id/read
func (c *Controller) PostRead(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req MarkReadRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	if err := c.svc.MarkRead(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req.MessageID); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// PostTyping — POST /chats/:id/typing
func (c *Controller) PostTyping(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req TypingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	if err := c.svc.Typing(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req.Typing, req.Kind); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// PostReact — POST /chats/:id/messages/:mid/reactions
func (c *Controller) PostReact(ctx *gin.Context) {
	chatID, msgID, ok := parseChatMsg(ctx)
	if !ok {
		return
	}
	var req ReactRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	list, err := c.svc.React(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), msgID, req.Emoji, false)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// DeleteReact — DELETE /chats/:id/messages/:mid/reactions?emoji=…
func (c *Controller) DeleteReact(ctx *gin.Context) {
	chatID, msgID, ok := parseChatMsg(ctx)
	if !ok {
		return
	}
	emoji := ctx.Query("emoji")
	if emoji == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "missing_emoji"})
		return
	}
	list, err := c.svc.React(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), msgID, emoji, true)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// PostMessageOpen — POST /chats/:id/messages/:mid/open
//
// Consumes one view of a limited-view message. Separate from listing so
// scrolling past a message never burns a view.
func (c *Controller) PostMessageOpen(ctx *gin.Context) {
	chatID, msgID, ok := parseChatMsg(ctx)
	if !ok {
		return
	}
	limit, left, err := c.svc.OpenLimitedMessage(ctx.Request.Context(), chatID, msgID, middleware.UserIDFrom(ctx))
	if err != nil {
		if errors.Is(err, ErrViewsExhausted) {
			ctx.JSON(http.StatusGone, gin.H{
				"error":      ErrViewsExhausted.Error(),
				"view_limit": limit,
				"views_left": 0,
			})
			return
		}
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"view_limit": limit, "views_left": left})
}

// GetMessageInfo — GET /chats/:id/messages/:mid/info
func (c *Controller) GetMessageInfo(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	mid, err := strconv.ParseInt(ctx.Param("mid"), 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_message_id"})
		return
	}
	list, err := c.svc.MessageInfo(ctx.Request.Context(), chatID, mid, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if list == nil {
		list = []ReceiptDetail{}
	}
	ctx.JSON(http.StatusOK, list)
}

// PatchChatSettings — PATCH /chats/:id/settings
func (c *Controller) PatchChatSettings(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req ChatSettingsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	chat, err := c.svc.UpdateChatSettings(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, chat)
}

// PostClearChat — POST /chats/:id/clear
func (c *Controller) PostClearChat(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	if err := c.svc.ClearChatHistory(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// DeleteChat — DELETE /chats/:id
func (c *Controller) DeleteChat(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	if err := c.svc.DeleteChat(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx)); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// PostAcceptChat — POST /chats/:id/accept
func (c *Controller) PostAcceptChat(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	chat, err := c.svc.AcceptChat(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, chat)
}

// GetMessages — GET /chats/:id/messages?limit=50&before=<id>
func (c *Controller) GetMessages(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	limit := 50
	before := int64(0)
	if l := ctx.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if b := ctx.Query("before"); b != "" {
		if parsed, err := strconv.ParseInt(b, 10, 64); err == nil {
			before = parsed
		}
	}
	msgs, err := c.svc.ListMessages(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), limit, before)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	if msgs == nil {
		msgs = []Message{}
	}
	ctx.JSON(http.StatusOK, msgs)
}

// GetWS — GET /ws (token via Authorization or the WebSocket subprotocol).
// Upgrades to WebSocket. Auth middleware is not used so we parse the token
// ourselves. Query-string tokens are deliberately rejected: URLs routinely
// reach proxy, access and browser history logs.
func (c *Controller) GetWS(ctx *gin.Context) {
	if c.hub == nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime_unavailable"})
		return
	}
	raw := ""
	h := ctx.GetHeader("Authorization")
	if len(h) > 7 && (h[:7] == "Bearer " || h[:7] == "bearer ") {
		raw = h[7:]
	}
	if raw == "" {
		for _, protocol := range strings.Split(ctx.GetHeader("Sec-WebSocket-Protocol"), ",") {
			protocol = strings.TrimSpace(protocol)
			if strings.HasPrefix(protocol, "yo-bearer.") {
				raw = strings.TrimPrefix(protocol, "yo-bearer.")
				break
			}
		}
	}
	if raw == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "missing_token"})
		return
	}
	claims, err := tokens.Parse(c.secret, raw)
	if err != nil || claims.Type != tokens.TypeAccess {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}
	c.hub.ServeWS(ctx.Writer, ctx.Request, claims.UserID)
}

func parseChatMsg(ctx *gin.Context) (uuid.UUID, int64, bool) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return uuid.Nil, 0, false
	}
	msgID, err := strconv.ParseInt(ctx.Param("mid"), 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_message_id"})
		return uuid.Nil, 0, false
	}
	return chatID, msgID, true
}

func writeErr(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrChatNotFound), errors.Is(err, users.ErrNotFound), errors.Is(err, ErrMessageNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotParticipant), errors.Is(err, ErrCannotAcceptOwn), errors.Is(err, ErrNotSender):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrChatBlocked):
		ctx.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrPendingChatLimit), errors.Is(err, ErrChatNotPending):
		ctx.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidReceipt), errors.Is(err, ErrInvalidReport),
		errors.Is(err, ErrInvalidTTL), errors.Is(err, ErrUnencryptedMessage),
		errors.Is(err, ErrInvalidMessageType), errors.Is(err, ErrInvalidEnvelopeChat),
		errors.Is(err, ErrInvalidMediaAttach):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
	}
}

type votePollRequest struct {
	OptionIDs []string `json:"option_ids"`
}

func (c *Controller) PostPollVote(ctx *gin.Context) {
	chatID, msgID, ok := parseChatMsg(ctx)
	if !ok {
		return
	}
	var req votePollRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	tally, err := c.svc.VotePoll(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), msgID, req.OptionIDs)
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, tally)
}

type reportChatRequest struct {
	Reason string `json:"reason"`
	Note   string `json:"note"`
	Block  bool   `json:"block"`
}

func (c *Controller) PostReportChat(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req reportChatRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	if err := c.svc.ReportChat(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx),
		req.Reason, req.Note, req.Block); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

type disappearingRequest struct {
	Seconds int `json:"disappear_seconds"`
}

func (c *Controller) PutDisappearing(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	var req disappearingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}
	if err := c.svc.SetDisappearing(ctx.Request.Context(), chatID,
		middleware.UserIDFrom(ctx), req.Seconds); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}
