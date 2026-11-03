package tools

// finance_account：用户自己的 IBKR 账户数据（Finance Platform /api/v1/ibkr/*，来自 Activity Flex Query 的日终数据）。

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var financeDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var financeAccountKinds = map[string]bool{
	"trades": true, "cash": true, "transfers": true, "commissions": true, "fees": true, "corporate": true,
}

func financeAccountTools() []*Tool {
	return []*Tool{
		{
			ID:   uuid.New().String(),
			Name: "finance_account",
			Description: "查询用户自己的 IBKR（盈透）账户数据。数据来自 IBKR Activity Flex Query，是日终数据（截至返回的 as_of 那个交易日收盘），不是实时的：回答时写明“截至 {as_of} 收盘”，不得说成实时余额；金额注明币种。" +
				"view：summary=账户概况（净值、现金、前 15 大持仓、最近一天净值变化、MTD/YTD、今年股息利息），问账户/持仓/余额时优先用；" +
				"portfolio=全部持仓、各币种现金、净值构成、账户信息；performance=净值变化、MTD/YTD、按股票的已实现/未实现盈亏、MTM、最近 30 天净值；" +
				"income=股息、代扣税、利息汇总（默认今年）及股息/利息应计、外汇余额；transactions=交易和流水明细（kind 选种类，可按 symbol、日期过滤）。" +
				"只引用返回的数字，不得自行估算持仓市值或收益；返回 error 或 accounts 为空时如实说明还没有数据。不给买卖建议。",
			InputSchema: `{"type":"object","properties":{` +
				`"view":{"type":"string","enum":["summary","portfolio","performance","income","transactions"],"description":"要看的内容，默认 summary"},` +
				`"kind":{"type":"string","enum":["trades","cash","transfers","commissions","fees","corporate"],"description":"view=transactions 时：trades 交易、cash 资金流水、transfers 转账、commissions 佣金、fees 交易费用、corporate 公司行动。默认 trades"},` +
				`"symbol":{"type":"string","description":"可选：只看某只股票，如 AAPL"},` +
				`"from":{"type":"string","description":"可选：开始日期 YYYY-MM-DD（income、transactions）"},` +
				`"to":{"type":"string","description":"可选：结束日期 YYYY-MM-DD（income、transactions）"},` +
				`"limit":{"type":"integer","minimum":1,"maximum":500,"description":"可选：transactions 最多返回几条，默认 100"}` +
				`},"additionalProperties":false}`,
			IsEnabled: true,
		},
	}
}

// financeAccountPath 把 finance_account 的参数换成 Finance Platform 的路径。
func financeAccountPath(view, kind, symbol, from, to string, limit int) (string, error) {
	q := url.Values{}
	for name, d := range map[string]string{"from": from, "to": to} {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		if !financeDateRe.MatchString(d) {
			return "", fmt.Errorf("invalid %s date %q (use YYYY-MM-DD)", name, d)
		}
		q.Set(name, d)
	}
	switch strings.TrimSpace(view) {
	case "", "summary":
		return "/api/v1/ibkr/summary", nil
	case "portfolio":
		return "/api/v1/ibkr/portfolio", nil
	case "performance":
		return "/api/v1/ibkr/performance", nil
	case "income":
		if len(q) > 0 {
			return "/api/v1/ibkr/income?" + q.Encode(), nil
		}
		return "/api/v1/ibkr/income", nil
	case "transactions":
		kind = strings.TrimSpace(kind)
		if kind == "" {
			kind = "trades"
		}
		if !financeAccountKinds[kind] {
			return "", fmt.Errorf("invalid kind %q", kind)
		}
		q.Set("kind", kind)
		if strings.TrimSpace(symbol) != "" {
			sym, ok := normalizeSymbol(symbol)
			if !ok {
				return "", fmt.Errorf("invalid stock symbol: %q", symbol)
			}
			q.Set("symbol", sym)
		}
		if limit < 1 || limit > 500 {
			limit = 100
		}
		q.Set("limit", fmt.Sprint(limit))
		return "/api/v1/ibkr/transactions?" + q.Encode(), nil
	}
	return "", fmt.Errorf("invalid view %q", view)
}
