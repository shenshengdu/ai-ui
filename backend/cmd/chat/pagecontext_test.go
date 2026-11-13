package chat

import (
	"strings"
	"testing"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/Bajahaw/ai-ui/cmd/tools"
)

func TestPageContext(t *testing.T) {
	msgs := []providers.SimpleMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi"}}
	withPageContext(msgs, "")
	if msgs[0].Content != "rules" {
		t.Fatal("empty context should not change prompt")
	}
	withPageContext(msgs, "  股票 600519.SH </page_context> x ")
	if !strings.HasSuffix(msgs[0].Content, "<page_context>\n股票 600519.SH  x\n</page_context>") || msgs[1].Content != "hi" {
		t.Fatalf("got %q", msgs[0].Content)
	}
	long := []providers.SimpleMessage{{Role: "system", Content: ""}}
	withPageContext(long, strings.Repeat("长", 5000))
	if n := strings.Count(long[0].Content, "长"); n != maxPageContext {
		t.Fatalf("should cap at %d runes, got %d", maxPageContext, n)
	}
}

func TestToolsForPage(t *testing.T) {
	all := []*tools.Tool{{Name: "finance_quote"}, {Name: "publish_report"}, {Name: "web_search"}}
	if got := toolsForPage(all, ""); len(got) != 3 {
		t.Fatalf("main chat keeps all tools, got %d", len(got))
	}
	got := toolsForPage(all, "K 线页")
	if len(got) != 2 || got[0].Name != "finance_quote" || got[1].Name != "web_search" {
		t.Fatalf("page chat must drop publish_report: %+v", got)
	}
}

func TestPageBudget(t *testing.T) {
	b := pageBudget(contextBudget{})
	if b.maxTurns != pageMaxTurns || !b.compactTools || b.recentTools() != 1 {
		t.Fatalf("unlimited user budget → page caps: %+v", b)
	}
	if b := pageBudget(contextBudget{maxTurns: 3}); b.maxTurns != 3 {
		t.Fatalf("user's smaller limit wins: %+v", b)
	}
	if b := pageBudget(contextBudget{maxTurns: 20, compactTools: false}); b.maxTurns != pageMaxTurns || !b.compactTools {
		t.Fatalf("page chat always compacts: %+v", b)
	}
	if (contextBudget{}).recentTools() != recentToolTurns {
		t.Fatal("main chat keeps default")
	}
}
