package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Deloitte-CE-IT/AI/RAG/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {

	cfg1, err1 := config.Load()
	if err1 != nil {
		log.Fatalf("load configuration: %v", err1)
	}

	databaseURL := cfg1.DatabaseURL
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		log.Fatalf("parse database URL: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	defer pool.Close()

	// Read all chunks ordered by source_id and chunk_index
	rows, err := pool.Query(context.Background(), `
        SELECT c.id::text, c.source_id::text, c.chunk_index, c.content, c.metadata
        FROM rag.chunks c
        JOIN rag.sources s ON s.id = c.source_id
        ORDER BY c.source_id, c.chunk_index
    `)
	if err != nil {
		log.Fatalf("query chunks: %v", err)
	}
	defer rows.Close()

	type row struct {
		id       string
		sourceID string
		index    int
		content  string
		metadata []byte
	}

	// group by source
	groups := map[string][]row{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.sourceID, &r.index, &r.content, &r.metadata); err != nil {
			log.Fatalf("scan row: %v", err)
		}
		groups[r.sourceID] = append(groups[r.sourceID], r)
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("iterate rows: %v", err)
	}

	updated := 0
	embeddingURL := strings.TrimSpace(os.Getenv("EMBEDDING_API_URL"))
	client := &http.Client{Timeout: 20 * time.Second}
	for _, rs := range groups {
		// ensure sorted by index
		// compute contexts and tokens for each chunk
		for i := range rs {
			prev := ""
			next := ""
			if i > 0 {
				prev = firstN(rs[i-1].content, 200)
			}
			if i+1 < len(rs) {
				next = firstN(rs[i+1].content, 200)
			}
			tokens := estimateTokens(rs[i].content)

			var meta map[string]any
			if len(rs[i].metadata) == 0 {
				meta = map[string]any{}
			} else {
				if err := json.Unmarshal(rs[i].metadata, &meta); err != nil {
					meta = map[string]any{}
				}
			}
			meta["preceding_context"] = prev
			meta["following_context"] = next
			meta["tokens"] = tokens

			metaB, err := json.Marshal(meta)
			if err != nil {
				log.Fatalf("marshal metadata: %v", err)
			}
			if _, err := pool.Exec(context.Background(), `UPDATE rag.chunks SET metadata = $1 WHERE id = $2`, metaB, rs[i].id); err != nil {
				log.Fatalf("update chunk metadata: %v", err)
			}
			updated++

			// Optionally compute and store embeddings if EMBEDDING_API_URL is configured.
			if embeddingURL != "" {
				emb, err := fetchEmbedding(client, embeddingURL, rs[i].content)
				if err != nil {
					log.Printf("warn: fetch embedding for chunk %s failed: %v", rs[i].id, err)
					continue
				}
				// build vector literal string
				parts := make([]string, 0, len(emb))
				for _, f := range emb {
					parts = append(parts, fmt.Sprintf("%g", f))
				}
				vec := "[" + strings.Join(parts, ",") + "]"
				if _, err := pool.Exec(context.Background(), `UPDATE rag.chunks SET embedding = $1 WHERE id = $2`, vec, rs[i].id); err != nil {
					log.Printf("warn: update embedding for chunk %s failed: %v", rs[i].id, err)
				} else {
					log.Printf("updated embedding for chunk %s", rs[i].id)
				}
			}
		}
	}
	fmt.Printf("updated %d chunks\n", updated)
}

func fetchEmbedding(client *http.Client, url, text string) ([]float64, error) {
	payload := map[string]any{"input": text}
	b, _ := json.Marshal(payload)
	resp, err := client.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding API returned status %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Embedding []float64 `json:"embedding"`
	}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return out.Embedding, nil
}

func estimateTokens(s string) int {
	if strings.TrimSpace(s) == "" {
		return 0
	}
	return len(strings.Fields(s))
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// try to cut at rune boundary
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}
