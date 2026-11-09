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

// emptyRetryAttempts: extra attempts when the model ends a turn with no text
// and no tool call (env EMPTY_RETRY_ATTEMPTS, default 2).
func emptyRetryAttempts() int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("EMPTY_RETRY_ATTEMPTS"))); err == nil && n >= 0 {
		return n
	}
	return 2
}

// EmptyCompletionNotice is shown (and saved) when every attempt came back empty.
const EmptyCompletionNotice = "\n\n> ⚠️ 模型连续返回了空回答（没有文字、也没有调用工具）。请重新提问，或换一个模型试试。\n"

func isEmptyCompletion(msg *ChatCompletionMessage) bool {
	return msg != nil && !msg.Cancelled && strings.TrimSpace(msg.Content) == "" && len(msg.ToolCalls) == 0
}

// retryEmpty resends the request when a turn ends empty (Gemini sometimes
// returns nothing, e.g. after a malformed function call). On the gateway the
// free-model ranker counts the empty answer as a failure, so the retry is
// usually served by the next-ranked model. If every attempt is empty, a
// notice is streamed and returned as content instead of ending silently.
func retryEmpty(params RequestParams, sc utils.StreamClient, msg *ChatCompletionMessage, err error,
	send func() (*ChatCompletionMessage, error)) (*ChatCompletionMessage, error) {
	if err != nil || !isEmptyCompletion(msg) {
		return msg, err
	}
	for attempt := 1; attempt <= emptyRetryAttempts(); attempt++ {
		if params.Context != nil && params.Context.Err() != nil {
			return msg, err
		}
		log.Info("Empty completion (no content, no tool calls); retrying", "model", params.Model, "attempt", attempt)
		time.Sleep(500 * time.Millisecond)
		msg, err = send()
		if err != nil || !isEmptyCompletion(msg) {
			return msg, err
		}
	}
	log.Info("Completion still empty after retries", "model", params.Model)
	utils.SendStreamChunk(sc, utils.StreamChunk{Type: utils.CONTENT, Payload: EmptyCompletionNotice})
	msg.Content = EmptyCompletionNotice
	return msg, nil
}

// SendChatCompletionStreamRequest wraps the single-attempt stream with
// automatic retries for gateway providers: mid-stream overload errors and
// empty turns.
func (c *ClientImpl) SendChatCompletionStreamRequest(params RequestParams, sc utils.StreamClient) (*ChatCompletionMessage, error) {
	msg, err := c.sendWithErrorRetry(params, sc)
	if !streamRetryEnabledFor(params) {
		return msg, err
	}
	return retryEmpty(params, sc, msg, err, func() (*ChatCompletionMessage, error) {
		return c.sendWithErrorRetry(params, sc)
	})
}

func (c *ClientImpl) sendWithErrorRetry(params RequestParams, sc utils.StreamClient) (*ChatCompletionMessage, error) {
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
