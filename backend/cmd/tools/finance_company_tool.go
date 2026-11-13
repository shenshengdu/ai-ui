package tools

// finance_company：AI 查公司公告（带原文链接）和主要财务（最近 5 年）
//   kind=announcements -> GET /api/v1/company/{symbol}/announcements?limit=
//   kind=financials    -> GET /api/v1/company/{symbol}/financials?limit=40（只给最近 5 年）
// A 股巨潮资讯、港股披露易、美股 SEC；财务 A/港股东方财富、美股 SEC。压成短文本给模型，省 token。

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

func financeCompanyTools() []*Tool {
	return []*Tool{{
		ID:   uuid.New().String(),
		Name: "finance_company",
		Description: "查公司公告和主要财务（A 股、港股、美股都支持）。kind=announcements：最近的公告 / 申报列表（时间、类别、标题、原文链接；A 股来自巨潮资讯，港股来自港交所披露易，美股来自 SEC EDGAR），用于解读近期公告、找催化剂和风险事件；" +
			"引用公告时给出标题和原文链接，只根据标题和类别判断，没读原文就不要编造公告里的具体内容。kind=financials：最近 5 年各报告期的营收、营收同比、净利润、净利润同比、EPS、ROE、毛利率、每股净资产；" +
			"注意金额是年初至今累计（A 股三季报 = 前三季度合计），美股按公司财年（Q1–Q3 季报、年报）；比较时只拿同类型报告期比（三季报比三季报）。数字原样引用并带报告期，不要自行重算。",
		InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码：美股 AAPL、A 股 600519.SH / 000001.SZ、港股 0700.HK"},` +
			`"kind":{"type":"string","enum":["announcements","financials"],"description":"announcements 公告；financials 主要财务"},` +
			`"limit":{"type":"integer","description":"公告条数，默认 30，最多 60"}},"required":["symbol","kind"],"additionalProperties":false}`,
		IsEnabled: true,
	}}
}

func financeCompanyPath(symbol, kind string, limit int) (string, error) {
	sym, ok := normalizeSymbol(symbol)
	if !ok {
		return "", fmt.Errorf("invalid stock symbol: %q", symbol)
	}
	switch kind {
	case "announcements":
		if limit < 1 || limit > 60 {
			limit = 30
		}
		return fmt.Sprintf("/api/v1/company/%s/announcements?limit=%d", sym, limit), nil
	case "financials":
		return fmt.Sprintf("/api/v1/company/%s/financials?limit=40", sym), nil
	}
	return "", fmt.Errorf("kind 只能是 announcements 或 financials")
}

func fcNum(v *float64, scale float64, prec int) string {
	if v == nil {
		return "-"
	}
	return fmt.Sprintf("%.*f", prec, *v/scale)
}

func formatFinanceCompany(kind string, body []byte, now time.Time) string {
	if kind == "announcements" {
		var d struct {
			Symbol        string `json:"symbol"`
			Source        string `json:"source"`
			Note          string `json:"note"`
			Backfilling   bool   `json:"backfilling"`
			Announcements []struct {
				Time     string `json:"time"`
				Title    string `json:"title"`
				Category string `json:"category"`
				URL      string `json:"url"`
			} `json:"announcements"`
		}
		if err := json.Unmarshal(body, &d); err != nil {
			return "公告数据解析失败：" + truncateRunes(string(body), 300)
		}
		var b strings.Builder
		fmt.Fprintf(&b, "%s 公告（来源 %s，%d 条，新→旧）\n", d.Symbol, d.Source, len(d.Announcements))
		if d.Note != "" {
			b.WriteString("说明：" + d.Note + "\n")
		}
		if d.Backfilling {
			b.WriteString("注意：正在补这只股票近 3 年的历史公告，这次只有最近几天的，回答时说明这一点。\n")
		}
		for _, a := range d.Announcements {
			cat := a.Category
			if cat == "" {
				cat = "-"
			}
			fmt.Fprintf(&b, "%s | %s | %s | %s\n", a.Time, cat, a.Title, a.URL)
		}
		if len(d.Announcements) == 0 {
			b.WriteString("（没有公告）\n")
		}
		return b.String()
	}
	var d struct {
		Symbol string `json:"symbol"`
		Source string `json:"source"`
		Rows   []struct {
			ReportDate   string   `json:"report_date"`
			PeriodType   *string  `json:"period_type"`
			AnnDate      *string  `json:"ann_date"`
			Currency     *string  `json:"currency"`
			Revenue      *float64 `json:"revenue"`
			RevenueYoy   *float64 `json:"revenue_yoy"`
			NetProfit    *float64 `json:"net_profit"`
			NetProfitYoy *float64 `json:"net_profit_yoy"`
			EPS          *float64 `json:"eps"`
			ROE          *float64 `json:"roe"`
			GrossMargin  *float64 `json:"gross_margin"`
			BVPS         *float64 `json:"bvps"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return "财务数据解析失败：" + truncateRunes(string(body), 300)
	}
	cut := now.AddDate(-5, 0, 0).Format("2006-01-02")
	cur := ""
	var b strings.Builder
	var lines []string
	for _, r := range d.Rows {
		if r.ReportDate <= cut {
			continue
		}
		if cur == "" && r.Currency != nil {
			cur = *r.Currency
		}
		pt, ann := "-", "-"
		if r.PeriodType != nil && *r.PeriodType != "" {
			pt = *r.PeriodType
		}
		if r.AnnDate != nil && *r.AnnDate != "" {
			ann = *r.AnnDate
		}
		lines = append(lines, fmt.Sprintf("%s | %s | %s | %s | %s%% | %s | %s%% | %s | %s%% | %s%% | %s",
			r.ReportDate, pt, ann, fcNum(r.Revenue, 1e8, 2), fcNum(r.RevenueYoy, 1, 2), fcNum(r.NetProfit, 1e8, 2),
			fcNum(r.NetProfitYoy, 1, 2), fcNum(r.EPS, 1, 3), fcNum(r.ROE, 1, 2), fcNum(r.GrossMargin, 1, 2), fcNum(r.BVPS, 1, 2)))
	}
	if cur == "" {
		cur = "当地货币"
	}
	fmt.Fprintf(&b, "%s 主要财务（来源 %s，最近 5 年，新→旧；金额单位：亿 %s，年初至今累计）\n", d.Symbol, d.Source, cur)
	b.WriteString("报告期 | 类型 | 公告日 | 营收 | 营收同比 | 净利润 | 净利润同比 | EPS | ROE | 毛利率 | 每股净资产\n")
	if len(lines) == 0 {
		b.WriteString("（没有财务数据）\n")
	}
	b.WriteString(strings.Join(lines, "\n"))
	return b.String()
}
