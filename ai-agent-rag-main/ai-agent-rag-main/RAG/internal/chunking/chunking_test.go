package chunking

import "testing"

func TestNormalize(t *testing.T) {
	got := Normalize("First  line\r\n\r\n\r\nSecond\x00")
	want := "First line\n\nSecond"
	if got != want {
		t.Fatalf("Normalize() = %q, want %q", got, want)
	}
}

func TestSplitPreservesDocumentEdges(t *testing.T) {
	chunks := Split("Alpha sentence. Beta sentence. Gamma sentence. Delta sentence.", 30, 8)
	if len(chunks) < 2 {
		t.Fatalf("Split() returned %d chunk, want at least 2", len(chunks))
	}
	if !stringsHasPrefix(chunks[0].Content, "Alpha") {
		t.Fatalf("first chunk = %q", chunks[0].Content)
	}
	if !stringsHasSuffix(chunks[len(chunks)-1].Content, "sentence.") {
		t.Fatalf("last chunk = %q", chunks[len(chunks)-1].Content)
	}
}

func TestSplitWhitespace(t *testing.T) {
	if chunks := Split(" \n\t ", 100, 10); len(chunks) != 0 {
		// show Content for easier failure debugging
		t.Fatalf("Split() = %#v, want no chunks", chunks)
	}
}

func stringsHasPrefix(value, prefix string) bool {
	return len(value) >= len(prefix) && value[:len(prefix)] == prefix
}

func stringsHasSuffix(value, suffix string) bool {
	return len(value) >= len(suffix) && value[len(value)-len(suffix):] == suffix
}
