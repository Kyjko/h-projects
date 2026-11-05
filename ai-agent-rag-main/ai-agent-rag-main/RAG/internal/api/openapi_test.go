package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAPISpec(t *testing.T) {
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	response := httptest.NewRecorder()

	handler.openAPISpec(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}

	var document struct {
		OpenAPI string                     `json:"openapi"`
		Paths   map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &document); err != nil {
		t.Fatalf("OpenAPI document is invalid JSON: %v", err)
	}
	if document.OpenAPI != "3.0.3" {
		t.Fatalf("OpenAPI version = %q, want 3.0.3", document.OpenAPI)
	}
	if strings.Contains(response.Body.String(), "ApiKeyAuth") {
		t.Fatal("OpenAPI document must not require API-key authentication")
	}
	for _, path := range []string{"/health", "/v1/documents", "/v1/documents/file", "/v1/search", "/v1/documents/{sourceID}"} {
		if _, found := document.Paths[path]; !found {
			t.Errorf("OpenAPI document is missing path %q", path)
		}
	}
}

func TestSwaggerUI(t *testing.T) {
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/swagger/", nil)
	response := httptest.NewRecorder()

	handler.swaggerUI(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if !strings.Contains(response.Body.String(), `url: "/openapi.json"`) {
		t.Fatal("Swagger UI does not reference /openapi.json")
	}
}
