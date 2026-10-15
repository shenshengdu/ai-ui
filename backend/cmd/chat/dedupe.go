package chat

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Bajahaw/ai-ui/cmd/providers"
)

const dupToolMarker = "[tool-budget]"

// toolDupKey：同一个 finance_* 取数工具、同一只股票，本轮只需要调一次，
// 与 market / days / theme / peer_symbols 等附加参数无关（报告流程里模型常带不同参数重复调用）。
func toolDupKey(tc providers.ToolCall) string {
	sym := ""
	var m map[string]any
	if json.Unmarshal([]byte(fmt.Sprint(tc.Args)), &m) == nil {
		if v, ok := m["symbol"].(string); ok {
			sym = strings.ToUpper(strings.TrimSpace(v))
		}
	}
	return tc.Name + "|" + sym
}

// duplicateToolCall：本轮（自上一条真实用户消息起）已成功调用过同一个 finance_* 取数工具（同一只股票）时，
// 返回提示文字而不再真正执行（保存类工具除外；上一次失败/超时的允许重试）。
func duplicateToolCall(msgs []providers.SimpleMessage, tc providers.ToolCall) (string, bool) {
	if !strings.HasPrefix(tc.Name, "finance_") || strings.Contains(tc.Name, "save") {
		return "", false
	}
	want := toolDupKey(tc)
	outputs := map[string]string{}
	var ids []string
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role == "user" {
			if strings.HasPrefix(m.Content, dupToolMarker) {
				continue
			}
			break
		}
		switch m.Role {
		case "tool":
			outputs[m.ToolCall.ID] = m.ToolCall.Output
		case "assistant":
			if m.ToolCall.Name == tc.Name && toolDupKey(m.ToolCall) == want {
				ids = append(ids, m.ToolCall.ID)
			}
		}
	}
	for _, id := range ids {
		out := outputs[id]
		if toolOutputFailed(out) {
			continue
		}
		log.Info("Duplicate tool call blocked", "name", tc.Name, "key", want)
		return "本轮已调用过 " + tc.Name + "（同一只股票），结果见上文该工具的返回。所有数据已经取全，请不要再调用任何 finance_* 工具，立即开始撰写报告正文。", true
	}
	return "", false
}

// toolOutputFailed：判断上一次调用是否失败（允许重试）。
// JSON 结果只看顶层 error/detail 字段（正常结果常带 "errors":[] 之类字段，不能按子串判断）；
// 非 JSON 的文本才按关键词判断。
func toolOutputFailed(out string) bool {
	t := strings.TrimSpace(out)
	if t == "" {
		return true
	}
	if t[0] == '{' {
		var m map[string]any
		if json.Unmarshal([]byte(t), &m) != nil {
			return false
		}
		for _, k := range []string{"error", "detail"} {
			if v, ok := m[k]; ok && v != nil && v != "" {
				return true
			}
		}
		return false
	}
	if t[0] == '[' {
		return false
	}
	head := t
	if len(head) > 300 {
		head = head[:300]
	}
	low := strings.ToLower(head)
	return strings.Contains(low, "error") || strings.Contains(low, "timeout") || strings.Contains(head, "超时") || strings.Contains(head, "失败")
}
