package api

const swaggerHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RAG Service - Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`

const openAPISpec = `{
  "openapi": "3.0.3",
  "info": {
    "title": "RAG Service",
    "description": "Document ingestion and PostgreSQL full-text retrieval API for n8n AI Agent workflows.",
    "version": "0.2.0"
  },
  "servers": [
    {
      "url": "/",
      "description": "Current RAG service"
    }
  ],
  "tags": [
    {
      "name": "System"
    },
    {
      "name": "Documents"
    },
    {
      "name": "Retrieval"
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "tags": ["System"],
        "summary": "Check service health",
        "operationId": "getHealth",
        "responses": {
          "200": {
            "description": "Service and database are available",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/HealthResponse"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/ServiceUnavailable"
          }
        }
      }
    },
    "/v1/documents": {
      "post": {
        "tags": ["Documents"],
        "summary": "Ingest document text",
        "description": "Chunks document text and stores it in the PostgreSQL full-text index. Reusing a namespace and external_id replaces the existing document.",
        "operationId": "ingestDocument",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/IngestRequest"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Document ingested",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/IngestResponse"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "422": {
            "$ref": "#/components/responses/UnprocessableEntity"
          }
        }
      }
    },
    "/v1/documents/file": {
      "post": {
        "tags": ["Documents"],
        "summary": "Upload a text document",
        "description": "Uploads a UTF-8 TXT, Markdown, CSV, or JSON file.",
        "operationId": "ingestDocumentFile",
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "$ref": "#/components/schemas/FileIngestRequest"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "File ingested",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/IngestResponse"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "413": {
            "description": "File exceeds the configured upload limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "422": {
            "$ref": "#/components/responses/UnprocessableEntity"
          }
        }
      }
    },
    "/v1/search": {
      "post": {
        "tags": ["Retrieval"],
        "summary": "Search the knowledge base",
        "description": "Uses PostgreSQL web-style full-text search and returns ranked matching document chunks.",
        "operationId": "searchKnowledgeBase",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SearchRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Ranked matching chunks",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SearchResponse"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "422": {
            "$ref": "#/components/responses/UnprocessableEntity"
          }
        }
      }
    },
    "/v1/documents/{sourceID}": {
      "delete": {
        "tags": ["Documents"],
        "summary": "Delete a document",
        "operationId": "deleteDocument",
        "parameters": [
          {
            "name": "sourceID",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Document deleted",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DeleteResponse"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "404": {
            "description": "Document not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    }
    ,
    "/v1/context": {
      "post": {
        "tags": ["Retrieval"],
        "summary": "Assemble context bundle",
        "description": "Returns a token-budget-limited set of context passages for a query.",
        "operationId": "assembleContext",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/ContextRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Context bundle",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ContextBundle" }
              }
            }
          },
          "400": { "$ref": "#/components/responses/BadRequest" },
          "422": { "$ref": "#/components/responses/UnprocessableEntity" }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "HealthResponse": {
        "type": "object",
        "required": ["status", "database"],
        "properties": {
          "status": {
            "type": "string",
            "example": "ok"
          },
          "database": {
            "type": "string",
            "example": "connected"
          }
        }
      },
      "IngestRequest": {
        "type": "object",
        "required": ["text", "title"],
        "additionalProperties": false,
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "namespace": {
            "type": "string",
            "maxLength": 100,
            "default": "default"
          },
          "external_id": {
            "type": "string",
            "maxLength": 500
          },
          "metadata": {
            "type": "object",
            "additionalProperties": true
          }
        }
      },
      "FileIngestRequest": {
        "type": "object",
        "required": ["file"],
        "properties": {
          "file": {
            "type": "string",
            "format": "binary"
          },
          "title": {
            "type": "string",
            "maxLength": 500
          },
          "namespace": {
            "type": "string",
            "maxLength": 100
          },
          "external_id": {
            "type": "string",
            "maxLength": 500
          },
          "metadata": {
            "type": "string",
            "description": "JSON object encoded as a string",
            "example": "{\"department\":\"lending\"}"
          }
        }
      },
      "IngestResponse": {
        "type": "object",
        "required": ["source_id", "namespace", "title", "chunks_created"],
        "properties": {
          "source_id": {
            "type": "string",
            "format": "uuid"
          },
          "namespace": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "chunks_created": {
            "type": "integer",
            "minimum": 1
          }
        }
      },
      "SearchRequest": {
        "type": "object",
        "required": ["query"],
        "additionalProperties": false,
        "properties": {
          "query": {
            "type": "string",
            "minLength": 1
          },
          "namespace": {
            "type": "string",
            "maxLength": 100,
            "default": "default"
          },
          "top_k": {
            "type": "integer",
            "minimum": 1,
            "maximum": 50,
            "default": 5
          },
          "score_threshold": {
            "type": "number",
            "minimum": 0,
            "description": "Optional minimum PostgreSQL full-text relevance rank"
          },
          "metadata_filter": {
            "type": "object",
            "additionalProperties": true
          }
        }
      },
      "SearchResult": {
        "type": "object",
        "required": ["chunk_id", "source_id", "title", "content", "score", "chunk_index", "metadata"],
        "properties": {
          "chunk_id": {
            "type": "string",
            "format": "uuid"
          },
          "source_id": {
            "type": "string",
            "format": "uuid"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "score": {
            "type": "number",
            "format": "double",
            "description": "PostgreSQL full-text relevance rank; higher values are more relevant"
          },
          "chunk_index": {
            "type": "integer"
          },
          "metadata": {
            "type": "object",
            "additionalProperties": true
          }
        }
      },
      "SearchResponse": {
        "type": "object",
        "required": ["query", "namespace", "results"],
        "properties": {
          "query": {
            "type": "string"
          },
          "namespace": {
            "type": "string"
          },
          "results": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SearchResult"
            }
          }
        }
      },
      "DeleteResponse": {
        "type": "object",
        "required": ["source_id", "deleted"],
        "properties": {
          "source_id": {
            "type": "string",
            "format": "uuid"
          },
          "deleted": {
            "type": "boolean",
            "example": true
          }
        }
      },
      "ErrorResponse": {
        "type": "object",
        "required": ["error"],
        "properties": {
          "error": {
            "type": "string"
          }
        }
      }
      ,
      "ContextRequest": {
        "type": "object",
        "required": ["query"],
        "additionalProperties": false,
        "properties": {
          "query": { "type": "string", "minLength": 1 },
          "namespace": { "type": "string", "maxLength": 100, "default": "default" },
          "max_tokens": { "type": "integer", "minimum": 1, "default": 4000 },
          "max_passages": { "type": "integer", "minimum": 1, "default": 5 },
          "metadata_filter": { "type": "object", "additionalProperties": true }
        }
      },
      "ContextChunk": {
        "type": "object",
        "required": ["chunk_id", "source_id", "excerpt", "relevance", "tokens"],
        "properties": {
          "chunk_id": { "type": "string", "format": "uuid" },
          "source_id": { "type": "string", "format": "uuid" },
          "title": { "type": "string" },
          "section": { "type": "string" },
          "excerpt": { "type": "string" },
          "relevance": { "type": "number", "format": "double" },
          "citation": { "type": "object", "additionalProperties": true },
          "tokens": { "type": "integer" },
          "metadata": { "type": "object", "additionalProperties": true }
        }
      },
      "ContextBundle": {
        "type": "object",
        "required": ["query", "namespace", "chunks"],
        "properties": {
          "query": { "type": "string" },
          "namespace": { "type": "string" },
          "chunks": { "type": "array", "items": { "$ref": "#/components/schemas/ContextChunk" } },
          "meta": { "type": "object", "additionalProperties": true }
        }
      }
    },
    "responses": {
      "BadRequest": {
        "description": "Invalid request",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "UnprocessableEntity": {
        "description": "Request is valid JSON but contains invalid values",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "ServiceUnavailable": {
        "description": "Database is unavailable",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      }
    }
  }
}`
