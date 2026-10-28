package chat

import (
	"strings"
	"testing"

	"github.com/Bajahaw/ai-ui/cmd/providers"
)

func TestBuildSummaryTranscript(t *testing.T) {
	msgs := map[int]*Message{
		1: {ID: 1, Role: "user", Content: "hello"},
		2: {ID: 2, Role: "assistant", Content: "hi", ParentID: 1,
			Tools: []*providers.ToolCall{{Name: "search", Output: strings.Repeat("x", 500)}}},
		3: {ID: 3, Role: "user", Content: "second", ParentID: 2},
		4: {ID: 4, Role: "assistant", Content: "", Error: "boom", ParentID: 3},
		5: {ID: 5, Role: "assistant", Content: "other branch", ParentID: 1},
	}
	text, turns := buildSummaryTranscript(msgs, 4)
	if turns != 2 {
		t.Fatalf("turns = %d, want 2", turns)
	}
	if strings.Contains(text, "other branch") {
		t.Fatal("must only include the requested branch")
	}
	if strings.Contains(text, "boom") {
		t.Fatal("empty error replies must be skipped")
	}
	if !strings.Contains(text, "(tool search: "+strings.Repeat("x", summaryToolOutputRunes)+"…)") {
		t.Fatal("tool output must be truncated")
	}
	if strings.Index(text, "hello") > strings.Index(text, "second") {
		t.Fatal("transcript must be oldest first")
	}
}

func TestEstimateTokens(t *testing.T) {
	if got := estimateTokens("成都天气"); got != 4 {
		t.Fatalf("cjk: got %d", got)
	}
	if got := estimateTokens("abcdefgh"); got != 2 {
		t.Fatalf("latin: got %d", got)
	}
}

func TestClampSummary(t *testing.T) {
	short := "line one\nline two"
	if clampSummary(short, 100) != short {
		t.Fatal("short summary must be unchanged")
	}
	long := strings.Repeat("天气很好适合出行\n", 50) // 9 tokens per line
	got := clampSummary(long, 40)
	if estimateTokens(got) > 45 {
		t.Fatalf("not clamped: %d tokens", estimateTokens(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatal("clamped summary should end with an ellipsis")
	}
}
