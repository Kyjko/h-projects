package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool      *pgxpool.Pool
	hasVector bool
}

type Document struct {
	Namespace  string
	ExternalID string
	Title      string
	Metadata   map[string]any
	Chunks     []Chunk
}

type Chunk struct {
	Index            int
	Content          string
	PrecedingContext string
	FollowingContext string
	Tokens           int
	Section          string
	// Optional embedding vector (not marshalled into chunk metadata automatically)
	Embedding []float64
	// Optional per-chunk embedding score (if computed at ingest time)
	EmbeddingScore *float64
}

type SearchOptions struct {
	Query          string
	Namespace      string
	TopK           int
	ScoreThreshold *float64
	MetadataFilter map[string]any
	// Mode can be: "fts", "hybrid", "vector". If empty, defaults to fts.
	Mode string
}

type SearchResult struct {
	ChunkID    string         `json:"chunk_id"`
	SourceID   string         `json:"source_id"`
	Title      string         `json:"title"`
	Content    string         `json:"content"`
	Score      float64        `json:"score"`
	ChunkIndex int            `json:"chunk_index"`
	Metadata   map[string]any `json:"metadata"`
}

func New(ctx context.Context, databaseURL string) (*Repository, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	repository := &Repository{pool: pool}
	if err := repository.migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return repository, nil
}

func (r *Repository) Close() {
	r.pool.Close()
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

func (r *Repository) migrate(ctx context.Context) error {
	pre := []string{
		"CREATE SCHEMA IF NOT EXISTS rag",
		`CREATE TABLE IF NOT EXISTS rag.sources (
			id UUID PRIMARY KEY,
			namespace TEXT NOT NULL,
			external_id TEXT,
			title TEXT NOT NULL,
			metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (namespace, external_id)
		)`,
		`CREATE TABLE IF NOT EXISTS rag.chunks (
			id UUID PRIMARY KEY,
			source_id UUID NOT NULL REFERENCES rag.sources(id) ON DELETE CASCADE,
			chunk_index INTEGER NOT NULL,
			content TEXT NOT NULL,
			metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
			search_vector TSVECTOR GENERATED ALWAYS AS (
				to_tsvector('simple'::regconfig, content)
			) STORED,
			UNIQUE (source_id, chunk_index)
		)`,
		"DROP INDEX IF EXISTS rag.rag_chunks_embedding_hnsw_idx",
		"ALTER TABLE rag.chunks DROP COLUMN IF EXISTS embedding",
		`ALTER TABLE rag.sources
			ADD COLUMN IF NOT EXISTS search_vector TSVECTOR GENERATED ALWAYS AS (
				setweight(to_tsvector('simple'::regconfig, title), 'A') ||
				setweight(to_tsvector('simple'::regconfig, COALESCE(external_id, '')), 'A') ||
				setweight(to_tsvector('simple'::regconfig, COALESCE(metadata ->> 'filename', '')), 'A')
			) STORED`,
		`ALTER TABLE rag.chunks
			ADD COLUMN IF NOT EXISTS search_vector TSVECTOR GENERATED ALWAYS AS (
				to_tsvector('simple'::regconfig, content)
			) STORED`,
		`CREATE INDEX IF NOT EXISTS rag_sources_search_vector_gin_idx
			ON rag.sources USING GIN (search_vector)`,
		`CREATE INDEX IF NOT EXISTS rag_chunks_search_vector_gin_idx
			ON rag.chunks USING GIN (search_vector)`,
		"CREATE INDEX IF NOT EXISTS rag_sources_namespace_idx ON rag.sources (namespace)",
	}

	for _, statement := range pre {
		if _, err := r.pool.Exec(ctx, statement); err != nil {
			return fmt.Errorf("apply database migration: %w", err)
		}
	}

	// Try to enable pgvector. If it's not available on the server, skip
	// embedding-related schema changes rather than failing the entire migration.
	hasVector := false
	if _, err := r.pool.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector"); err == nil {
		hasVector = true
	} else {
		// non-fatal: server may not support extensions or pgvector is not installed
		// detect SQLSTATE 0A000 or fallback to string check and continue
		if strings.Contains(err.Error(), "SQLSTATE 0A000") || strings.Contains(err.Error(), "extension \"vector\"") {
			fmt.Printf("pgvector extension unavailable: %v — skipping vector indexes\n", err)
			hasVector = false
		} else {
			// unexpected error — fail migration
			return fmt.Errorf("apply database migration (create extension): %w", err)
		}
	}

	r.hasVector = hasVector
	if r.hasVector {
		post := []string{
			`ALTER TABLE rag.chunks ADD COLUMN IF NOT EXISTS embedding vector(1536)`,
			`CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON rag.chunks USING ivfflat (embedding vector_l2_ops) WITH (lists = 100)`,
		}
		for _, statement := range post {
			if _, err := r.pool.Exec(ctx, statement); err != nil {
				return fmt.Errorf("apply database migration: %w", err)
			}
		}
	}

	return nil
}

