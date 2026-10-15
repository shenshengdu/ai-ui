package chat

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/Bajahaw/ai-ui/cmd/utils"
)

// Tool-call budget for one assistant turn (protects against endless agent loops).
//
//   AGENT_MAX_TOOL_CALLS   soft limit (default 15): once reached, the model is told
//                          to stop calling tools and answer with what it has.
//   AGENT_HARD_TOOL_CALLS  hard limit (default soft+5): further tool calls are not
//                          executed and the turn ends with a notice.

const toolBudgetMarker = "[tool-budget]"

func envInt(key string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key))); err == nil && n > 0 {
		return n
	}
	return def
}

func toolBudgetLimits() (soft, hard int) {
	soft = envInt("AGENT_MAX_TOOL_CALLS", 15)
	hard = envInt("AGENT_HARD_TOOL_CALLS", soft+5)
	if hard < soft {
		hard = soft
	}
	return
}

// toolCallsThisTurn counts tool results since the last real user message.
func toolCallsThisTurn(msgs []providers.SimpleMessage) (count int, warned bool) {
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role == "user" {
			if strings.HasPrefix(m.Content, toolBudgetMarker) {
				warned = true
				continue
			}
			break
		}
		if m.Role == "tool" {
			count++
		}
	}
	return
}

// applyToolBudget appends a one-time instruction asking the model to finish
// once the soft limit is reached.
func applyToolBudget(p providers.RequestParams) providers.RequestParams {
	p = applyDupBudget(p)
	soft, _ := toolBudgetLimits()
	n, warned := toolCallsThisTurn(p.Messages)
	if n < soft || warned {
		return p
	}
	log.Info("Tool budget reached, asking model to answer", "tool_calls", n, "limit", soft, "model", p.Model)
	p.Messages = append(p.Messages, providers.SimpleMessage{
		Role: "user",
		Content: fmt.Sprintf("%s 本轮已调用工具 %d 次，已达到上限。请不要再调用任何工具，"+
			"直接基于目前已获得的信息给出最终回答，并说明哪些信息不完整或未能核实。", toolBudgetMarker, n),
	})
	return p
}

// toolBudgetExhausted reports whether further tool calls must not run; it also
// tells the user why the answer stops here.
func toolBudgetExhausted(p providers.RequestParams, sc utils.StreamClient) bool {
	_, hard := toolBudgetLimits()
	n, _ := toolCallsThisTurn(p.Messages)
	if n < hard {
		return false
	}
	log.Info("Tool hard limit reached, stopping agent loop", "tool_calls", n, "limit", hard, "model", p.Model)
	utils.SendStreamChunk(sc, utils.StreamChunk{
		Type:    utils.CONTENT,
		Payload: fmt.Sprintf("\n\n> ⚠️ 本轮工具调用已达上限（%d 次），已停止继续检索，以上回答可能不完整。可以把问题拆小或说得更具体后再问。\n", n),
	})
	return true
}
