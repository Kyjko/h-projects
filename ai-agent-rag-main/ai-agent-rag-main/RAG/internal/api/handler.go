package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Deloitte-CE-IT/AI/RAG/internal/chunking"
	"github.com/Deloitte-CE-IT/AI/RAG/internal/config"
	"github.com/Deloitte-CE-IT/AI/RAG/internal/store"
	"github.com/google/uuid"
)

type Handler struct {
	config      config.Config
	repository  *store.Repository
	embedClient *http.Client
}

type ingestRequest struct {
	Text       string         `json:"text"`
	Title      string         `json:"title"`
	Namespace  string         `json:"namespace,omitempty"`
	ExternalID string         `json:"external_id,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

type ingestResponse struct {
	SourceID      string `json:"source_id"`
	Namespace     string `json:"namespace"`
	Title         string `json:"title"`
	ChunksCreated int    `json:"chunks_created"`
}

type searchRequest struct {
	Query          string         `json:"query"`
	Namespace      string         `json:"namespace,omitempty"`
	TopK           int            `json:"top_k,omitempty"`
	ScoreThreshold *float64       `json:"score_threshold,omitempty"`
	MetadataFilter map[string]any `json:"metadata_filter,omitempty"`
}

type searchResponse struct {
	Query     string               `json:"query"`
	Namespace string               `json:"namespace"`
	Results   []store.SearchResult `json:"results"`
}

type contextRequest struct {
	Query          string         `json:"query"`
	Namespace      string         `json:"namespace,omitempty"`
	MaxTokens      int            `json:"max_tokens,omitempty"`
	MaxPassages    int            `json:"max_passages,omitempty"`
	MetadataFilter map[string]any `json:"metadata_filter,omitempty"`
}

type ContextChunk struct {
	ChunkID   string         `json:"chunk_id"`
	SourceID  string         `json:"source_id"`
	Title     string         `json:"title"`
	Section   string         `json:"section,omitempty"`
	Excerpt   string         `json:"excerpt"`
	Relevance float64        `json:"relevance"`
	Citation  map[string]any `json:"citation"`
	Tokens    int            `json:"tokens"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type ContextBundle struct {
	Query     string         `json:"query"`
	Namespace string         `json:"namespace"`
	Chunks    []ContextChunk `json:"chunks"`
	Meta      map[string]any `json:"meta,omitempty"`
}

// Reranker ranks candidate search results for better assembly.
type Reranker interface {
	Rank(query string, candidates []store.SearchResult) []store.SearchResult
}

// lexicalReranker is a simple, cheap reranker that boosts title matches.
type lexicalReranker struct{}

func (lexicalReranker) Rank(query string, candidates []store.SearchResult) []store.SearchResult {
	q := strings.ToLower(strings.TrimSpace(query))
	type scored struct {
		idx   int
		score float64
	}
	scoredList := make([]scored, 0, len(candidates))
	for i, c := range candidates {
		s := c.Score
		if q != "" {
			if strings.Contains(strings.ToLower(c.Title), q) {
				s += 0.75
			}
			if strings.Contains(strings.ToLower(c.Content), q) {
				s += 0.25
			}
		}
		scoredList = append(scoredList, scored{idx: i, score: s})
	}
	sort.SliceStable(scoredList, func(i, j int) bool { return scoredList[i].score > scoredList[j].score })
	out := make([]store.SearchResult, 0, len(candidates))
	for _, s := range scoredList {
		out = append(out, candidates[s.idx])
	}
	return out
}

// AssembleContext packages search results into a token-budget-limited ContextBundle.
func AssembleContext(query string, namespace string, candidates []store.SearchResult, maxTokens, maxPassages int, reranker Reranker) ContextBundle {
	bundle := ContextBundle{Query: query, Namespace: namespace, Chunks: []ContextChunk{}, Meta: map[string]any{"token_budget": maxTokens}}
	usedTokens := 0
	passages := 0
	if reranker != nil {
		candidates = reranker.Rank(query, candidates)
	}
	for _, r := range candidates {
		if passages >= maxPassages {
			break
		}
		excerpt := r.Content
		tokens := estimateTokens(excerpt)
		if usedTokens+tokens > maxTokens {
			remain := maxTokens - usedTokens
			if remain <= 0 {
				break
			}
			words := strings.Fields(excerpt)
			if len(words) > remain {
				excerpt = strings.Join(words[:remain], " ")
				tokens = remain
			}
		}
		citation := map[string]any{"source_id": r.SourceID, "chunk_id": r.ChunkID, "title": r.Title}
		cc := ContextChunk{
			ChunkID:   r.ChunkID,
			SourceID:  r.SourceID,
			Title:     r.Title,
			Section:   "",
			Excerpt:   excerpt,
			Relevance: r.Score,
			Citation:  citation,
			Tokens:    tokens,
			Metadata:  r.Metadata,
		}
		bundle.Chunks = append(bundle.Chunks, cc)
		usedTokens += tokens
		passages++
	}
	bundle.Meta["tokens_used"] = usedTokens
	return bundle
}

func NewHandler(cfg config.Config, repository *store.Repository) *Handler {
	client := &http.Client{Timeout: time.Duration(cfg.EmbeddingTimeoutSec) * time.Second}
	return &Handler{config: cfg, repository: repository, embedClient: client}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("GET /openapi.json", h.openAPISpec)
	mux.HandleFunc("GET /swagger", h.swaggerRedirect)
	mux.HandleFunc("GET /swagger/", h.swaggerUI)
	mux.HandleFunc("POST /v1/documents", h.ingestDocument)
	mux.HandleFunc("POST /v1/documents/file", h.ingestFile)
	mux.HandleFunc("POST /v1/search", h.search)
	mux.HandleFunc("POST /v1/context", h.context)
	mux.HandleFunc("GET /debug/sources", h.debugSources)
	mux.HandleFunc("GET /debug/search", h.debugSearch)
	mux.HandleFunc("DELETE /v1/documents/{sourceID}", h.deleteDocument)
	return h.logging(mux)
}

func (h *Handler) debugSources(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	sources, err := h.repository.ListSources(ctx, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("list sources: %v", err))
		return
	}
	// fetch first 5 chunks for each source
	out := make([]map[string]any, 0, len(sources))
	for _, s := range sources {
		chunks, _ := h.repository.ListChunksForSource(ctx, s.ID, 5)
		m := map[string]any{"source": s, "chunks": chunks}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) debugSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("query"))
	ns := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if ns == "" || strings.EqualFold(ns, "string") {
		ns = h.config.DefaultNamespace
	}
	if q == "" {
		writeError(w, http.StatusBadRequest, "query parameter is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	counts, err := h.repository.DebugMatchCounts(ctx, ns, q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("debug search failed: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": q, "namespace": ns, "counts": counts})
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.repository.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "database": "connected"})
}