func (r *Repository) UpsertDocument(ctx context.Context, document Document) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin document transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	sourceID := uuid.NewString()
	metadata, err := json.Marshal(document.Metadata)
	if err != nil {
		return "", fmt.Errorf("encode document metadata: %w", err)
	}

	if document.ExternalID != "" {
		var existingID string
		err := tx.QueryRow(ctx,
			"SELECT id::text FROM rag.sources WHERE namespace = $1 AND external_id = $2",
			document.Namespace, document.ExternalID,
		).Scan(&existingID)
		switch {
		case err == nil:
			sourceID = existingID
			if _, err := tx.Exec(ctx,
				"UPDATE rag.sources SET title = $1, metadata = $2, updated_at = NOW() WHERE id = $3",
				document.Title, metadata, sourceID,
			); err != nil {
				return "", fmt.Errorf("update source: %w", err)
			}
			if _, err := tx.Exec(ctx, "DELETE FROM rag.chunks WHERE source_id = $1", sourceID); err != nil {
				return "", fmt.Errorf("replace source chunks: %w", err)
			}
		case err == pgx.ErrNoRows:
			if err := insertSource(ctx, tx, sourceID, document, metadata); err != nil {
				return "", err
			}
		default:
			return "", fmt.Errorf("find existing source: %w", err)
		}
	} else if err := insertSource(ctx, tx, sourceID, document, metadata); err != nil {
		return "", err
	}

	batch := &pgx.Batch{}
	for _, chunk := range document.Chunks {
		chunkMeta := map[string]any{
			"chunk_index":       chunk.Index,
			"preceding_context": chunk.PrecedingContext,
			"following_context": chunk.FollowingContext,
			"tokens":            chunk.Tokens,
			"section":           chunk.Section,
		}
		if chunk.EmbeddingScore != nil {
			chunkMeta["embedding_score"] = *chunk.EmbeddingScore
		}
		chunkMetaBytes, err := json.Marshal(chunkMeta)
		if err != nil {
			return "", fmt.Errorf("encode chunk metadata: %w", err)
		}

		// prepare embedding argument only if the DB supports pgvector
		if r.hasVector {
			var embArg any = nil
			if len(chunk.Embedding) > 0 {
				parts := make([]string, 0, len(chunk.Embedding))
				for _, f := range chunk.Embedding {
					parts = append(parts, fmt.Sprintf("%g", f))
				}
				embArg = "[" + strings.Join(parts, ",") + "]"
			}
			batch.Queue(
				`INSERT INTO rag.chunks (id, source_id, chunk_index, content, metadata, embedding)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
				uuid.NewString(),
				sourceID,
				chunk.Index,
				chunk.Content,
				chunkMetaBytes,
				embArg,
			)
		} else {
			batch.Queue(
				`INSERT INTO rag.chunks (id, source_id, chunk_index, content, metadata)
			 VALUES ($1, $2, $3, $4, $5)`,
				uuid.NewString(),
				sourceID,
				chunk.Index,
				chunk.Content,
				chunkMetaBytes,
			)
		}
	}
	results := tx.SendBatch(ctx, batch)
	if err := results.Close(); err != nil {
		return "", fmt.Errorf("insert document chunks: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit document transaction: %w", err)
	}
	return sourceID, nil
}

func insertSource(ctx context.Context, tx pgx.Tx, sourceID string, document Document, metadata []byte) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO rag.sources (id, namespace, external_id, title, metadata)
         VALUES ($1, $2, NULLIF($3, ''), $4, $5)`,
		sourceID, document.Namespace, document.ExternalID, document.Title, metadata,
	)
	if err != nil {
		return fmt.Errorf("insert source: %w", err)
	}
	return nil
}

func (r *Repository) Search(ctx context.Context, options SearchOptions) ([]SearchResult, error) {
	// Prepare metadata filter
	filter, err := json.Marshal(options.MetadataFilter)
	if err != nil {
		return nil, fmt.Errorf("encode metadata filter: %w", err)
	}

	// Check for a provided query embedding in the metadata filter.
	var query string
	var args []any
	mode := strings.ToLower(strings.TrimSpace(options.Mode))
	if mode == "" {
		mode = "fts"
	}
	// If the DB doesn't support pgvector, force lexical search
	if (mode == "vector" || mode == "hybrid") && !r.hasVector {
		mode = "fts"
	}
	var queryVecStr string
	if v, ok := options.MetadataFilter["__query_embedding"]; ok {
		// remove the special key from the filter for SQL matching
		delete(options.MetadataFilter, "__query_embedding")
		filter, _ = json.Marshal(options.MetadataFilter)
		// coerce into string
		switch arr := v.(type) {
		case []float64:
			parts := make([]string, 0, len(arr))
			for _, f := range arr {
				parts = append(parts, fmt.Sprintf("%g", f))
			}
			queryVecStr = "[" + strings.Join(parts, ",") + "]"
		case []any:
			parts := make([]string, 0, len(arr))
			for _, vi := range arr {
				switch vf := vi.(type) {
				case float64:
					parts = append(parts, fmt.Sprintf("%g", vf))
				case float32:
					parts = append(parts, fmt.Sprintf("%g", vf))
				case int:
					parts = append(parts, fmt.Sprintf("%d", vf))
				case int64:
					parts = append(parts, fmt.Sprintf("%d", vf))
				case string:
					parts = append(parts, vf)
				default:
				}
			}
			queryVecStr = "[" + strings.Join(parts, ",") + "]"
		default:
			queryVecStr = ""
		}
	}

	// If the DB lacks pgvector, ignore any provided query embedding
	if !r.hasVector {
		queryVecStr = ""
	}

	// If the query is very short (e.g., a single character), websearch_to_tsquery
	// will likely produce an empty TS query. Fall back to a simple ILIKE search
	// on content and title so short queries in Swagger (like "a") return matches.
	// Provide a simple heuristic score so results aren't all zero.
	if len(strings.TrimSpace(options.Query)) <= 1 {
		simple := `SELECT c.id::text AS chunk_id, c.source_id::text AS source_id, s.title, c.content,
						CASE
							WHEN lower(s.title) LIKE lower('%' || $3 || '%') THEN 1.0
							WHEN position(lower($3) in lower(c.content)) > 0 THEN (1.0 / (1 + position(lower($3) in lower(c.content))))
							ELSE 0.0
						END::double precision AS score,
						c.chunk_index, s.metadata || c.metadata AS metadata
				FROM rag.chunks c
				JOIN rag.sources s ON s.id = c.source_id
				WHERE s.namespace = $1
					AND s.metadata @> $2::jsonb
					AND (c.content ILIKE ('%' || $3 || '%') OR s.title ILIKE ('%' || $3 || '%'))
				ORDER BY score DESC, c.chunk_index ASC
				LIMIT $4`
		args = []any{options.Namespace, filter, options.Query, options.TopK}
		query = simple
	} else if mode == "vector" && queryVecStr != "" {
		query = `SELECT c.id::text AS chunk_id, c.source_id::text AS source_id, s.title, c.content,
            (1.0 / (1.0 + (c.embedding <-> $4::vector)))::double precision AS score,
            c.chunk_index, s.metadata || c.metadata AS metadata
        FROM rag.chunks c
        JOIN rag.sources s ON s.id = c.source_id
        WHERE s.namespace = $2
          AND s.metadata @> $3::jsonb
          AND c.embedding IS NOT NULL
        ORDER BY score DESC, c.chunk_index ASC
        LIMIT $5`
		args = []any{options.Query, options.Namespace, filter, queryVecStr, options.TopK}
	} else if mode == "hybrid" && queryVecStr != "" {
		query = `WITH search_query AS (
                SELECT
                    websearch_to_tsquery('simple'::regconfig, $1) AS strict_value,
                    to_tsquery(
                        'simple'::regconfig,
                        array_to_string(
                            tsvector_to_array(to_tsvector('simple'::regconfig, $1)),
                            ' | '
                        )
                    ) AS relaxed_value
            ),
            ranked_results AS (
                SELECT
                    c.id::text AS chunk_id,
                    c.source_id::text AS source_id,
                    s.title,
                    c.content,
                    (
                        ts_rank_cd(c.search_vector, q.relaxed_value) +
                        (2 * ts_rank_cd(s.search_vector, q.relaxed_value)) +
                        CASE
                            WHEN c.search_vector @@ q.strict_value
                              OR s.search_vector @@ q.strict_value
                            THEN 1
                            ELSE 0
                        END
                    )::double precision AS lex_score,
                    (COALESCE(1.0 / (1.0 + (c.embedding <-> $4::vector)), 0))::double precision AS emb_score,
                    ((0.5 * (
                        ts_rank_cd(c.search_vector, q.relaxed_value) +
                        (2 * ts_rank_cd(s.search_vector, q.relaxed_value)) +
                        CASE
                            WHEN c.search_vector @@ q.strict_value
                              OR s.search_vector @@ q.strict_value
                            THEN 1
                            ELSE 0
                        END
                    )::double precision) + (0.5 * (COALESCE(1.0 / (1.0 + (c.embedding <-> $4::vector)), 0))::double precision))::double precision AS score,
                    c.chunk_index,
                    s.metadata || c.metadata AS metadata
                FROM rag.chunks c
                JOIN rag.sources s ON s.id = c.source_id
                CROSS JOIN search_query q
                WHERE s.namespace = $2
                  AND s.metadata @> $3::jsonb
                  AND (
                        c.search_vector @@ q.relaxed_value
                        OR (c.chunk_index = 0 AND s.search_vector @@ q.relaxed_value)
                        OR c.embedding IS NOT NULL
                  )
            )
			SELECT chunk_id, source_id, title, content, score, chunk_index, metadata
			FROM ranked_results
			ORDER BY score DESC, chunk_index ASC
			LIMIT $5`
		args = []any{options.Query, options.Namespace, filter, queryVecStr, options.TopK}
	} else {
		query = `WITH search_query AS (
                SELECT
                    websearch_to_tsquery('simple'::regconfig, $1) AS strict_value,
                    to_tsquery(
                        'simple'::regconfig,
                        array_to_string(
                            tsvector_to_array(to_tsvector('simple'::regconfig, $1)),
                            ' | '
                        )
                    ) AS relaxed_value
            ),
            ranked_results AS (
                SELECT
                    c.id::text AS chunk_id,
                    c.source_id::text AS source_id,
                    s.title,
                    c.content,
                    (
                        ts_rank_cd(c.search_vector, q.relaxed_value) +
                        (2 * ts_rank_cd(s.search_vector, q.relaxed_value)) +
                        CASE
                            WHEN c.search_vector @@ q.strict_value
                              OR s.search_vector @@ q.strict_value
                            THEN 1
                            ELSE 0
                        END
                    )::double precision AS score,
                    c.chunk_index,
                    s.metadata || c.metadata AS metadata
                FROM rag.chunks c
                JOIN rag.sources s ON s.id = c.source_id
                CROSS JOIN search_query q
                WHERE s.namespace = $2
                  AND s.metadata @> $3::jsonb
                  AND (
                        c.search_vector @@ q.relaxed_value
                        OR (c.chunk_index = 0 AND s.search_vector @@ q.relaxed_value)
                  )
            )
			SELECT chunk_id, source_id, title, content, score, chunk_index, metadata
			FROM ranked_results
			ORDER BY score DESC, chunk_index ASC
			LIMIT $4`
		args = []any{options.Query, options.Namespace, filter, options.TopK}
	}

	// args already include LIMIT parameter where needed; do not append twice

	// Diagnostic log: show search parameters (helps debug empty results)
	log.Printf("store.Search: mode=%s query=%q namespace=%q hasQueryVec=%t args=%d", mode, options.Query, options.Namespace, queryVecStr != "", len(args))

	// Execute query
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("search chunks: %w; sql=%s; args=%d", err, query, len(args))
	}
	defer rows.Close()

	results := make([]SearchResult, 0, options.TopK)
	for rows.Next() {
		var result SearchResult
		var metadata []byte
		if err := rows.Scan(
			&result.ChunkID,
			&result.SourceID,
			&result.Title,
			&result.Content,
			&result.Score,
			&result.ChunkIndex,
			&metadata,
		); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		if err := json.Unmarshal(metadata, &result.Metadata); err != nil {
			return nil, fmt.Errorf("decode search result metadata: %w", err)
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate search results: %w", err)
	}

	// If no results were returned from the primary query, attempt a
	// conservative fallback using ILIKE on content and title. This helps in
	// environments where TS vector queries may not match due to config or
	// unexpected tokenization differences.
	if len(results) == 0 {
		fallback := `SELECT c.id::text AS chunk_id, c.source_id::text AS source_id, s.title, c.content,
			CASE
			  WHEN lower(s.title) LIKE lower('%' || $2 || '%') THEN 1.0
			  WHEN position(lower($2) in lower(c.content)) > 0 THEN (1.0 / (1 + position(lower($2) in lower(c.content))))
			  ELSE 0.0
			END::double precision AS score,
			c.chunk_index, s.metadata || c.metadata AS metadata
		FROM rag.chunks c
		JOIN rag.sources s ON s.id = c.source_id
		WHERE s.namespace = $1
		  AND (c.content ILIKE ('%' || $2 || '%') OR s.title ILIKE ('%' || $2 || '%'))
		ORDER BY score DESC, c.chunk_index ASC
		LIMIT $3`
		fargs := []any{options.Namespace, options.Query, options.TopK}
		frows, ferr := r.pool.Query(ctx, fallback, fargs...)
		if ferr == nil {
			defer frows.Close()
			for frows.Next() {
				var result SearchResult
				var metadata []byte
				if err := frows.Scan(
					&result.ChunkID,
					&result.SourceID,
					&result.Title,
					&result.Content,
					&result.Score,
					&result.ChunkIndex,
					&metadata,
				); err != nil {
					continue
				}
				if err := json.Unmarshal(metadata, &result.Metadata); err == nil {
					// ok
				} else {
					result.Metadata = map[string]any{}
				}
				results = append(results, result)
			}
		}
	}

	// Post-process results for hybrid/vector modes when no vector path executed
	if mode == "hybrid" || mode == "vector" {
		anyEmb := false
		for i := range results {
			meta := results[i].Metadata
			if meta == nil {
				continue
			}
			var embScore float64
			switch v := meta["embedding_score"].(type) {
			case float64:
				embScore = v
			case float32:
				embScore = float64(v)
			case int:
				embScore = float64(v)
			case int64:
				embScore = float64(v)
			case string:
				if f, err := strconv.ParseFloat(v, 64); err == nil {
					embScore = f
				}
			default:
				embScore = 0
			}
			if embScore > 0 {
				anyEmb = true
				if mode == "hybrid" {
					results[i].Score = 0.5*results[i].Score + 0.5*embScore
				} else if mode == "vector" {
					results[i].Score = embScore
				}
			}
		}
		if mode == "vector" && !anyEmb {
			return results, nil
		}
		sort.SliceStable(results, func(i, j int) bool { return results[i].Score > results[j].Score })
		if len(results) > options.TopK {
			results = results[:options.TopK]
		}
	}

	return results, nil
}

func (r *Repository) DeleteDocument(ctx context.Context, sourceID string) (bool, error) {
	tag, err := r.pool.Exec(ctx, "DELETE FROM rag.sources WHERE id = $1", sourceID)
	if err != nil {
		return false, fmt.Errorf("delete source: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// SourceSummary is a lightweight view of a source for debugging.
type SourceSummary struct {
	ID        string         `json:"id"`
	Namespace string         `json:"namespace"`
	Title     string         `json:"title"`
	Metadata  map[string]any `json:"metadata"`
}

// ListSources returns up to `limit` sources.
func (r *Repository) ListSources(ctx context.Context, limit int) ([]SourceSummary, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, namespace, title, metadata FROM rag.sources ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	defer rows.Close()
	out := []SourceSummary{}
	for rows.Next() {
		var s SourceSummary
		var meta []byte
		if err := rows.Scan(&s.ID, &s.Namespace, &s.Title, &meta); err != nil {
			return nil, fmt.Errorf("scan source: %w", err)
		}
		if err := json.Unmarshal(meta, &s.Metadata); err != nil {
			s.Metadata = map[string]any{}
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sources: %w", err)
	}
	return out, nil
}

// ChunkSummary is a lightweight view of a chunk for debugging.
type ChunkSummary struct {
	ID       string         `json:"id"`
	Index    int            `json:"index"`
	Excerpt  string         `json:"excerpt"`
	Metadata map[string]any `json:"metadata"`
}

// ListChunksForSource returns up to `limit` chunks for the given source.
func (r *Repository) ListChunksForSource(ctx context.Context, sourceID string, limit int) ([]ChunkSummary, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, chunk_index, left(content,200), metadata FROM rag.chunks WHERE source_id = $1 ORDER BY chunk_index LIMIT $2`, sourceID, limit)
	if err != nil {
		return nil, fmt.Errorf("list chunks: %w", err)
	}
	defer rows.Close()
	out := []ChunkSummary{}
	for rows.Next() {
		var c ChunkSummary
		var meta []byte
		if err := rows.Scan(&c.ID, &c.Index, &c.Excerpt, &meta); err != nil {
			return nil, fmt.Errorf("scan chunk: %w", err)
		}
		if err := json.Unmarshal(meta, &c.Metadata); err != nil {
			c.Metadata = map[string]any{}
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chunks: %w", err)
	}
	return out, nil
}

// DebugMatchCounts returns counts that help diagnose retrieval issues.
func (r *Repository) DebugMatchCounts(ctx context.Context, namespace string, query string) (map[string]int64, error) {
	out := map[string]int64{"total_chunks": 0, "tsquery_matches": 0, "ilike_matches": 0}
	var v int64
	// total chunks in namespace
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM rag.chunks c JOIN rag.sources s ON s.id = c.source_id WHERE s.namespace = $1`, namespace).Scan(&v); err != nil {
		return nil, fmt.Errorf("count total chunks: %w", err)
	}
	out["total_chunks"] = v

	// tsquery matches
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM rag.chunks c JOIN rag.sources s ON s.id = c.source_id WHERE s.namespace = $1 AND to_tsvector('simple', c.content) @@ websearch_to_tsquery('simple', $2)`, namespace, query).Scan(&v); err != nil {
		return nil, fmt.Errorf("count tsquery matches: %w", err)
	}
	out["tsquery_matches"] = v

	// ilike matches (content or title)
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM rag.chunks c JOIN rag.sources s ON s.id = c.source_id WHERE s.namespace = $1 AND (c.content ILIKE ('%' || $2 || '%') OR s.title ILIKE ('%' || $2 || '%'))`, namespace, query).Scan(&v); err != nil {
		return nil, fmt.Errorf("count ilike matches: %w", err)
	}
	out["ilike_matches"] = v
	return out, nil
}
