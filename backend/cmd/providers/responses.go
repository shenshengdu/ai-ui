package providers

// Responses API (/v1/responses) branch for models that cannot combine
// function tools with reasoning on /v1/chat/completions (e.g. gpt-6.1-sol).
//
// Model selection: env RESPONSES_API_MODELS (comma separated, case-insensitive).
// Default when unset: "gpt-6.1-sol".
//
// Reasoning continuity across agent-loop turns: we run stateless (store=false)
// and request reasoning.encrypted_content. The encrypted reasoning items of a
// response are stashed in the first ToolCall.ThoughtSignature with the prefix
// "oairs:" and replayed before the matching function_call on the next turn.
// They are only replayed to the same model that produced them.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Bajahaw/ai-ui/cmd/utils"

	"github.com/google/uuid"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"
)

const responsesReasoningPrefix = "oairs:"

type responsesReasoningBlob struct {
	Model string            `json:"model"`
	Items []json.RawMessage `json:"items"`
}

// useResponsesAPI reports whether this model should be routed to /v1/responses.
func useResponsesAPI(model string) bool {
	list := os.Getenv("RESPONSES_API_MODELS")
	if strings.TrimSpace(list) == "" {
		list = "gpt-6.1-sol"
	}
	for _, m := range strings.Split(list, ",") {
		if strings.EqualFold(strings.TrimSpace(m), model) {
			return true
		}
	}
	return false
}

// isResponsesReasoningBlob lets other code paths (e.g. OpenAIMessageParams)
// skip our encrypted reasoning stash instead of sending it as a Gemini signature.
func isResponsesReasoningBlob(s string) bool {
	return strings.HasPrefix(s, responsesReasoningPrefix)
}

func encodeResponsesReasoning(model string, items []json.RawMessage) string {
	if len(items) == 0 {
		return ""
	}
	b, err := json.Marshal(responsesReasoningBlob{Model: model, Items: items})
	if err != nil {
		return ""
	}
	return responsesReasoningPrefix + string(b)
}

func decodeResponsesReasoning(model, s string) []json.RawMessage {
	if !isResponsesReasoningBlob(s) {
		return nil
	}
	var blob responsesReasoningBlob
	if err := json.Unmarshal([]byte(strings.TrimPrefix(s, responsesReasoningPrefix)), &blob); err != nil {
		return nil
	}
	// Encrypted reasoning from a different model fails verification; drop it.
	if !strings.EqualFold(blob.Model, model) {
		return nil
	}
	return blob.Items
}

