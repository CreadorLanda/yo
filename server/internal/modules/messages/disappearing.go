package messages

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// Disappearing messages, timed from the moment they are read.
//
// The alternative — starting the clock at send — punishes the recipient for
// being asleep: the message can expire before it was ever seen, which is not
// privacy, it is loss. Timed from read, the window means the same thing for
// both people.

var ErrInvalidTTL = errors.New("invalid_disappear_seconds")

// TTLOptions are the durations the client offers. Anything outside is
// rejected rather than clamped: unlike a story's lifetime, a wrong value
// here silently destroys someone's messages sooner than they agreed to.
var TTLOptions = []int{0, 3600, 86400, 604800, 2592000} // off, 1h, 24h, 7d, 30d

func validTTL(sec int) bool {
	return slices.Contains(TTLOptions, sec)
}

// ── repository ──────────────────────────────────────────────────────────────

func (r *Repository) SetDisappearing(ctx context.Context, chatID uuid.UUID, seconds int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE chats SET disappear_seconds = $2 WHERE id = $1`, chatID, seconds)
	return err
}

func (r *Repository) DisappearSeconds(ctx context.Context, chatID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT disappear_seconds FROM chats WHERE id = $1`, chatID).Scan(&n)
	return n, err
}

// StartExpiryClock stamps a deadline on messages being read for the first
// time.
//
// `expires_at IS NULL` is what makes it first-read-only: a later reader must
// not push the deadline out, or in a group the last person to open the chat
// would decide how long everyone else keeps it.
//
// The sender's own messages are included: a disappearing conversation that
// survives in full on one side is not a disappearing conversation.
func (r *Repository) StartExpiryClock(ctx context.Context, ids []int64, seconds int) error {
	if len(ids) == 0 || seconds <= 0 {
		return nil
	}
	_, err := r.db.Exec(ctx, `
		UPDATE messages
		   SET expires_at = NOW() + ($2 || ' seconds')::interval
		 WHERE id = ANY($1) AND expires_at IS NULL
	`, ids, seconds)
	return err
}

// SweepExpired removes messages whose deadline has passed.
//
// A hard delete, not a soft flag: a message that is "expired" but still in
// the table is exactly what the person was promised would not happen.
func (r *Repository) SweepExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ── service ─────────────────────────────────────────────────────────────────

// SetDisappearing changes the timer for a chat. Any participant may: this is
// a property of the conversation, and both people live with it.
func (s *Service) SetDisappearing(ctx context.Context, chatID, userID uuid.UUID, seconds int) error {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if !validTTL(seconds) {
		return ErrInvalidTTL
	}
	previous, err := s.repo.DisappearSeconds(ctx, chatID)
	if err == nil && previous == seconds {
		// Nothing changed. Writing a notice anyway would fill the thread
		// with announcements of non-events.
		return nil
	}
	if err := s.repo.SetDisappearing(ctx, chatID, seconds); err != nil {
		return err
	}

	// A notice in the conversation, not only a row in a settings screen.
	//
	// This changes what happens to everything written afterwards, and the
	// other person did not ask for it — they find out here or they do not
	// find out at all. It is stored as a message so it sits in the history
	// at the moment it took effect, which is the only place it means
	// anything.
	//
	// The body is machine-readable rather than a sentence, because the
	// client has to render it in the reader's language and name the actor
	// from their own contact list.
	notice := fmt.Sprintf("disappearing:%d:%s", seconds, userID.String())
	if id, err := s.repo.InsertMessage(ctx, chatID, userID, notice, MsgSystem, nil, nil, Origin{}, nil); err == nil {
		if msg, err := s.getMessage(ctx, chatID, id); err == nil {
			s.broadcast(ctx, chatID, "message.new", msg)
		}
	}

	// Everyone in the chat needs to know, or one side keeps composing under
	// rules that no longer apply.
	s.broadcast(ctx, chatID, "chat.disappearing", map[string]any{
		"chat_id":           chatID.String(),
		"disappear_seconds": seconds,
		"changed_by":        userID.String(),
	})
	return nil
}

// SweepExpired is the periodic cleanup. Returns how many rows went.
func (s *Service) SweepExpired(ctx context.Context) (int64, error) {
	return s.repo.SweepExpired(ctx)
}

// ── sweeper ─────────────────────────────────────────────────────────────────

// Sweeper deletes read-and-expired messages on a timer.
//
// Deleting exactly on expiry would need every client online at the right
// moment; a sweep needs nothing of anyone. The interval only decides how long
// a message outlives its deadline in the database — it is already hidden from
// every read before then.
//
// Start/Stop rather than a Run(ctx), to match the media sweeper: one shape
// for background workers is one thing to remember.
type Sweeper struct {
	svc    *Service
	every  time.Duration
	cancel context.CancelFunc
}

func NewSweeper(svc *Service, every time.Duration) *Sweeper {
	if every <= 0 {
		every = 5 * time.Minute
	}
	return &Sweeper{svc: svc, every: every}
}

func (s *Sweeper) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go func() {
		// One pass at boot clears whatever came due while the server was down.
		s.sweep(ctx)
		t := time.NewTicker(s.every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.sweep(ctx)
			}
		}
	}()
	log.Info().Dur("interval", s.every).Msg("disappearing message sweeper started")
}

func (s *Sweeper) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

func (s *Sweeper) sweep(ctx context.Context) {
	n, err := s.svc.SweepExpired(ctx)
	if err != nil {
		log.Error().Err(err).Msg("disappearing sweep failed")
		return
	}
	if n > 0 {
		log.Info().Int64("removed", n).Msg("disappearing messages swept")
	}
}
