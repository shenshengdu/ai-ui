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