func toResponsesTools(tools []openai.ChatCompletionToolUnionParam) []responses.ToolUnionParam {
	out := make([]responses.ToolUnionParam, 0, len(tools))
	for _, t := range tools {
		if t.OfFunction == nil {
			continue
		}
		fn := t.OfFunction.Function
		ft := &responses.FunctionToolParam{
			Name:       fn.Name,
			Parameters: fn.Parameters,
			// Responses API defaults strict to true, which rejects many
			// hand-written schemas. Keep chat-completions semantics.
			Strict: openai.Bool(false),
		}
		if ft.Parameters == nil {
			ft.Parameters = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		if fn.Strict.Valid() {
			ft.Strict = fn.Strict
		}
		if fn.Description.Valid() {
			ft.Description = fn.Description
		}
		out = append(out, responses.ToolUnionParam{OfFunction: ft})
	}
	return out
}

func responsesUserItem(text string, images, files []string) responses.ResponseInputItemUnionParam {
	if len(images) == 0 && len(files) == 0 {
		return responses.ResponseInputItemParamOfMessage(text, responses.EasyInputMessageRoleUser)
	}
	content := responses.ResponseInputMessageContentListParam{}
	if text != "" {
		content = append(content, responses.ResponseInputContentParamOfInputText(text))
	}
	for _, url := range images {
		content = append(content, responses.ResponseInputContentUnionParam{
			OfInputImage: &responses.ResponseInputImageParam{
				ImageURL: openai.String(url),
				Detail:   responses.ResponseInputImageDetailAuto,
			},
		})
	}
	for i, data := range files {
		clean, mime, ok := sanitizeFileDataURL(data)
		if !ok {
			log.Info("Responses API: dropping unsupported file part", "index", i, "mime", mime)
			content = append(content, responses.ResponseInputContentParamOfInputText(
				fmt.Sprintf("[file-%d (%s) omitted: unsupported file type]", i+1, mime)))
			continue
		}
		content = append(content, responses.ResponseInputContentUnionParam{
			OfInputFile: &responses.ResponseInputFileParam{
				FileData: openai.String(clean),
				Filename: openai.String(fmt.Sprintf("file-%d%s", i+1, extForMIME(mime))),
			},
		})
	}
	if len(content) == 0 {
		return responses.ResponseInputItemParamOfMessage(text, responses.EasyInputMessageRoleUser)
	}
	return responses.ResponseInputItemParamOfMessage(content, responses.EasyInputMessageRoleUser)
}

func toResponsesInput(model string, messages []SimpleMessage) responses.ResponseInputParam {
	items := make(responses.ResponseInputParam, 0, len(messages)+4)
	for _, msg := range messages {
		switch msg.Role {
		case "system":
			items = append(items, responses.ResponseInputItemParamOfMessage(msg.Content, responses.EasyInputMessageRoleSystem))

		case "user":
			items = append(items, responsesUserItem(msg.Content, msg.Images, msg.Files))

		case "assistant":
			hasCall := msg.ToolCall.ID != "" || msg.ToolCall.ReferenceID != ""
			if hasCall {
				// Replay encrypted reasoning first (same order the model produced it).
				for _, raw := range decodeResponsesReasoning(model, msg.ToolCall.ThoughtSignature) {
					items = append(items, param.Override[responses.ResponseInputItemUnionParam](raw))
				}
			}
			if strings.TrimSpace(msg.Content) != "" {
				items = append(items, responses.ResponseInputItemParamOfMessage(msg.Content, responses.EasyInputMessageRoleAssistant))
			}
			if hasCall {
				args := msg.ToolCall.Args
				if strings.TrimSpace(args) == "" {
					args = "{}"
				}
				items = append(items, responses.ResponseInputItemParamOfFunctionCall(args, responsesCallID(msg.ToolCall), msg.ToolCall.Name))
			}

		case "tool":
			items = append(items, responses.ResponseInputItemParamOfFunctionCallOutput(responsesCallID(msg.ToolCall), msg.ToolCall.Output))
			// Tool-produced images/files go in a follow-up user message, as in chat completions.
			if len(msg.Images) > 0 || len(msg.Files) > 0 {
				items = append(items, responsesUserItem(toolMediaFollowUpText(msg), msg.Images, msg.Files))
			}
		}
	}
	return items
}

func responsesCallID(tc ToolCall) string {
	if tc.ReferenceID != "" {
		return capToolCallID(tc.ReferenceID)
	}
	return capToolCallID(tc.ID)
}

func formatResponsesError(err error) error {
	var apiErr *openai.Error
	if errors.As(err, &apiErr) {
		log.Info("Responses API error details",
			"status", apiErr.StatusCode,
			"code", apiErr.Code,
			"message", apiErr.Message,
			"raw", apiErr.RawJSON(),
		)
		msg := apiErr.Message
		if msg == "" {
			msg = err.Error()
		}
		if apiErr.Code != "" {
			return fmt.Errorf("%d %s - %s", apiErr.StatusCode, apiErr.Code, msg)
		}
		return fmt.Errorf("%d %s", apiErr.StatusCode, msg)
	}
	return err
}

func sendResponsesStream(ctx context.Context, client openai.Client, model string, params RequestParams, sc utils.StreamClient) (*ChatCompletionMessage, error) {
	req := responses.ResponseNewParams{
		Model: shared.ResponsesModel(model),
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: toResponsesInput(model, params.Messages),
		},
		Store:   openai.Bool(false),
		Include: []responses.ResponseIncludable{responses.ResponseIncludableReasoningEncryptedContent},
		Reasoning: shared.ReasoningParam{
			Effort: responsesEffort(params.ReasoningEffort),
			// If your org is not verified for reasoning summaries, delete this line.
			Summary: shared.ReasoningSummaryAuto,
		},
	}
	if len(params.Tools) > 0 {
		req.Tools = toResponsesTools(params.Tools)
	}

	log.Info("Responses API request parameters",
		"model", model,
		"tools", len(req.Tools),
		"reasoning_effort", string(responsesEffort(params.ReasoningEffort)),
		"input_items", len(req.Input.OfInputItemList),
	)

	utils.AddStreamHeaders(sc.Writer)

	stream := client.Responses.NewStreaming(ctx, req)

	var content, reasoning strings.Builder
	var toolCalls []ToolCall
	var reasoningItems []json.RawMessage
	var eventErr error
	start := time.Now()

	sendReasoning := func(delta string) {
		if delta == "" {
			return
		}
		reasoning.WriteString(delta)
		utils.SendStreamChunk(sc, utils.StreamChunk{Payload: delta, Type: utils.REASONING})
	}

	for stream.Next() {
		ev := stream.Current()
		switch e := ev.AsAny().(type) {
		case responses.ResponseTextDeltaEvent:
			if e.Delta != "" {
				content.WriteString(e.Delta)
				utils.SendStreamChunk(sc, utils.StreamChunk{Payload: e.Delta, Type: utils.CONTENT})
			}

		case responses.ResponseReasoningSummaryTextDeltaEvent:
			sendReasoning(e.Delta)

		case responses.ResponseReasoningTextDeltaEvent:
			sendReasoning(e.Delta)

		case responses.ResponseReasoningSummaryPartDoneEvent:
			sendReasoning("\n\n")

		case responses.ResponseOutputItemDoneEvent:
			switch e.Item.Type {
			case "reasoning":
				reasoningItems = append(reasoningItems, json.RawMessage(e.Item.RawJSON()))

			case "function_call":
				fc := e.Item.AsFunctionCall()
				tc := ToolCall{
					ID:          uuid.New().String(),
					ReferenceID: fc.CallID,
					Name:        fc.Name,
					Args:        fc.Arguments,
				}
				// Stash encrypted reasoning on the first tool call of this response.
				if len(toolCalls) == 0 {
					tc.ThoughtSignature = encodeResponsesReasoning(model, reasoningItems)
				}
				toolCalls = append(toolCalls, tc)
				utils.SendStreamChunk(sc, utils.StreamChunk{Type: utils.TOOL_CALL, Payload: tc})
			}

		case responses.ResponseCompletedEvent:
			log.Info("Responses API usage",
				"input_tokens", e.Response.Usage.InputTokens,
				"output_tokens", e.Response.Usage.OutputTokens,
				"reasoning_tokens", e.Response.Usage.OutputTokensDetails.ReasoningTokens,
				"server_effort", string(e.Response.Reasoning.Effort),
				"server_model", e.Response.Model,
			)

		case responses.ResponseFailedEvent:
			eventErr = fmt.Errorf("response failed: %s - %s", e.Response.Error.Code, e.Response.Error.Message)

		case responses.ResponseErrorEvent:
			eventErr = fmt.Errorf("response error: %s - %s", e.Code, e.Message)
		}
	}

	cancelled := isContextCanceled(ctx.Err()) || isContextCanceled(stream.Err())
	log.Info("Responses stream ended",
		"duration", time.Since(start),
		"streamErr", stream.Err(),
		"eventErr", eventErr,
		"cancelled", cancelled,
		"tool_calls", len(toolCalls),
	)

	if !cancelled {
		if err := stream.Err(); err != nil {
			return nil, formatResponsesError(err)
		}
		if eventErr != nil {
			return nil, eventErr
		}
	}

	return &ChatCompletionMessage{
		Content:   content.String(),
		Reasoning: reasoning.String(),
		ToolCalls: toolCalls,
		Cancelled: cancelled,
	}, nil
}

