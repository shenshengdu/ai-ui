package chat

import (
	"strings"

	"github.com/Bajahaw/ai-ui/cmd/providers"
)

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
