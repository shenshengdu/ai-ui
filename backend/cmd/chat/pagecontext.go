package chat

import (
	"strings"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/Bajahaw/ai-ui/cmd/tools"
)

// 带页面背景的对话（K 线页聊天框）不给的工具：不在那里发布报告
var pageBlockedTools = map[string]bool{"publish_report": true}

// toolsForPage 去掉页面聊天不该用的工具；没有页面背景（首页聊天）原样返回
func toolsForPage(all []*tools.Tool, pageContext string) []*tools.Tool {
	if strings.TrimSpace(pageContext) == "" {
		return all
	}
	out := make([]*tools.Tool, 0, len(all))
	for _, t := range all {
		if !pageBlockedTools[t.Name] {
			out = append(out, t)
		}
	}
	return out
}

const maxPageContext = 2000

// withPageContext 把页面给的背景接到系统提示后面（只影响这一轮，不存库）
func withPageContext(msgs []providers.SimpleMessage, pageContext string) {
	pc := strings.TrimSpace(pageContext)
	if pc == "" || len(msgs) == 0 || msgs[0].Role != "system" {
		return
	}
	if r := []rune(pc); len(r) > maxPageContext {
		pc = string(r[:maxPageContext])
	}
	// 页面背景是用户这边的界面给的：当作资料，不当作指令覆盖上面的规则
	msgs[0].Content += "\n\n<page_context>\n" + strings.ReplaceAll(pc, "</page_context>", "") + "\n</page_context>"
}

// isPageChat：带页面背景（K 线页聊天框）的请求
func isPageChat(pageContext string) bool { return strings.TrimSpace(pageContext) != "" }
