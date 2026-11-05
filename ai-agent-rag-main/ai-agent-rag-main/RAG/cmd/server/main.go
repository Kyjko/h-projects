package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Deloitte-CE-IT/AI/RAG/internal/api"
	"github.com/Deloitte-CE-IT/AI/RAG/internal/config"
	"github.com/Deloitte-CE-IT/AI/RAG/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}

	ctx := context.Background()
	repository, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("initialize knowledge store: %v", err)
	}
	defer repository.Close()

	handler := api.NewHandler(cfg, repository)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("RAG API listening on port %s (retrieval_mode=%s)", cfg.Port, cfg.RetrievalMode)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve HTTP: %v", err)
		}
	}()

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, syscall.SIGINT, syscall.SIGTERM)
	<-shutdownSignal

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
