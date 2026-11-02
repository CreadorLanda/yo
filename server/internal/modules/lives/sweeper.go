package lives

import (
	"context"
	"time"
)

// Sweeper closes broadcasts nobody can still be in.
//
// Start/Stop rather than Run(ctx), to match the media, message and call
// sweepers: one shape for background workers is one thing to remember.
type Sweeper struct {
	repo   *Repo
	every  time.Duration
	maxAge time.Duration
	cancel context.CancelFunc
}

func NewSweeper(repo *Repo, every, maxAge time.Duration) *Sweeper {
	if every <= 0 {
		every = 10 * time.Minute
	}
	if maxAge <= 0 {
		// Longer than a call's four hours: a call is a conversation and a
		// broadcast can legitimately be an event.
		maxAge = 6 * time.Hour
	}
	return &Sweeper{repo: repo, every: every, maxAge: maxAge}
}

func (s *Sweeper) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go func() {
		// One pass at boot: a restart mid-broadcast would otherwise leave it
		// live until the first tick.
		s.sweep(ctx)
		liveTicker := time.NewTicker(s.every)
		viewerTicker := time.NewTicker(15 * time.Second)
		defer liveTicker.Stop()
		defer viewerTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-liveTicker.C:
				s.sweepLive(ctx)
			case <-viewerTicker.C:
				s.sweepViewers(ctx)
			}
		}
	}()
}

func (s *Sweeper) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

func (s *Sweeper) sweep(ctx context.Context) {
	s.sweepLive(ctx)
	s.sweepViewers(ctx)
}

func (s *Sweeper) sweepLive(ctx context.Context) {
	if s.repo == nil {
		return
	}
	_, _ = s.repo.SweepStale(ctx, s.maxAge)
}

func (s *Sweeper) sweepViewers(ctx context.Context) {
	if s.repo == nil {
		return
	}
	_, _ = s.repo.SweepStaleViewers(ctx, 45*time.Second)
}