// sanitizeFileDataURL makes a data URL acceptable to /v1/responses, which
// rejects application/octet-stream. It sniffs the real type; text-like content
// becomes text/plain. Returns ok=false when the file should be omitted.
func sanitizeFileDataURL(data string) (string, string, bool) {
	if !strings.HasPrefix(data, "data:") {
		return data, "", false
	}
	comma := strings.Index(data, ",")
	if comma < 0 {
		return data, "", false
	}
	header := data[len("data:"):comma]
	mime := strings.ToLower(strings.TrimSpace(strings.Split(header, ";")[0]))
	if mime != "" && mime != "application/octet-stream" && mime != "binary/octet-stream" {
		return data, mime, true
	}
	if !strings.Contains(header, ";base64") {
		return data, mime, false
	}
	raw, err := base64.StdEncoding.DecodeString(data[comma+1:])
	if err != nil {
		return data, mime, false
	}
	sniff := raw
	if len(sniff) > 8192 {
		sniff = sniff[:8192]
	}
	detected := strings.ToLower(strings.Split(http.DetectContentType(sniff), ";")[0])
	switch {
	case detected == "application/pdf", strings.HasPrefix(detected, "image/"):
		return "data:" + detected + ";base64," + data[comma+1:], detected, true
	case strings.HasPrefix(detected, "text/"), looksLikeText(sniff):
		return "data:text/plain;base64," + data[comma+1:], "text/plain", true
	}
	return data, "application/octet-stream", false
}

func looksLikeText(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	// Trim a possibly cut multi-byte rune at the end of the sniff window.
	for i := 0; i < 3 && len(b) > 0 && !utf8.Valid(b); i++ {
		b = b[:len(b)-1]
	}
	if !utf8.Valid(b) {
		return false
	}
	for _, c := range b {
		if c == 0 {
			return false
		}
	}
	return true
}

func extForMIME(mime string) string {
	switch mime {
	case "text/plain":
		return ".txt"
	case "text/csv":
		return ".csv"
	case "application/json":
		return ".json"
	case "application/pdf":
		return ".pdf"
	case "text/html":
		return ".html"
	case "text/markdown":
		return ".md"
	}
	return ""
}

// responsesEffort defaults to RESPONSES_DEFAULT_EFFORT (or "high") when the UI sends none.
func responsesEffort(e openai.ReasoningEffort) openai.ReasoningEffort {
	if e != "" {
		return e
	}
	if v := strings.TrimSpace(os.Getenv("RESPONSES_DEFAULT_EFFORT")); v != "" {
		return openai.ReasoningEffort(v)
	}
	return openai.ReasoningEffortHigh
}
