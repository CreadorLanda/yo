// Command api is the entry point for the ZwoSocial backend.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"

	"github.com/CreadorLanda/zwosocial/server/internal/config"
	"github.com/CreadorLanda/zwosocial/server/internal/server"
)

func main() {
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config")
	}

	srv, err := server.New(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("server init")
	}

	srv.ListenAndServe()
	log.Info().Str("addr", cfg.HTTP.Addr).Msg("listening (public)")

	// Graceful shutdown on SIGINT / SIGTERM.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-stop:
		log.Info().Msg("shutdown (signal)")
	case err := <-srv.Err():
		if err != nil {
			log.Error().Err(err).Msg("listener error")
		}
	}

	srv.Close()
	log.Info().Msg("goodbye")
	// Give the platform connections a moment to flush.
	_, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
}
