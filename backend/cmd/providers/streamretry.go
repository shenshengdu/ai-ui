package providers

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/utils"
)

// Automatic retry for streams that fail mid-way on a free-model gateway.
//
// LiteLLM can only fall back to another model before any output is produced.
// When Gemini & co. return 503/429 *during* the stream, the error reaches us.
// For gateway providers we simply resend the same request: the gateway has
// put the failing model on cooldown, so the retry is served by the next
// model in the fallback chain.
//
// Env:
//   STREAM_RETRY_HOSTS    comma-separated base-URL fragments (default "127.0.0.1:4000,localhost:4000")
//   STREAM_RETRY_ATTEMPTS extra attempts after the first failure (default 2)

func streamRetryHosts() []string {
	v := strings.TrimSpace(os.Getenv("STREAM_RETRY_HOSTS"))
	if v == "" {
		v = "127.0.0.1:4000,localhost:4000"
	}
	var out []string
	for _, h := range strings.Split(v, ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			out = append(out, h)
		}
	}
	return out
}

func streamRetryAttempts() int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("STREAM_RETRY_ATTEMPTS"))); err == nil && n >= 0 {
		return n
	}
	return 2
}

func streamRetryEnabledFor(params RequestParams) bool {
	providerID, _ := utils.ExtractProviderID(params.Model)
	p, err := providers.GetByID(providerID, params.User)
	if err != nil || p == nil {
		return false
	}
	base := strings.ToLower(p.BaseURL)
	for _, h := range streamRetryHosts() {
		if strings.Contains(base, h) {
			return true
		}
	}
	return false
}

// isRetriableStreamError matches overload / rate-limit errors only.
func isRetriableStreamError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	for _, k := range []string{
		"503", "429", "502", "504", "unavailable", "high demand", "overloaded",
		"rate limit", "ratelimit", "resource_exhausted", "too many requests",
		"received error while streaming",
	} {
		if strings.Contains(s, k) {
			return true
		}
	}
	return false
}

// SendChatCompletionStreamRequest wraps the single-attempt stream with
// automatic retries for gateway providers.
func (c *ClientImpl) SendChatCompletionStreamRequest(params RequestParams, sc utils.StreamClient) (*ChatCompletionMessage, error) {
	msg, err := c.sendChatCompletionStreamOnce(params, sc)
	if err == nil || !isRetriableStreamError(err) || !streamRetryEnabledFor(params) {
		return msg, err
	}
	for attempt := 1; attempt <= streamRetryAttempts(); attempt++ {
		if params.Context != nil && params.Context.Err() != nil {
			return msg, err // user stopped the generation
		}
		log.Info("Retrying stream on gateway after mid-stream failure",
			"model", params.Model, "attempt", attempt, "err", err)
		utils.SendStreamChunk(sc, utils.StreamChunk{
			Type:    utils.CONTENT,
			Payload: "\n\n> ⚠️ 当前模型繁忙，已自动切换备用模型重新回答…\n\n",
		})
		time.Sleep(time.Second)
		msg, err = c.sendChatCompletionStreamOnce(params, sc)
		if err == nil || !isRetriableStreamError(err) {
			return msg, err
		}
	}
	return msg, err
}
