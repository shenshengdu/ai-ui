package providers

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"github.com/openai/openai-go/v3"
)

// sanitizedFiles cleans file data URLs before they go into a chat completions
// request: fixes application/octet-stream to a real MIME type where possible
// and drops empty/unsupported files (their extracted text is already in the
// message content). Shares sanitizeFileDataURL with responses.go.
func sanitizedFiles(files []string) []string {
	if len(files) == 0 {
		return nil
	}
	out := make([]string, 0, len(files))
	for i, f := range files {
		clean, mime, ok := sanitizeFileDataURL(f)
		if !ok {
			log.Info("Dropping unsupported file part", "index", i, "mime", mime)
			continue
		}
		out = append(out, clean)
	}
	return out
}

// providerRejectsFileParts reports providers whose chat completions API does
// not accept {"type":"file"} content parts (e.g. DeepSeek official API).
// Extra hosts can be listed in env NO_FILE_PART_HOSTS (comma separated).
func providerRejectsFileParts(baseURL string) bool {
	u := strings.ToLower(baseURL)
	if strings.Contains(u, "api.deepseek.com") {
		return true
	}
	for _, h := range strings.Split(getenv("NO_FILE_PART_HOSTS"), ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" && strings.Contains(u, h) {
			return true
		}
	}
	return false
}

const maxInlinedFileChars = 100000

// inlineFileParts replaces every file content part with a text part: text-like
// files are decoded and inlined, binaries (PDF etc.) become a short note.
func inlineFileParts(params *openai.ChatCompletionNewParams) {
	for mi := range params.Messages {
		u := params.Messages[mi].OfUser
		if u == nil || len(u.Content.OfArrayOfContentParts) == 0 {
			continue
		}
		parts := u.Content.OfArrayOfContentParts
		for pi := range parts {
			f := parts[pi].OfFile
			if f == nil {
				continue
			}
			text := fileDataAsText(f.File.FileData.Value, pi)
			parts[pi] = openai.ChatCompletionContentPartUnionParam{
				OfText: &openai.ChatCompletionContentPartTextParam{Text: text},
			}
		}
	}
}

func fileDataAsText(data string, idx int) string {
	clean, mime, ok := sanitizeFileDataURL(data)
	if ok && (strings.HasPrefix(mime, "text/") || mime == "application/json" || mime == "application/xml") {
		if comma := strings.Index(clean, ","); comma >= 0 {
			if raw, err := base64.StdEncoding.DecodeString(clean[comma+1:]); err == nil {
				s := string(raw)
				if len([]rune(s)) > maxInlinedFileChars {
					s = string([]rune(s)[:maxInlinedFileChars]) + "\n…[truncated]"
				}
				return fmt.Sprintf("[Attached file %d (%s)]\n%s", idx, mime, s)
			}
		}
	}
	if mime == "" {
		mime = "unknown"
	}
	return fmt.Sprintf("[Attached file %d (%s) omitted: this model does not accept file attachments; use the extracted text above if present]", idx, mime)
}

func getenv(k string) string { return strings.TrimSpace(os.Getenv(k)) }

// adaptDeepSeekParams fixes provider-specific extra fields for DeepSeek's
// official API. OpenAIMessageParams adds `thinking: {"keep":"all"}` and
// `reasoning_history` for other providers during the agent loop; DeepSeek
// requires `thinking: {"type": "enabled"|"disabled"}` and rejects the former.
// reasoning_content on assistant messages is kept (DeepSeek needs it echoed
// back within a tool-calling turn).
func adaptDeepSeekParams(p *openai.ChatCompletionNewParams, baseURL string) {
	if !strings.Contains(strings.ToLower(baseURL), "api.deepseek.com") {
		return
	}
	out := map[string]any{}
	for k, v := range p.ExtraFields() {
		if k == "thinking" || k == "reasoning_history" {
			continue
		}
		out[k] = v
	}
	if p.ReasoningEffort != "" && p.ReasoningEffort != "none" {
		out["thinking"] = map[string]any{"type": "enabled"}
	}
	p.SetExtraFields(out)
	ensureDeepSeekReasoningContent(p)
}

// ensureDeepSeekReasoningContent: in thinking mode DeepSeek rejects any
// assistant tool-call message without reasoning_content. Our history stores
// one assistant message per tool call and only keeps reasoning on some of
// them (and none for older turns / other models), so every assistant
// tool-call message gets the latest reasoning of the current user turn,
// or "" when there is none.
func ensureDeepSeekReasoningContent(p *openai.ChatCompletionNewParams) {
	last := ""
	for i := range p.Messages {
		m := &p.Messages[i]
		if m.OfUser != nil {
			last = ""
			continue
		}
		a := m.OfAssistant
		if a == nil {
			continue
		}
		extra := a.ExtraFields()
		if rc, ok := extra["reasoning_content"].(string); ok && rc != "" {
			last = rc
			continue
		}
		if len(a.ToolCalls) == 0 {
			continue
		}
		merged := map[string]any{}
		for k, v := range extra {
			merged[k] = v
		}
		merged["reasoning_content"] = last
		a.SetExtraFields(merged)
	}
}

// adaptGroqParams removes reasoning metadata that Groq's
// OpenAI-compatible Chat Completions API does not accept.
// Keep this provider-specific: DeepSeek still needs reasoning_content.
func adaptGroqParams(p *openai.ChatCompletionNewParams, baseURL string) {
	if !strings.Contains(strings.ToLower(baseURL), "api.groq.com") && !isGatewayBaseURL(baseURL) {
		return
	}

	for i := range p.Messages {
		a := p.Messages[i].OfAssistant
		if a == nil {
			continue
		}

		extra := a.ExtraFields()
		if _, exists := extra["reasoning_content"]; !exists {
			continue
		}

		cleaned := make(map[string]any, len(extra))
		for k, v := range extra {
			if k != "reasoning_content" {
				cleaned[k] = v
			}
		}
		a.SetExtraFields(cleaned)
	}

	// These are internal reasoning hints, not standard Groq request fields.
	cleanedParams := make(map[string]any)
	for k, v := range p.ExtraFields() {
		if k == "reasoning_history" || k == "thinking" {
			continue
		}
		cleanedParams[k] = v
	}
	p.SetExtraFields(cleanedParams)
}
