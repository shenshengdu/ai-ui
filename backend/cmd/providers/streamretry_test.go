package providers

import (
	"os"
	"testing"

	"github.com/Bajahaw/ai-ui/cmd/utils"
	logger "github.com/charmbracelet/log"
)

func init() {
	if log == nil {
		log = logger.New(os.Stderr)
	}
}

func TestRetryEmpty(t *testing.T) {
	t.Setenv("EMPTY_RETRY_ATTEMPTS", "2")
	var sc utils.StreamClient
	empty := &ChatCompletionMessage{}

	// 第一次空、第二次有内容：重试一次就好
	calls := 0
	msg, err := retryEmpty(RequestParams{}, sc, empty, nil, func() (*ChatCompletionMessage, error) {
		calls++
		return &ChatCompletionMessage{Content: "答案"}, nil
	})
	if err != nil || msg.Content != "答案" || calls != 1 {
		t.Fatalf("want retry once → 答案, got %q calls=%d err=%v", msg.Content, calls, err)
	}

	// 工具调用不算空
	calls = 0
	msg, _ = retryEmpty(RequestParams{}, sc, &ChatCompletionMessage{ToolCalls: []ToolCall{{Name: "web_search"}}}, nil,
		func() (*ChatCompletionMessage, error) { calls++; return empty, nil })
	if calls != 0 || len(msg.ToolCalls) != 1 {
		t.Fatalf("tool call must not be retried, calls=%d", calls)
	}

	// 一直空：重试 2 次后给出提示
	calls = 0
	msg, err = retryEmpty(RequestParams{}, sc, &ChatCompletionMessage{}, nil, func() (*ChatCompletionMessage, error) {
		calls++
		return &ChatCompletionMessage{}, nil
	})
	if err != nil || calls != 2 || msg.Content != EmptyCompletionNotice {
		t.Fatalf("want notice after 2 retries, got %q calls=%d", msg.Content, calls)
	}

	// 用户取消的不重试
	calls = 0
	retryEmpty(RequestParams{}, sc, &ChatCompletionMessage{Cancelled: true}, nil,
		func() (*ChatCompletionMessage, error) { calls++; return empty, nil })
	if calls != 0 {
		t.Fatal("cancelled must not be retried")
	}
}
