package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                 string
	DatabaseURL          string
	DefaultNamespace     string
	ChunkSize            int
	ChunkOverlap         int
	MaxFileSizeBytes     int64
	RetrievalMode        string
	MaxContextTokens     int
	TopK                 int
	MinScore             float64
	EnableQueryExpansion bool
	AllowedMetadataKeys  []string
	// Embedding API endpoint used for generating query or chunk embeddings.
	EmbeddingAPIURL string
	// Timeout seconds for embedding API requests.
	EmbeddingTimeoutSec int
}

func Load() (Config, error) {
	// Load .env file if present; environment variables take precedence.
	loadDotEnv()

	cfg := Config{
		Port:             envOrDefault("PORT", "8083"),
		DatabaseURL:      envOrDefault("DATABASE_URL", "postgresql://t24:t24@localhost:5432/t24db"),
		DefaultNamespace: envOrDefault("RAG_DEFAULT_NAMESPACE", "default"),
	}
	var err error
	if cfg.ChunkSize, err = positiveInt("RAG_CHUNK_SIZE", 1200); err != nil {
		return Config{}, err
	}
	if cfg.ChunkOverlap, err = nonNegativeInt("RAG_CHUNK_OVERLAP", 200); err != nil {
		return Config{}, err
	}
	if cfg.ChunkOverlap >= cfg.ChunkSize {
		return Config{}, fmt.Errorf("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE")
	}
	maxFileSizeMB, err := positiveInt("RAG_MAX_FILE_SIZE_MB", 20)
	if err != nil {
		return Config{}, err
	}
	cfg.MaxFileSizeBytes = int64(maxFileSizeMB) * 1024 * 1024

	// Retrieval tuning defaults
	cfg.RetrievalMode = envOrDefault("RAG_RETRIEVAL_MODE", "fts")
	switch strings.ToLower(strings.TrimSpace(cfg.RetrievalMode)) {
	case "fts", "hybrid", "vector":
		// ok
	default:
		return Config{}, fmt.Errorf("RAG_RETRIEVAL_MODE must be one of: fts, hybrid, vector")
	}
	if cfg.MaxContextTokens, err = positiveInt("RAG_MAX_CONTEXT_TOKENS", 4000); err != nil {
		return Config{}, err
	}
	if cfg.TopK, err = positiveInt("RAG_TOP_K", 5); err != nil {
		return Config{}, err
	}
	// parse min score (float)
	if raw := strings.TrimSpace(os.Getenv("RAG_MIN_SCORE")); raw == "" {
		cfg.MinScore = 0.0
	} else {
		f, ferr := strconv.ParseFloat(raw, 64)
		if ferr != nil {
			return Config{}, fmt.Errorf("RAG_MIN_SCORE must be a number")
		}
		cfg.MinScore = f
	}
	if raw := strings.TrimSpace(os.Getenv("RAG_ENABLE_QUERY_EXPANSION")); raw == "" {
		cfg.EnableQueryExpansion = false
	} else {
		cfg.EnableQueryExpansion = !(raw == "0" || strings.EqualFold(raw, "false"))
	}
	if raw := strings.TrimSpace(os.Getenv("RAG_ALLOWED_METADATA_KEYS")); raw == "" {
		cfg.AllowedMetadataKeys = []string{}
	} else {
		parts := strings.Split(raw, ",")
		keys := make([]string, 0, len(parts))
		for _, p := range parts {
			if k := strings.TrimSpace(p); k != "" {
				keys = append(keys, k)
			}
		}
		cfg.AllowedMetadataKeys = keys
	}

	if strings.TrimSpace(cfg.DefaultNamespace) == "" {
		return Config{}, fmt.Errorf("RAG_DEFAULT_NAMESPACE must not be empty")
	}
	// Embedding API
	cfg.EmbeddingAPIURL = strings.TrimSpace(os.Getenv("EMBEDDING_API_URL"))
	if cfg.EmbeddingAPIURL == "" {
		// leave empty to disable embedding calls
	}
	if cfg.EmbeddingTimeoutSec, err = nonNegativeInt("EMBEDDING_TIMEOUT_SEC", 20); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// loadDotEnv loads key=value lines from a .env file in the current working directory.
// Existing environment variables are not overridden.
func loadDotEnv() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// split at first '='
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		// strip surrounding quotes if present
		if len(val) >= 2 && ((val[0] == '\'' && val[len(val)-1] == '\'') || (val[0] == '"' && val[len(val)-1] == '"')) {
			val = val[1 : len(val)-1]
		}
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}

func envOrDefault(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func positiveInt(name string, fallback int) (int, error) {
	value, err := nonNegativeInt(name, fallback)
	if err != nil {
		return 0, err
	}
	if value == 0 {
		return 0, fmt.Errorf("%s must be greater than zero", name)
	}
	return value, nil
}

func nonNegativeInt(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return value, nil
}
