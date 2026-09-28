package media

import (
	"context"
	"os"
	"time"

	"github.com/rs/zerolog/log"
)

// Sweeper deletes media bytes once they are no longer needed.
//
// The server is a relay, not a store: a blob lives until every expected
// recipient has fetched it, or until its deadline passes — whichever comes
// first. Only media belonging to a user with server backup enabled is kept
// (keep_forever), and even then it is their own copy, never someone else's.
//
// The database row survives as a tombstone so a message whose media has
// gone can say so instead of failing to load.
type Sweeper struct {
	repo    *Repository
	rootDir string
	every   time.Duration
	batch   int
	cancel  context.CancelFunc
}

// DefaultMediaTTL is how long a blob may sit on the server untouched.
const DefaultMediaTTL = 30 * 24 * time.Hour

func NewSweeper(repo *Repository, rootDir string, every time.Duration) *Sweeper {
	if every <= 0 {
		every = time.Hour
	}
	return &Sweeper{repo: repo, rootDir: rootDir, every: every, batch: 200}
}

func (s *Sweeper) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go func() {
		// One pass at boot clears anything that came due while down.
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
	log.Info().Dur("interval", s.every).Msg("media sweeper started")
}

func (s *Sweeper) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

func (s *Sweeper) sweep(ctx context.Context) {
	due, err := s.repo.DuePurge(ctx, s.batch)
	if err != nil {
		log.Error().Err(err).Msg("media sweep: list due")
		return
	}
	if len(due) == 0 {
		return
	}

	var purged int
	for _, c := range due {
		abs, ok := mediaPath(s.rootDir, c.StoragePath)
		// Refuse to touch anything outside the media root.
		if !ok {
			log.Warn().Str("path", c.StoragePath).Msg("media sweep: path escapes root, skipping")
			continue
		}
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Error().Err(err).Str("id", c.ID.String()).Msg("media sweep: remove file")
			continue
		}
		// Mark purged even when the file was already gone — otherwise the
		// row keeps coming back on every pass.
		if err := s.repo.MarkPurged(ctx, c.ID); err != nil {
			log.Error().Err(err).Str("id", c.ID.String()).Msg("media sweep: mark purged")
			continue
		}
		purged++
	}
	if purged > 0 {
		log.Info().Int("purged", purged).Msg("media sweep")
	}
}
