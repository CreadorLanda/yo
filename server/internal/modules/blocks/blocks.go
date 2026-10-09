// Package blocks records one person's decision to stop hearing from another.
//
// The block used to live on the conversation — `chats.status = 'blocked'`, set
// with no user_id — which made it symmetric and permanent: blocking someone
// also stopped you writing to them, and no unblock existed anywhere in the
// codebase. It also reached only the message send path, so someone you blocked
// could still ring you.
//
// What a block does, and deliberately does not do:
//
//	one-to-one messages   stopped
//	one-to-one calls      stopped — the phone does not ring
//	groups                unaffected. You can share a room with someone you
//	                      blocked; the app tells you they are there.
//	lives                 unaffected, for the same reason.
//
// The narrower rule is the honest one. A block is "I do not want this person
// reaching me directly", not "this person may not exist near me" — and a group
// is a place with other people in it, whose conversation is not yours to end.
package blocks

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

var (
	// ErrSelf — blocking yourself is not a state worth reasoning about.
	ErrSelf = errors.New("cannot_block_self")
	// ErrNoUser — nobody by that id.
	ErrNoUser = errors.New("user_not_found")
)

// Directory is the one thing this module asks of the rest of the app: does
// this person exist, and what is the other side of this chat.
type Directory interface {
	Exists(ctx context.Context, userID uuid.UUID) (bool, error)
	// PeerOf returns the other participant of a direct chat. Used by the
	// chat-shaped endpoint the app already calls.
	PeerOf(ctx context.Context, chatID, userID uuid.UUID) (uuid.UUID, error)
}

type Service struct {
	repo *Repo
	dir  Directory
}

func NewService(repo *Repo, dir Directory) *Service {
	return &Service{repo: repo, dir: dir}
}

// Block records that `blocker` no longer wants `blocked` reaching them.
//
// Idempotent: pressing block twice is one block, and the second press must not
// be an error the app has to explain.
func (s *Service) Block(ctx context.Context, blocker, blocked uuid.UUID) error {
	if blocker == blocked {
		return ErrSelf
	}
	if ok, err := s.dir.Exists(ctx, blocked); err != nil || !ok {
		return ErrNoUser
	}
	return s.repo.Block(ctx, blocker, blocked)
}

// Unblock lifts your own half. It cannot lift theirs — a block is one
// person's, and mutual blocks are two decisions, not one.
func (s *Service) Unblock(ctx context.Context, blocker, blocked uuid.UUID) error {
	return s.repo.Unblock(ctx, blocker, blocked)
}

// BlockChatPeer is the chat-shaped door onto the same thing.
//
// The app already calls POST /chats/:id/block, and an installed build cannot
// be asked to change. It resolves the peer and blocks the person.
func (s *Service) BlockChatPeer(ctx context.Context, chatID, blocker uuid.UUID) error {
	peer, err := s.dir.PeerOf(ctx, chatID, blocker)
	if err != nil {
		return ErrNoUser
	}
	return s.Block(ctx, blocker, peer)
}

// List is everyone this user has blocked.
//
// The client uses it to mark members of a shared group, so the whole list has
// to come down rather than being asked one id at a time — a group screen would
// otherwise make one request per member.
func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Blocked, error) {
	return s.repo.List(ctx, userID)
}

// ── controller ──────────────────────────────────────────────────────────────

type Controller struct{ svc *Service }

func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

type blockRequest struct {
	UserID uuid.UUID `json:"user_id" binding:"required"`
}

// PostBlock — POST /blocks
func (c *Controller) PostBlock(ctx *gin.Context) {
	var req blockRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	switch err := c.svc.Block(ctx.Request.Context(), middleware.UserIDFrom(ctx), req.UserID); {
	case errors.Is(err, ErrSelf):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": ErrSelf.Error()})
	case errors.Is(err, ErrNoUser):
		ctx.JSON(http.StatusNotFound, gin.H{"error": ErrNoUser.Error()})
	case err != nil:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	default:
		ctx.Status(http.StatusNoContent)
	}
}

// DeleteBlock — DELETE /blocks/:id
//
// The unblock that did not exist. Blocking by mistake used to be permanent.
func (c *Controller) DeleteBlock(ctx *gin.Context) {
	blocked, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	// Idempotent: unblocking someone who is not blocked is the state you asked
	// for, not an error.
	if err := c.svc.Unblock(ctx.Request.Context(), middleware.UserIDFrom(ctx), blocked); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	ctx.Status(http.StatusNoContent)
}

// GetBlocks — GET /blocks
func (c *Controller) GetBlocks(ctx *gin.Context) {
	list, err := c.svc.List(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	ctx.JSON(http.StatusOK, list)
}

// PostBlockChat — POST /chats/:id/block
//
// Kept because installed builds call it. It resolves the peer and blocks the
// person, so old and new clients write the same thing.
func (c *Controller) PostBlockChat(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_chat_id"})
		return
	}
	switch err := c.svc.BlockChatPeer(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx)); {
	case errors.Is(err, ErrNoUser):
		// A group has no single peer, and a chat you are not in is not yours
		// to act on. Both read as "no such thing here".
		ctx.JSON(http.StatusNotFound, gin.H{"error": "chat_not_found"})
	case errors.Is(err, ErrSelf):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": ErrSelf.Error()})
	case err != nil:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	default:
		ctx.Status(http.StatusNoContent)
	}
}

// Register mounts the block routes on a JWT-protected group.
func Register(rg *gin.RouterGroup, c *Controller) {
	rg.POST("/blocks", c.PostBlock)
	rg.GET("/blocks", c.GetBlocks)
	rg.DELETE("/blocks/:id", c.DeleteBlock)
	rg.POST("/chats/:id/block", c.PostBlockChat)
}
