package chat

import (
	"fmt"
	"os"
	"strings"

	"github.com/Bajahaw/ai-ui/cmd/providers"
)

// 被去重拦下的调用，其“结果”以此开头（见 dedupe.go）
const dupNotePrefix = "本轮已调用过 "
const dupStopMark = "重复调用已达上限"

// dupBlockedThisTurn：本轮（自上一条真实用户消息起）被去重拦下的调用次数，以及是否已发出过停止指令。
func dupBlockedThisTurn(msgs []providers.SimpleMessage) (count int, told bool) {
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role == "user" {
			if strings.HasPrefix(m.Content, toolBudgetMarker) {
				if strings.Contains(m.Content, dupStopMark) {
					told = true
				}
				continue
			}
			break
		}
		if m.Role == "tool" && strings.HasPrefix(m.ToolCall.Output, dupNotePrefix) {
			count++
		}
	}
	return
}

// applyDupBudget：模型对“已调用过”的提示视而不见、继续重复调用时（累计 AGENT_DUP_LIMIT 次，默认 2），
// 追加一条停止指令，并（默认）在后续请求里不再提供任何工具，迫使模型直接写报告。
// AGENT_DUP_STRIP_TOOLS=0 时只追加指令、不去掉工具（某些提供方在消息含 tool_calls 却不带 tools 时会报错）。
func applyDupBudget(p providers.RequestParams) providers.RequestParams {
	limit := envInt("AGENT_DUP_LIMIT", 2)
	n, told := dupBlockedThisTurn(p.Messages)
	if n < limit {
		return p
	}
	if !told {
		log.Info("Duplicate tool calls exceeded, asking model to answer", "blocked", n, "limit", limit, "model", p.Model)
		p.Messages = append(p.Messages, providers.SimpleMessage{
			Role: "user",
			Content: fmt.Sprintf("%s %s（%d 次）：所有需要的数据都已取得，不要再调用任何工具（包括 web_search 以外的 finance_* 工具），"+
				"现在直接按要求的格式撰写完整报告。", toolBudgetMarker, dupStopMark, n),
		})
	}
	if strings.TrimSpace(os.Getenv("AGENT_DUP_STRIP_TOOLS")) != "0" {
		p.Tools = nil
		if lv := strings.TrimSpace(os.Getenv("AGENT_DUP_REASONING")); lv != "keep" {
			if lv == "" {
				lv = "low"
			}
			p.ReasoningEffort = providers.ReasoningEffort(lv)
		}
	}
	return p
}
