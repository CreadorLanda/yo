package bots

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Sweeper drops bot updates no bot collected within UpdateRetention.
type Sweeper struct {
	svc   *Service
	every time.Duration
	stop  chan struct{}
	once  sync.Once
	wg    sync.WaitGroup
}

func NewSweeper(svc *Service, every time.Duration) *Sweeper {
	return &Sweeper{svc: svc, every: every, stop: make(chan struct{})}
}

func (s *Sweeper) Start() {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		t := time.NewTicker(s.every)
		defer t.Stop()
		for {
			select {
			case <-s.stop:
				return
			case <-t.C:
				ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
				if n, err := s.svc.PurgeExpiredUpdates(ctx); err != nil {
					log.Warn().Err(err).Msg("bot update sweep failed")
				} else if n > 0 {
					log.Info().Int64("purged", n).Msg("expired bot updates purged")
				}
				cancel()
			}
		}
	}()
}

// Stop is safe to call more than once.
func (s *Sweeper) Stop() {
	s.once.Do(func() { close(s.stop) })
	s.wg.Wait()
}
