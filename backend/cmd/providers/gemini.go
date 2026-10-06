package providers

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

func isGeminiProvider(baseURL, model string) bool {
	return strings.Contains(strings.ToLower(model), "gemini")
}

// geminiHTTPDebug gates the full request/response body capture for Gemini.
// Off by default because it writes whole conversations into the journal.
// Enable temporarily with GEMINI_HTTP_DEBUG=1.
func geminiHTTPDebug() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("GEMINI_HTTP_DEBUG")))
	return v == "1" || v == "true" || v == "yes"
}

// geminiOptions returns request options for Google's OpenAI-compatible API.
// Google sometimes wraps error bodies in a JSON array ([{"error":{...}}]),
// which the SDK cannot parse, so the UI only showed "503 Service Unavailable".
// The middleware unwraps the array so the real message reaches the user.
func geminiOptions(baseURL string) []option.RequestOption {
	if !strings.Contains(strings.ToLower(baseURL), "generativelanguage.googleapis.com") {
		return nil
	}
	return []option.RequestOption{option.WithMiddleware(unwrapArrayErrorBody)}
}

func unwrapArrayErrorBody(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
	res, err := next(req)
	if err != nil || res == nil || res.StatusCode < 400 || res.Body == nil {
		return res, err
	}
	body, readErr := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	res.Body.Close()
	if readErr != nil {
		res.Body = io.NopCloser(bytes.NewReader(body))
		return res, nil
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 1 && trimmed[0] == '[' && trimmed[len(trimmed)-1] == ']' {
		inner := bytes.TrimSpace(trimmed[1 : len(trimmed)-1])
		if len(inner) > 0 && inner[0] == '{' {
			body = inner
		}
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	res.ContentLength = int64(len(body))
	res.Header.Del("Content-Length")
	return res, nil
}

var effortRank = map[openai.ReasoningEffort]int{
	"none": 0, "minimal": 1, "low": 2, "medium": 3, "high": 4, "xhigh": 5,
}

// adjustGeminiEffort caps the reasoning effort sent to Gemini models.
// GEMINI_REASONING_EFFORT sets the cap (default "low"); "keep" disables it.
// An unset effort (UI "Disabled") is also replaced by the cap, because Gemini
// otherwise thinks dynamically, which is slow and burns free-tier quota.
func adjustGeminiEffort(baseURL, model string, e openai.ReasoningEffort) openai.ReasoningEffort {
	if !isGeminiProvider(baseURL, model) && !isGatewayBaseURL(baseURL) {
		return e
	}
	target := strings.ToLower(strings.TrimSpace(os.Getenv("GEMINI_REASONING_EFFORT")))
	if target == "keep" {
		return e
	}
	if target == "" {
		target = "low"
	}
	t := openai.ReasoningEffort(target)
	if _, ok := effortRank[t]; !ok {
		return e
	}
	if e == "" || effortRank[e] > effortRank[t] {
		return t
	}
	return e
}
