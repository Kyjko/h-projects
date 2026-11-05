# RAG Service

A Go-based Retrieval-Augmented Generation service designed to run with the repository's other Podman containers and act as a knowledge tool for an n8n AI Agent.

The service chunks documents, indexes them with PostgreSQL full-text search, and exposes ranked retrieval over HTTP. The retrieved passages are provided to an n8n AI Agent, where its existing LLM generates the final answer.

## Features

- Go 1.23 service with a small multi-stage container image
- JSON text ingestion and multipart text-file upload
- TXT, Markdown, CSV, and JSON file support
- Configurable Unicode-safe chunking with overlap
- Ranked PostgreSQL full-text search over titles, filenames, external IDs, and content
- Strict-match boosting with relaxed term fallback for natural-language queries
- No embedding model or additional AI API required
- Separate knowledge bases through namespaces
- Metadata filtering
- Idempotent replacement through `external_id`
- Graceful shutdown and health endpoint
- Swagger UI for interactive API requests

PDF and DOCX extraction should be performed in n8n with the **Extract From File** node. Send the extracted text to this service through `/v1/documents`.

## Deploy with Podman Compose

Build and start the service with the existing database and n8n:

```bash
podman compose -f docker-compose.podman.yml up -d --build pgvector-db rag-api n8n
```

The endpoints are available at:

- Host machine: `http://localhost:8083`
- n8n compose network: `http://rag-api:8083`
- Health check: `GET http://localhost:8083/health`
- Swagger UI: `http://localhost:8083/swagger/`
- OpenAPI document: `http://localhost:8083/openapi.json`
(- Search / Chunk retrieval debug: `http://localhost:8038/debug/search`)

## API

Open `http://localhost:8083/swagger/` to call the endpoints interactively through **Try it out**.

### Ingest text

```bash
curl -X POST http://localhost:8083/v1/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Loan policy",
    "external_id": "loan-policy-v1",
    "namespace": "banking",
    "text": "The complete document text goes here.",
    "metadata": {
      "department": "lending",
      "language": "en"
    }
  }'
```

Using the same `namespace` and `external_id` replaces the existing source and its chunks.

### Upload a text file

```bash
curl -X POST http://localhost:8083/v1/documents/file \
  -F "file=@policy.md" \
  -F "namespace=banking" \
  -F "external_id=loan-policy-file" \
  -F 'metadata={"department":"lending"}'
```

### Search the knowledge base

```bash
curl -X POST http://localhost:8083/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What documents are required for a loan application?",
    "namespace": "banking",
    "top_k": 5,
    "score_threshold": 0.2,
    "metadata_filter": {
      "department": "lending"
    }
  }'
```

The response contains ranked passages with source IDs, titles, PostgreSQL full-text relevance scores, and metadata. Exact multi-term matches receive a ranking boost, while queries that do not have an exact match fall back to passages containing a useful subset of the terms.

### Delete a source

```bash
curl -X DELETE http://localhost:8083/v1/documents/SOURCE_UUID
```

## Connect to an n8n AI Agent

Add an **HTTP Request Tool** node and connect it to the **Tool** input of the AI Agent.

| Setting | Value |
| --- | --- |
| Name | `search_knowledge_base` |
| Description | `Search internal knowledge. Use this before answering questions that may require company-specific facts.` |
| Method | `POST` |
| URL | `http://rag-api:8083/v1/search` |
| Authentication | None |
| Body content type | JSON |

| Setting | Value |
| --- | --- |
| Name | `search_context` |
| Description | `Retrieve a ContextBundle object consisting of assembled text segments, order, truncated tokens, provenance and reranker scores. Can use embedding if neccessary in the future. Use this for ready-to-send prompt context` |
| Method | `POST` |
| URL | `http://rag-api:8083/v1/context` |
| Authentication | None |
| Body content type | JSON |

Use this request body:

```json
{
  "query": "={{ $fromAI('query', 'Focused keywords from the user request for full-text knowledge search', 'string') }}",
  "namespace": "banking",
  "top_k": 5
}
```

Add this guidance to the AI Agent system message:

```text
Use the search_knowledge_base tool for questions that may depend on internal
knowledge. Base the answer on relevant retrieved passages. If retrieval does
not provide enough information, say that the knowledge base does not contain
the answer. Do not invent internal facts.
```

Use a separate ingestion workflow for loading knowledge:

1. Read a file or receive it through a webhook.
2. For PDF or DOCX, use n8n's **Extract From File** node.
3. Send the extracted text, title, namespace, external ID, and metadata to `POST http://rag-api:8083/v1/documents`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8083` | HTTP server port |
| `DATABASE_URL` | local PostgreSQL URL | PostgreSQL connection string |
| `RAG_DEFAULT_NAMESPACE` | `default` | Namespace used when none is supplied |
| `RAG_CHUNK_SIZE` | `1200` | Approximate runes per chunk |
| `RAG_CHUNK_OVERLAP` | `200` | Runes repeated between chunks |
| `RAG_MAX_FILE_SIZE_MB` | `20` | Maximum JSON request or upload size |
| `RAG_RETRIEVAL_MODE`  | `ftp` | Default retrieval mode of chunks  |

Retrieval mode can be `ftp`, `vector` or `hybrid`

## Local development

Set the variables from `.env.example`, use `localhost:5433` in `DATABASE_URL`, and run:

```bash
go test ./...
go run ./cmd/server
```
