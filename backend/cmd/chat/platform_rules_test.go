package chat

import (
	"strings"
	"testing"
)

func TestPlatformInstructionsWebFallback(t *testing.T) {
	for _, want := range []string{"web_search", "cite its source", "Prefer the specialised tools for prices"} {
		if !strings.Contains(platformInstructions, want) {
			t.Fatalf("platform instructions should contain %q", want)
		}
	}
}
