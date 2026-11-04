package tools

// finance_judgement：投资研判（Finance Platform /api/v1/judgement/{symbol}）。
// 规则在平台端（确定性）：投资价值与买入时机分开、缠论支撑压力、估值分位价格区间、IBKR 账户仓位约束。

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

func financeJudgementTools() []*Tool {
	return []*Tool{
		{
			ID:          uuid.New().String(),
			Name:        "finance_judgement",
			Description: "投资研判：某只股票现在能不能买、什么价位买、买多少、已持有的要不要加仓/持有/减仓/复查，以及缠论支撑位和压力位。平台用确定性规则把投资价值（基本面×估值）和买入时机（历史估值分位 40%/25% 价格区间、技术状态、财报前 7 天、大盘）分开判断，叠加 IBKR 账户约束（单只 ≤15% 净值、行业 ≤35%、浮亏 −15% 复查），给出结论 action、分批计划和 render.text。结论、价位、金额必须原样引用，你只解释冲突、逻辑、风险和机会。view=levels 只返回缠论支撑压力（快）。earnings.status 不是 confirmed 时可先 web_search 核实财报日，再用 earnings_date 重新调用。只做分析参考，买卖由用户决定。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码，例如 AAPL、NVDA"},"view":{"type":"string","enum":["full","levels"],"description":"full=完整研判（默认）；levels=只要缠论支撑/压力"},"earnings_date":{"type":"string","description":"可选：已核实的下次财报日 YYYY-MM-DD，覆盖平台推算"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
	}
}

// financeJudgementPath 把 finance_judgement 的参数换成 Finance Platform 的路径。
func financeJudgementPath(symbol, view, earningsDate string) (string, error) {
	sym, ok := normalizeSymbol(symbol)
	if !ok {
		return "", fmt.Errorf("invalid stock symbol: %q", symbol)
	}
	switch strings.TrimSpace(view) {
	case "levels":
		return "/api/v1/judgement/" + url.PathEscape(sym) + "/levels", nil
	case "", "full":
	default:
		return "", fmt.Errorf("invalid view %q (use full or levels)", view)
	}
	path := "/api/v1/judgement/" + url.PathEscape(sym)
	if d := strings.TrimSpace(earningsDate); d != "" {
		if !financeDateRe.MatchString(d) {
			return "", fmt.Errorf("invalid earnings_date %q (use YYYY-MM-DD)", d)
		}
		path += "?earnings_date=" + d
	}
	return path, nil
}