func (h *Handler) openAPISpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(openAPISpec)); err != nil {
		log.Printf("write OpenAPI specification: %v", err)
	}
}

func (h *Handler) swaggerRedirect(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/swagger/", http.StatusMovedPermanently)
}

func (h *Handler) swaggerUI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(swaggerHTML)); err != nil {
		log.Printf("write Swagger UI: %v", err)
	}
}

func (h *Handler) ingestDocument(w http.ResponseWriter, r *http.Request) {
	var request ingestRequest
	if err := decodeJSON(w, r, &request, h.config.MaxFileSizeBytes); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.ingest(w, r, request)
}

func (h *Handler) ingestFile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, h.config.MaxFileSizeBytes+1024*1024)
	if err := r.ParseMultipartForm(h.config.MaxFileSizeBytes); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "file exceeds the configured upload limit")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()

	text, err := extractTextFile(file, header, h.config.MaxFileSizeBytes)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	metadata := map[string]any{"filename": header.Filename}
	if raw := strings.TrimSpace(r.FormValue("metadata")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &metadata); err != nil {
			writeError(w, http.StatusBadRequest, "metadata must be a JSON object")
			return
		}
		if metadata == nil {
			writeError(w, http.StatusBadRequest, "metadata must be a JSON object")
			return
		}
		metadata["filename"] = header.Filename
	}

	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		title = header.Filename
	}
	// Suggest a chunking strategy based on uploaded file extension. This can be
	// overridden by providing `metadata.chunk_strategy` explicitly.
	ext := strings.ToLower(filepath.Ext(header.Filename))
	switch ext {
	case ".md", ".markdown":
		metadata["chunk_strategy"] = "headings"
	case ".txt":
		metadata["chunk_strategy"] = "paragraphs"
	case ".json", ".csv":
		metadata["chunk_strategy"] = "sentences"
	default:
		// leave unset to use default splitter
	}

	h.ingest(w, r, ingestRequest{
		Text:       text,
		Title:      title,
		Namespace:  r.FormValue("namespace"),
		ExternalID: r.FormValue("external_id"),
		Metadata:   metadata,
	})
}

