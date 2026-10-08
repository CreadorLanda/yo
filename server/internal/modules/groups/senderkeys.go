package groups

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
)

// Group end-to-end encryption, by sender keys.
//
// Each member holds one symmetric key per group and encrypts every message
// with it once, rather than once per recipient. The key itself is sealed to
// each other member with the pairwise X3DH session that direct chats already
// use, and this module moves those sealed blobs around.
//
// Everything here is opaque to the server on purpose: it stores a string it
// cannot open, addressed to a user it does not decrypt for. The only thing
// it decides is who is allowed to read which row.

var ErrEmptyDistribute = errors.New("no_entries")

// SenderKeyEntry is one member's copy of one sender key.
type SenderKeyEntry struct {
	// UserID is the recipient on upload, and the sender on download —
	// whichever end the caller is not.
	UserID     uuid.UUID `json:"user_id"`
	Ciphertext string    `json:"ciphertext"`
	Epoch      int       `json:"epoch"`
	CreatedAt  time.Time `json:"created_at,omitempty"`
}

type DistributeRequest struct {
	Epoch int `json:"epoch" binding:"required,min=1"`
	// One entry per other member. A member missing from this list simply
	// cannot read what the sender writes — the server does not check the
	// list is complete, because it cannot know which members the sender has
	// a working session with.
	Entries []SenderKeyUpload `json:"entries" binding:"required,min=1,max=512"`
}

// SenderKeyUpload is one sealed copy, addressed to one member.
type SenderKeyUpload struct {
	UserID     uuid.UUID `json:"user_id" binding:"required"`
	Ciphertext string    `json:"ciphertext" binding:"required,max=4096"`
}

// ── repository ──────────────────────────────────────────────────────────────

// KeyEpoch is the group's current key generation.
func (r *Repository) KeyEpoch(ctx context.Context, chatID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT key_epoch FROM chats WHERE id = $1`, chatID).Scan(&n)
	return n, err
}

// BumpKeyEpoch retires every sender key currently in use.
//
// Called when the membership changes. Without it, someone removed from a
// group would keep reading it: they already hold every member's current
// sender key, and nothing about their removal would change those keys.
func (r *Repository) BumpKeyEpoch(ctx context.Context, chatID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE chats SET key_epoch = key_epoch + 1 WHERE id = $1`, chatID)
	return err
}

func (r *Repository) SaveSenderKeys(ctx context.Context, chatID, sender uuid.UUID, epoch int, entries []SenderKeyEntry) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, e := range entries {
		// Idempotent: a client that redistributes after a dropped response
		// must not fail, and re-sealing the same key is harmless.
		if _, err := tx.Exec(ctx, `
			INSERT INTO group_sender_keys (chat_id, sender_id, recipient_id, epoch, ciphertext)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (chat_id, sender_id, recipient_id, epoch)
			DO UPDATE SET ciphertext = excluded.ciphertext, created_at = NOW()
		`, chatID, sender, e.UserID, epoch, e.Ciphertext); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// SenderKeysFor returns every sender key addressed to one member.
//
// All epochs, not just the current one: a rotation must not make yesterday's
// messages unreadable, and the client needs the older keys to open history it
// has not decrypted yet.
func (r *Repository) SenderKeysFor(ctx context.Context, chatID, recipient uuid.UUID) ([]SenderKeyEntry, error) {
	rows, err := r.db.Query(ctx, `
		SELECT sender_id, epoch, ciphertext, created_at
		FROM group_sender_keys
		WHERE chat_id = $1 AND recipient_id = $2
		ORDER BY epoch, created_at
	`, chatID, recipient)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SenderKeyEntry{}
	for rows.Next() {
		var e SenderKeyEntry
		if err := rows.Scan(&e.UserID, &e.Epoch, &e.Ciphertext, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── service ─────────────────────────────────────────────────────────────────

// DistributeSenderKey publishes the caller's sealed sender key to the members
// it was sealed for.
func (s *Service) DistributeSenderKey(ctx context.Context, chatID, sender uuid.UUID, req DistributeRequest) error {
	if err := s.requireMember(ctx, chatID, sender); err != nil {
		return err
	}
	if len(req.Entries) == 0 {
		return ErrEmptyDistribute
	}

	// Members only. Sealing a key to a non-member would be pointless — they
	// have no pairwise session obligation here — but accepting the row would
	// let anyone use the group as a mailbox to arbitrary users.
	members, err := s.repo.ListMembers(ctx, chatID)
	if err != nil {
		return err
	}
	allowed := make(map[uuid.UUID]bool, len(members))
	for _, m := range members {
		allowed[m.UserID] = true
	}

	entries := make([]SenderKeyEntry, 0, len(req.Entries))
	for _, e := range req.Entries {
		if !allowed[e.UserID] || e.UserID == sender {
			continue
		}
		entries = append(entries, SenderKeyEntry{UserID: e.UserID, Ciphertext: e.Ciphertext})
	}
	if len(entries) == 0 {
		return ErrEmptyDistribute
	}

	// No push to the other members: a recipient fetches keys when it meets a
	// message it cannot open, and before it sends its own. Announcing here
	// would mean wiring the realtime hub into this module for a signal that
	// only ever arrives just before the message that implies it.
	return s.repo.SaveSenderKeys(ctx, chatID, sender, req.Epoch, entries)
}

// MySenderKeys returns the keys other members sealed for the caller.
func (s *Service) MySenderKeys(ctx context.Context, chatID, me uuid.UUID) ([]SenderKeyEntry, int, error) {
	if err := s.requireMember(ctx, chatID, me); err != nil {
		return nil, 0, err
	}
	epoch, err := s.repo.KeyEpoch(ctx, chatID)
	if err != nil {
		return nil, 0, err
	}
	list, err := s.repo.SenderKeysFor(ctx, chatID, me)
	if err != nil {
		return nil, 0, err
	}
	return list, epoch, nil
}

// ── controller ──────────────────────────────────────────────────────────────

// PostSenderKeys — POST /groups/:id/sender-keys
func (c *Controller) PostSenderKeys(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	var req DistributeRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}
	if err := c.svc.DistributeSenderKey(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx), req); err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.Status(http.StatusNoContent)
}

// GetSenderKeys — GET /groups/:id/sender-keys
func (c *Controller) GetSenderKeys(ctx *gin.Context) {
	chatID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	list, epoch, err := c.svc.MySenderKeys(ctx.Request.Context(), chatID, middleware.UserIDFrom(ctx))
	if err != nil {
		writeErr(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"epoch": epoch, "keys": list})
}
