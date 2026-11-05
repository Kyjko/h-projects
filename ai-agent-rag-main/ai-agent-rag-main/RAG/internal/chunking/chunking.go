package chunking

import (
	"regexp"
	"strings"
)

var (
	horizontalWhitespace = regexp.MustCompile(`[ \t]+`)
	excessiveNewlines    = regexp.MustCompile(`\n{3,}`)
	headingRegex         = regexp.MustCompile(`(?m)^#{1,6}\s+`)
	sentenceRegexp       = regexp.MustCompile(`[^.!?]+[.!?]*`)
)

func Normalize(text string) string {
	text = strings.ReplaceAll(text, "\x00", "")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = horizontalWhitespace.ReplaceAllString(text, " ")
	text = excessiveNewlines.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}

// Chunk represents a text chunk with lightweight metadata.
type Chunk struct {
	ChunkID          string
	SourceID         string
	Title            string
	Section          string
	Index            int
	Content          string
	PrecedingContext string
	FollowingContext string
	Tokens           int
}

// Split splits text into chunks. It returns a slice of Chunk where only
// `Content` and `Index` are populated by this lightweight implementation.
// This keeps callers forward-compatible with richer chunk metadata.
func Split(text string, size, overlap int) []Chunk {
	normalized := Normalize(text)
	if normalized == "" {
		return nil
	}
	// Default strategy: simple rune-based splitter (previous behavior)
	raw := splitRunesToStrings([]rune(normalized), size, overlap)
	return makeChunksFromRaw(raw)
}

// splitRunesToStrings performs the core splitting logic on a rune slice.
func splitRunesToStrings(runes []rune, size, overlap int) []string {
	raw := make([]string, 0, len(runes)/size+1)
	for start := 0; start < len(runes); {
		hardEnd := min(start+size, len(runes))
		end := hardEnd

		if hardEnd < len(runes) {
			searchStart := start + size/2
			if boundary := findBoundary(runes, searchStart, hardEnd); boundary > start {
				end = boundary
			}
		}

		chunk := strings.TrimSpace(string(runes[start:end]))
		if chunk != "" {
			raw = append(raw, chunk)
		}
		if end >= len(runes) {
			break
		}
		start = max(end-overlap, start+1)
	}
	return raw
}

func estimateTokens(s string) int {
	if strings.TrimSpace(s) == "" {
		return 0
	}
	return len(strings.Fields(s))
}

func makeChunksFromRaw(raw []string) []Chunk {
	chunks := make([]Chunk, 0, len(raw))
	for i, c := range raw {
		prev := ""
		next := ""
		if i > 0 {
			prev = raw[i-1]
			if len(prev) > 200 {
				prev = prev[:200]
			}
		}
		if i+1 < len(raw) {
			next = raw[i+1]
			if len(next) > 200 {
				next = next[:200]
			}
		}
		tokens := estimateTokens(c)
		chunks = append(chunks, Chunk{Index: i, Content: c, PrecedingContext: prev, FollowingContext: next, Tokens: tokens})
	}
	return chunks
}

// SplitParagraphs splits text by paragraphs (blank-line separated), then
// sub-splits long paragraphs using the rune-based splitter.
func SplitParagraphs(text string, size, overlap int) []Chunk {
	normalized := Normalize(text)
	if normalized == "" {
		return nil
	}
	parts := strings.Split(normalized, "\n\n")
	raw := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		runes := []rune(p)
		if len(runes) <= size {
			raw = append(raw, p)
			continue
		}
		sub := splitRunesToStrings(runes, size, overlap)
		raw = append(raw, sub...)
	}
	return makeChunksFromRaw(raw)
}

