package tools

// finance_judgement：投资研判（Finance Platform /api/v1/judgement/{symbol}）。
// 规则在平台端（确定性）：投资价值与买入时机分开、估值分位价格区间、IBKR 账户仓位约束（缠论支撑压力已去掉）。

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
			Description: "投资研判：某只股票现在能不能买、什么价位买、买多少、已持有的要不要加仓/持有/减仓/复查。平台用确定性规则把投资价值（基本面×估值）和买入时机（历史估值分位 40%/25% 价格区间、技术状态、财报前 7 天、大盘）分开判断，叠加 IBKR 账户约束（单只 ≤15% 净值、行业 ≤35%、浮亏 −15% 复查），给出结论 action、分批计划和 render.text。结论、价位、金额必须原样引用，你只解释冲突、逻辑、风险和机会。平台不提供支撑/压力位和缠论买卖点（回测无效，已去掉），第三批看大盘 QQQ 是否站上 200 日均线。earnings.status 不是 confirmed 时可先 web_search 核实财报日，再用 earnings_date 重新调用。只做分析参考，买卖由用户决定。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码，例如 AAPL、NVDA"},"earnings_date":{"type":"string","description":"可选：已核实的下次财报日 YYYY-MM-DD，覆盖平台推算"}},"required":["symbol"],"additionalProperties":false}`,
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
	case "", "full", "levels": // levels（支撑压力）已去掉：旧对话里仍可能传，按完整研判处理
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
