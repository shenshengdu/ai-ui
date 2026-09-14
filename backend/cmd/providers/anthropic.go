package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/utils"
)

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Stream    bool               `json:"stream,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Role  string `json:"role"`
	Model string `json:"model"`

	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`

	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`

	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func anthropicMessages(params RequestParams, model string, stream bool) anthropicRequest {
	req := anthropicRequest{
		Model:     model,
		MaxTokens: 128000,
		Messages:  make([]anthropicMessage, 0),
		Stream:    stream,
	}

	for _, msg := range params.Messages {
		if msg.Role == "system" {
			req.System += msg.Content
			continue
		}

		role := msg.Role
		if role != "user" && role != "assistant" {
			role = "user"
		}

		req.Messages = append(req.Messages, anthropicMessage{
			Role:    role,
			Content: msg.Content,
		})
	}

	return req
}

func anthropicEndpoint(provider *Provider) string {
	base := strings.TrimRight(provider.BaseURL, "/")
	return base + "/v1/messages"
}

func anthropicHeaders(provider *Provider, req *http.Request) {
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", provider.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	for key, value := range provider.Headers {
		req.Header.Set(key, value)
	}
}

func sendAnthropicCompletion(
	ctx context.Context,
	provider *Provider,
	model string,
	params RequestParams,
) (*ChatCompletionMessage, error) {
	payload := anthropicMessages(params, model, false)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		anthropicEndpoint(provider),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}

	anthropicHeaders(provider, req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"Anthropic API error: %d %s: %s",
			resp.StatusCode,
			http.StatusText(resp.StatusCode),
			string(responseBody),
		)
	}

	var response anthropicResponse
	if err := json.Unmarshal(responseBody, &response); err != nil {
		return nil, err
	}

	var content strings.Builder
	for _, block := range response.Content {
		if block.Type == "text" {
			content.WriteString(block.Text)
		}
	}

	return &ChatCompletionMessage{
		Content: content.String(),
		Stats: utils.StreamStats{
			PromptTokens:     response.Usage.InputTokens,
			CompletionTokens: response.Usage.OutputTokens,
		},
	}, nil
}

func sendAnthropicStream(
	ctx context.Context,
	provider *Provider,
	model string,
	params RequestParams,
	sc utils.StreamClient,
) (*ChatCompletionMessage, error) {
	payload := anthropicMessages(params, model, true)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		anthropicEndpoint(provider),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}

	anthropicHeaders(provider, req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf(
			"Anthropic API error: %d %s: %s",
			resp.StatusCode,
			http.StatusText(resp.StatusCode),
			string(body),
		)
	}

	utils.AddStreamHeaders(sc.Writer)

	var content strings.Builder
	var inputTokens int
	var outputTokens int

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		var event struct {
			Type string `json:"type"`
		}

		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch event.Type {
		case "content_block_delta":
			var delta struct {
				Type  string `json:"type"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}

			if err := json.Unmarshal([]byte(data), &delta); err != nil {
				continue
			}

			if delta.Delta.Type == "text_delta" && delta.Delta.Text != "" {
				content.WriteString(delta.Delta.Text)

				utils.SendStreamChunk(sc, utils.StreamChunk{
					Type:    utils.CONTENT,
					Payload: delta.Delta.Text,
				})
			}

		case "message_delta":
			var msgDelta struct {
				Usage struct {
					OutputTokens int `json:"output_tokens"`
				} `json:"usage"`
			}

			if err := json.Unmarshal([]byte(data), &msgDelta); err == nil {
				outputTokens = msgDelta.Usage.OutputTokens
			}

		case "message_start":
			var msgStart struct {
				Message struct {
					Usage struct {
						InputTokens int `json:"input_tokens"`
					} `json:"usage"`
				} `json:"message"`
			}

			if err := json.Unmarshal([]byte(data), &msgStart); err == nil {
				inputTokens = msgStart.Message.Usage.InputTokens
			}
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return &ChatCompletionMessage{
				Content:   content.String(),
				Cancelled: true,
				Stats: utils.StreamStats{
					PromptTokens:     inputTokens,
					CompletionTokens: outputTokens,
				},
			}, nil
		}

		return nil, err
	}

	return &ChatCompletionMessage{
		Content: content.String(),
		Stats: utils.StreamStats{
			PromptTokens:     inputTokens,
			CompletionTokens: outputTokens,
		},
	}, nil
}

func anthropicRequestTimeout() time.Duration {
	return 30 * time.Minute
}
