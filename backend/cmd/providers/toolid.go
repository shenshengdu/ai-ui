package providers

// Tool call IDs coming back through the LiteLLM gateway for Gemini can carry
// the Gemini thought signature inside the ID (thousands of characters).
// OpenAI and most other providers reject IDs longer than 64 characters, so a
// conversation that once used free-auto breaks when it continues on another
// model. capToolCallID maps such IDs to a short, stable hash; the assistant
// tool_call and the matching tool message get the same value.

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/openai/openai-go/v3"
)

const maxToolCallIDLen = 64

func capToolCallID(id string) string {
	if len(id) <= maxToolCallIDLen {
		return id
	}
	sum := sha256.Sum256([]byte(id))
	return "call_" + hex.EncodeToString(sum[:])[:40]
}

// capToolCallIDs shortens over-long tool call IDs, except when talking to the
// gateway or Gemini, which need the full ID to restore thought signatures.
func capToolCallIDs(p *openai.ChatCompletionNewParams, baseURL, model string) {
	if isGatewayBaseURL(baseURL) || isGeminiProvider(baseURL, model) {
		return
	}
	for i := range p.Messages {
		if a := p.Messages[i].OfAssistant; a != nil {
			for j := range a.ToolCalls {
				if f := a.ToolCalls[j].OfFunction; f != nil {
					f.ID = capToolCallID(f.ID)
				}
			}
		}
		if t := p.Messages[i].OfTool; t != nil {
			t.ToolCallID = capToolCallID(t.ToolCallID)
		}
	}
}