func (h *Handler) ingest(w http.ResponseWriter, r *http.Request, request ingestRequest) {
	request.Text = strings.TrimSpace(request.Text)
	request.Title = strings.TrimSpace(request.Title)
	if request.Text == "" || request.Title == "" {
		writeError(w, http.StatusUnprocessableEntity, "text and title are required")
		return
	}
	namespace := strings.TrimSpace(request.Namespace)
	if namespace == "" || strings.EqualFold(namespace, "string") {
		namespace = h.config.DefaultNamespace
	}
	if len(namespace) > 100 || len(request.Title) > 500 || len(request.ExternalID) > 500 {
		writeError(w, http.StatusUnprocessableEntity, "namespace, title, or external_id is too long")
		return
	}
	if request.Metadata == nil {
		request.Metadata = map[string]any{}
	}

	// Choose chunking strategy. Allow override via request metadata key
	// `chunk_strategy` (values: "headings", "paragraphs", "sentences",
	// "recursive"). Default uses the original rune-based splitter.
	strategy := ""
	if request.Metadata != nil {
		if v, ok := request.Metadata["chunk_strategy"].(string); ok {
			strategy = strings.ToLower(strings.TrimSpace(v))
		}
	}
	var chunkObjs []chunking.Chunk
	switch strategy {
	case "headings":
		chunkObjs = chunking.SplitHeadings(request.Text, h.config.ChunkSize, h.config.ChunkOverlap)
	case "paragraphs":
		chunkObjs = chunking.SplitParagraphs(request.Text, h.config.ChunkSize, h.config.ChunkOverlap)
	case "sentences":
		chunkObjs = chunking.SplitSentences(request.Text, h.config.ChunkSize, h.config.ChunkOverlap)
	case "recursive":
		chunkObjs = chunking.SplitRecursive(request.Text, h.config.ChunkSize, h.config.ChunkOverlap)
	default:
		chunkObjs = chunking.Split(request.Text, h.config.ChunkSize, h.config.ChunkOverlap)
	}
	if len(chunkObjs) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "document contains no extractable text")
		return
	}
	// Convert chunking.Chunk -> store.Chunk so we can persist chunk metadata.
	chunks := make([]store.Chunk, 0, len(chunkObjs))
	for _, c := range chunkObjs {
		chunks = append(chunks, store.Chunk{
			Index:            c.Index,
			Content:          c.Content,
			PrecedingContext: c.PrecedingContext,
			FollowingContext: c.FollowingContext,
			Tokens:           c.Tokens,
			Section:          c.Section,
		})
	}
	sourceID, err := h.repository.UpsertDocument(r.Context(), store.Document{
		Namespace:  namespace,
		ExternalID: strings.TrimSpace(request.ExternalID),
		Title:      request.Title,
		Metadata:   request.Metadata,
		Chunks:     chunks,
	})
	if err != nil {
		log.Printf("store document: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to store document")
		return
	}
	writeJSON(w, http.StatusCreated, ingestResponse{
		SourceID: sourceID, Namespace: namespace, Title: request.Title, ChunksCreated: len(chunkObjs),
	})
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	var request searchRequest
	if err := decodeJSON(w, r, &request, 1024*1024); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	request.Query = strings.TrimSpace(request.Query)
	if request.Query == "" {
		writeError(w, http.StatusUnprocessableEntity, "query is required")
		return
	}
	if request.TopK == 0 {
		request.TopK = 5
	}
	if request.TopK < 1 || request.TopK > 50 {
		writeError(w, http.StatusUnprocessableEntity, "top_k must be between 1 and 50")
		return
	}
	if request.ScoreThreshold != nil && *request.ScoreThreshold < 0 {
		writeError(w, http.StatusUnprocessableEntity, "score_threshold must not be negative")
		return
	}
	namespace := strings.TrimSpace(request.Namespace)
	if namespace == "" || strings.EqualFold(namespace, "string") {
		namespace = h.config.DefaultNamespace
	}
	if request.MetadataFilter == nil {
		request.MetadataFilter = map[string]any{}
	} else {
		request.MetadataFilter = sanitizeMetadataFilter(request.MetadataFilter)
	}

	// If embedding API is configured and retrieval mode requires it, fetch query embedding.
	if h.config.EmbeddingAPIURL != "" && (h.config.RetrievalMode == "vector" || h.config.RetrievalMode == "hybrid") {
		if emb, err := h.fetchEmbedding(r.Context(), request.Query); err == nil && len(emb) > 0 {
			request.MetadataFilter["__query_embedding"] = emb
		} else if err != nil {
			log.Printf("warning: embedding fetch failed: %v", err)
		}
	}

	results, err := h.repository.Search(r.Context(), store.SearchOptions{
		Query:          request.Query,
		Namespace:      namespace,
		TopK:           request.TopK,
		ScoreThreshold: request.ScoreThreshold,
		MetadataFilter: request.MetadataFilter,
		Mode:           h.config.RetrievalMode,
	})
	if err != nil {
		log.Printf("search knowledge base: %v", err)
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("knowledge base search failed: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, searchResponse{Query: request.Query, Namespace: namespace, Results: results})
}

func estimateTokens(s string) int {
	// lightweight token estimation: use word count as a proxy
	if strings.TrimSpace(s) == "" {
		return 0
	}
	return len(strings.Fields(s))
}

func (h *Handler) context(w http.ResponseWriter, r *http.Request) {
	var req contextRequest
	if err := decodeJSON(w, r, &req, 1024*1024); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" {
		writeError(w, http.StatusUnprocessableEntity, "query is required")
		return
	}
	if req.MaxPassages == 0 {
		req.MaxPassages = h.config.TopK
	}
	if req.MaxTokens == 0 {
		req.MaxTokens = h.config.MaxContextTokens
	}
	namespace := strings.TrimSpace(req.Namespace)
	if namespace == "" || strings.EqualFold(namespace, "string") {
		namespace = h.config.DefaultNamespace
	}
	if req.MetadataFilter == nil {
		req.MetadataFilter = map[string]any{}
	} else {
		req.MetadataFilter = sanitizeMetadataFilter(req.MetadataFilter)
	}

	// retrieve a candidate set (fetch more than will be returned so assembly can trim)
	searchTopK := req.MaxPassages * 3
	if searchTopK < h.config.TopK*2 {
		searchTopK = h.config.TopK * 2
	}

	// Optionally compute a query embedding to enable vector/hybrid retrieval.
	if h.config.EmbeddingAPIURL != "" && (h.config.RetrievalMode == "vector" || h.config.RetrievalMode == "hybrid") {
		if emb, err := h.fetchEmbedding(r.Context(), req.Query); err == nil && len(emb) > 0 {
			req.MetadataFilter["__query_embedding"] = emb
		} else if err != nil {
			log.Printf("warning: embedding fetch failed: %v", err)
		}
	}

	results, err := h.repository.Search(r.Context(), store.SearchOptions{
		Query:          req.Query,
		Namespace:      namespace,
		TopK:           searchTopK,
		ScoreThreshold: nil,
		MetadataFilter: req.MetadataFilter,
		Mode:           h.config.RetrievalMode,
	})
	if err != nil {
		log.Printf("search knowledge base: %v", err)
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("knowledge base search failed: %v", err))
		return
	}

	// Use a simple lexical reranker and assemble the context bundle.
	var reranker Reranker = lexicalReranker{}
	bundle := AssembleContext(req.Query, namespace, results, req.MaxTokens, req.MaxPassages, reranker)
	writeJSON(w, http.StatusOK, bundle)
}

