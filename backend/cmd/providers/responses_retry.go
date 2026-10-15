package providers

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/utils"
	openai "github.com/openai/openai-go/v3"
)

// 模型接口限流(429 / rate_limit_exceeded)自动重试:
// 只在“还没有向用户输出任何内容”时重试,按接口给出的 retry-after 等待,最多重试 4 次。

type responsesRetryable struct {
	err  error
	wait time.Duration
}

func (r *responsesRetryable) Error() string { return r.err.Error() }
func (r *responsesRetryable) Unwrap() error { return r.err }

var (
	reRetryAfterMs = regexp.MustCompile(`"retry-after-ms"\s*:\s*"?(\d+)`)
	reRetryAfterS  = regexp.MustCompile(`"retry-after"\s*:\s*"?(\d+)`)
	reTryAgainIn   = regexp.MustCompile(`try again in ([0-9.]+)\s*(ms|s)`)
)

func responsesRateLimitWait(err error) (time.Duration, bool) {
	if err == nil {
		return 0, false
	}
	s := err.Error()
	if strings.Contains(s, "insufficient_quota") {
		return 0, false
	}
	if !(strings.Contains(s, "rate_limit_exceeded") || strings.Contains(s, "Rate limit reached") || strings.Contains(s, "429 Too Many Requests")) {
		return 0, false
	}
	wait := 15 * time.Second
	if m := reRetryAfterMs.FindStringSubmatch(s); m != nil {
		if v, e := strconv.Atoi(m[1]); e == nil {
			wait = time.Duration(v) * time.Millisecond
		}
	} else if m := reTryAgainIn.FindStringSubmatch(s); m != nil {
		if v, e := strconv.ParseFloat(m[1], 64); e == nil {
			if m[2] == "ms" {
				wait = time.Duration(v * float64(time.Millisecond))
			} else {
				wait = time.Duration(v * float64(time.Second))
			}
		}
	} else if m := reRetryAfterS.FindStringSubmatch(s); m != nil {
		if v, e := strconv.Atoi(m[1]); e == nil {
			wait = time.Duration(v) * time.Second
		}
	}
	wait += 1500 * time.Millisecond
	if wait < 3*time.Second {
		wait = 3 * time.Second
	}
	if wait > 60*time.Second {
		wait = 60 * time.Second
	}
	return wait, true
}

func sendResponsesStream(ctx context.Context, client openai.Client, model string, params RequestParams, sc utils.StreamClient) (*ChatCompletionMessage, error) {
	const maxRetries = 4
	for attempt := 0; ; attempt++ {
		msg, err := sendResponsesStreamOnce(ctx, client, model, params, sc)
		var rl *responsesRetryable
		if err == nil || !errors.As(err, &rl) {
			return msg, err
		}
		if attempt >= maxRetries {
			return nil, rl.err
		}
		log.Info("Responses API rate limited, will retry", "attempt", attempt+1, "wait", rl.wait)
		utils.SendStreamChunk(sc, utils.StreamChunk{
			Payload: fmt.Sprintf("\n（模型接口限流，%d 秒后自动重试，第 %d 次）\n", int(rl.wait.Seconds()), attempt+1),
			Type:    utils.REASONING,
		})
		select {
		case <-time.After(rl.wait):
		case <-ctx.Done():
			return &ChatCompletionMessage{Cancelled: true}, nil
		}
	}
}

var _ = context.Background
var _ openai.Client