// SplitHeadings groups text by markdown headings (#) preserving section
// boundaries, then splits large sections further.
func SplitHeadings(text string, size, overlap int) []Chunk {
	normalized := Normalize(text)
	if normalized == "" {
		return nil
	}
	lines := strings.Split(normalized, "\n")
	sections := make([]string, 0)
	sectionHeadings := make([]string, 0)
	var current []string
	currentHeading := ""
	for _, ln := range lines {
		if headingRegex.MatchString(ln) {
			// flush previous section
			if len(current) > 0 {
				sections = append(sections, strings.TrimSpace(strings.Join(current, "\n")))
				sectionHeadings = append(sectionHeadings, currentHeading)
				current = []string{}
			}
			// set new heading text
			currentHeading = strings.TrimSpace(strings.TrimLeft(ln, "#"))
		}
		current = append(current, ln)
	}
	if len(current) > 0 {
		sections = append(sections, strings.TrimSpace(strings.Join(current, "\n")))
		sectionHeadings = append(sectionHeadings, currentHeading)
	}
	raw := make([]string, 0)
	rawSections := make([]string, 0, len(sections))
	for i, sec := range sections {
		if sec == "" {
			continue
		}
		runes := []rune(sec)
		headingForSection := ""
		if i < len(sectionHeadings) {
			headingForSection = sectionHeadings[i]
		}
		if len(runes) <= size {
			raw = append(raw, sec)
			rawSections = append(rawSections, headingForSection)
		} else {
			parts := splitRunesToStrings(runes, size, overlap)
			raw = append(raw, parts...)
			for range parts {
				rawSections = append(rawSections, headingForSection)
			}
		}
	}
	// build chunks with section names
	chunks := make([]Chunk, 0, len(raw))
	for i, c := range raw {
		prev := ""
		next := ""
		if i > 0 {
			prev = raw[i-1]
			if len(prev) > 200 {
				prev = prev[:200]
			}
		}
		if i+1 < len(raw) {
			next = raw[i+1]
			if len(next) > 200 {
				next = next[:200]
			}
		}
		tokens := estimateTokens(c)
		secName := ""
		if i < len(rawSections) {
			secName = rawSections[i]
		}
		chunks = append(chunks, Chunk{Index: i, Content: c, PrecedingContext: prev, FollowingContext: next, Tokens: tokens, Section: secName})
	}
	return chunks
}

// SplitSentences assembles sentences into chunks, preferring to keep
// sentence boundaries and not splitting mid-sentence when possible.
func SplitSentences(text string, size, overlap int) []Chunk {
	normalized := Normalize(text)
	if normalized == "" {
		return nil
	}
	sentences := sentenceRegexp.FindAllString(normalized, -1)
	if len(sentences) == 0 {
		return Split(normalized, size, overlap)
	}
	raw := make([]string, 0)
	var builder strings.Builder
	for _, s := range sentences {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if builder.Len()+len(s)+1 <= size {
			if builder.Len() > 0 {
				builder.WriteString(" ")
			}
			builder.WriteString(s)
			continue
		}
		// flush
		if builder.Len() > 0 {
			raw = append(raw, strings.TrimSpace(builder.String()))
			builder.Reset()
		}
		if len([]rune(s)) <= size {
			raw = append(raw, s)
		} else {
			raw = append(raw, splitRunesToStrings([]rune(s), size, overlap)...)
		}
	}
	if builder.Len() > 0 {
		raw = append(raw, strings.TrimSpace(builder.String()))
	}
	return makeChunksFromRaw(raw)
}

// SplitRecursive tries a larger initial chunk size and recursively splits
// oversized segments to preserve higher-level structure when possible.
func SplitRecursive(text string, size, overlap int) []Chunk {
	normalized := Normalize(text)
	if normalized == "" {
		return nil
	}
	// Try larger chunks first to preserve context
	largeSize := size * 2
	raw := splitRunesToStrings([]rune(normalized), largeSize, overlap)
	final := make([]Chunk, 0)
	idx := 0
	for _, seg := range raw {
		if len([]rune(seg)) <= size {
			final = append(final, Chunk{Index: idx, Content: seg})
			idx++
			continue
		}
		// split the oversized segment by sentences, then by runes as fallback
		parts := SplitSentences(seg, size, overlap)
		for _, p := range parts {
			p.Index = idx
			final = append(final, p)
			idx++
		}
	}
	return final
}

func findBoundary(runes []rune, start, end int) int {
	for i := end - 1; i >= start; i-- {
		if runes[i] == '\n' && i+1 < end && runes[i+1] == '\n' {
			return i
		}
	}
	for i := end - 1; i >= start; i-- {
		if runes[i] == '.' || runes[i] == '!' || runes[i] == '?' {
			return i + 1
		}
	}
	for i := end - 1; i >= start; i-- {
		if runes[i] == ' ' || runes[i] == '\n' {
			return i
		}
	}
	return end
}