func (h *Handler) fetchEmbedding(ctx context.Context, text string) ([]float64, error) {
	if strings.TrimSpace(h.config.EmbeddingAPIURL) == "" {
		return nil, nil
	}
	payload := map[string]any{"input": text}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", h.config.EmbeddingAPIURL, strings.NewReader(string(b)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.embedClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding API status %d: %s", resp.StatusCode, string(body))
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

// sanitizeMetadataFilter removes placeholder values often injected by Swagger UI
// (for example the literal string "string") and removes empty entries so the
// DB containment filter `s.metadata @> $3::jsonb` doesn't inadvertently filter
// out valid results.
func sanitizeMetadataFilter(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if v == nil {
			continue
		}
		switch vv := v.(type) {
		case string:
			s := strings.TrimSpace(vv)
			if s == "" || strings.EqualFold(s, "string") {
				continue
			}
			out[k] = s
		default:
			out[k] = vv
		}
	}
	return out
}

func (h *Handler) deleteDocument(w http.ResponseWriter, r *http.Request) {
	sourceID := r.PathValue("sourceID")
	if _, err := uuid.Parse(sourceID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid source ID")
		return
	}
	deleted, err := h.repository.DeleteDocument(r.Context(), sourceID)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		log.Printf("delete document: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to delete document")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"source_id": sourceID, "deleted": true})
}

func (h *Handler) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func extractTextFile(file multipart.File, header *multipart.FileHeader, limit int64) (string, error) {
	switch strings.ToLower(filepath.Ext(header.Filename)) {
	case ".txt", ".md", ".csv", ".json":
	default:
		return "", fmt.Errorf("unsupported file type; use TXT, Markdown, CSV, or JSON")
	}
	content, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return "", fmt.Errorf("read uploaded file")
	}
	if int64(len(content)) > limit {
		return "", fmt.Errorf("file exceeds the configured upload limit")
	}
	if !utf8.Valid(content) {
		return "", fmt.Errorf("uploaded file must use UTF-8 encoding")
	}
	if !strings.HasSuffix(strings.ToLower(header.Filename), ".json") {
		return string(content), nil
	}
	var value any
	if err := json.Unmarshal(content, &value); err != nil {
		return "", fmt.Errorf("uploaded JSON file is invalid")
	}
	formatted, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", fmt.Errorf("format uploaded JSON file")
	}
	return string(formatted), nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode HTTP response: %v", err)
	}
}
