package tools

// Lightweight Finance Platform tools:
//   finance_quote          -> GET /api/v1/quote/{symbol}  (single-stock snapshot)
//   finance_global_market  -> GET /api/v1/market          (global close snapshot)
// The HTTP request, auth and error handling are done by financeTool() in finance.go;
// this file only defines the tools and condenses the JSON into short text for the model.

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/google/uuid"
)

func financeQuickTools() []*Tool {
	return []*Tool{
		{
			ID:          uuid.New().String(),
			Name:        "finance_quote",
			Description: "获取个股最新行情快照（轻量、快速）：现价/收盘价、前收盘、涨跌额与涨跌幅、开盘/最高/最低，并已把数据时间换算为美东交易日、给出市场状态（已收盘/盘中/今日休市/尚未开盘）。用户只问股价、收盘价、今天涨还是跌、当天行情时使用本工具，不要调用 finance_stock。返回的数字与状态直接引用，不要自行重算；本接口不含成交量，回答里直接省略，不要说明“未提供”。只回答被问到的股票，不要附带大盘或全球市场数据。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码，例如 AAPL、NVDA、MSFT、TSLA。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_global_market",
			Description: "获取全球金融市场收盘快照（轻量、快速）：美股主要指数与 VIX、A股/港股、亚太、欧洲指数、汇率、大宗商品（黄金/原油/铜）、美债收益率，以及各地区强弱汇总与风险情绪。只在用户问整体市场时使用，如“今日/最近金融市场怎么样”“全球市场今天如何”“美股昨晚怎么样”；用户只问某只股票的行情（如“NOW 今天行情怎么样”）时不要调用。各市场收盘日不同，引用涨跌必须带日期；美债变动是百分点；本工具不含新闻，不得据此推测涨跌原因或给出买卖建议。",
			InputSchema: `{"type":"object","properties":{},"additionalProperties":false}`,
			IsEnabled:   true,
		},
	}
}

func fqNum(v *float64, prec int) string {
	if v == nil || math.IsNaN(*v) {
		return "n/a"
	}
	return fmt.Sprintf("%.*f", prec, *v)
}

func fqSigned(v *float64, prec int) string {
	if v == nil || math.IsNaN(*v) {
		return "n/a"
	}
	return fmt.Sprintf("%+.*f", prec, *v)
}

func fqArrow(v *float64) string {
	switch {
	case v == nil:
		return ""
	case *v > 0:
		return "▲"
	case *v < 0:
		return "▼"
	default:
		return "="
	}
}

func nyLocation() *time.Location {
	if loc, err := time.LoadLocation("America/New_York"); err == nil {
		return loc
	}
	return time.FixedZone("ET", -4*3600)
}

func formatFinanceQuote(body []byte) string {
	var q struct {
		Status        string   `json:"status"`
		Symbol        string   `json:"symbol"`
		Price         *float64 `json:"price"`
		Open          *float64 `json:"open"`
		High          *float64 `json:"high"`
		Low           *float64 `json:"low"`
		PrevClose     *float64 `json:"prev_close"`
		Change        *float64 `json:"change"`
		ChangePercent *float64 `json:"change_percent"`
		Timestamp     int64    `json:"timestamp"`
		Source        string   `json:"source"`
	}
	if err := json.Unmarshal(body, &q); err != nil || q.Status != "success" || q.Price == nil || *q.Price == 0 {
		return "Finance Platform quote unavailable: " + truncateRunes(string(body), 300)
	}

	change, pct := q.Change, q.ChangePercent
	note := ""
	if change == nil && q.PrevClose != nil && *q.PrevClose != 0 {
		c := *q.Price - *q.PrevClose
		p := c / *q.PrevClose * 100
		change, pct = &c, &p
		note = " (computed from price - previous close)"
	}

	ny := nyLocation()
	now := time.Now().In(ny)
	priceLabel := "Latest price"
	tradeLine := "Trading date (US Eastern): unknown (no timestamp returned)"
	statusLine := "Market status: unknown"
	dataTime := "unknown"

	if q.Timestamp > 0 {
		ts := time.Unix(q.Timestamp, 0).In(ny)
		sameDay := ts.Format("2006-01-02") == now.Format("2006-01-02")
		tsMin := ts.Hour()*60 + ts.Minute()
		nowMin := now.Hour()*60 + now.Minute()
		weekend := now.Weekday() == time.Saturday || now.Weekday() == time.Sunday
		var status string
		switch {
		case sameDay && tsMin >= 16*60:
			status, priceLabel = "closed - this is today's closing price", "Close"
		case sameDay && tsMin >= 9*60+30 && nowMin < 16*60:
			status, priceLabel = fmt.Sprintf("intraday - price as of %s ET, NOT a closing price", ts.Format("15:04")), "Price (intraday)"
		case sameDay && tsMin >= 9*60+30:
			status = fmt.Sprintf("session ended; last data at %s ET may not be the final close", ts.Format("15:04"))
		case weekend:
			status, priceLabel = "US market is closed today (weekend); figures are the latest trading day's close", "Close"
		case nowMin < 9*60+30:
			status, priceLabel = fmt.Sprintf("US market has not opened yet today (now %s ET); figures are the latest trading day's close", now.Format("15:04")), "Close"
		default:
			status = "no data for today's session yet (possible holiday or data delay); figures are from the latest trading day"
		}
		tradeLine = fmt.Sprintf("Trading date (US Eastern): %s (%s)", ts.Format("2006-01-02"), ts.Format("Mon"))
		statusLine = "Market status: " + status
		dataTime = ts.Format("2006-01-02 15:04") + " ET"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%s quote\n", q.Symbol)
	b.WriteString(tradeLine + "\n")
	b.WriteString(statusLine + "\n")
	fmt.Fprintf(&b, "%s: %s\n", priceLabel, fqNum(q.Price, 2))
	fmt.Fprintf(&b, "Previous close: %s\n", fqNum(q.PrevClose, 2))
	fmt.Fprintf(&b, "Change vs previous close: %s %s (%s%%)%s\n", fqArrow(change), fqSigned(change, 2), fqSigned(pct, 2), note)
	fmt.Fprintf(&b, "Open: %s | High: %s | Low: %s\n", fqNum(q.Open, 2), fqNum(q.High, 2), fqNum(q.Low, 2))
	fmt.Fprintf(&b, "Data time: %s | Now: %s ET | Source: %s\n", dataTime, now.Format("2006-01-02 15:04"), q.Source)
	b.WriteString("Use these numbers and the market status as-is; do not recompute them.")
	return b.String()
}

type gmItem struct {
	Name          string   `json:"name"`
	Close         *float64 `json:"close"`
	Change        *float64 `json:"change"`
	ChangePercent *float64 `json:"change_percent"`
	Date          string   `json:"date"`
	Unit          string   `json:"unit"`
	LagDays       int      `json:"lag_days"`
}

var gmGroups = []struct {
	key, title string
	order      []string
}{
	{"us", "美股", []string{"sp500", "nasdaq", "dow", "nasdaq100", "russell2000", "vix"}},
	{"china_hk", "A股/港股", []string{"shanghai", "shenzhen", "hang_seng"}},
	{"asia", "亚太", []string{"nikkei225", "kospi", "taiwan", "nifty50"}},
	{"europe", "欧洲", []string{"dax", "ftse100", "cac40"}},
	{"fx", "汇率", []string{"usd_jpy", "usd_cnh", "eur_usd"}},
	{"commodities", "大宗商品", []string{"gold", "wti", "brent", "copper"}},
	{"rates", "美债收益率", []string{"us10y", "us5y", "us13w"}},
}

func gmHas(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func gmLine(group string, it gmItem) string {
	lag := ""
	if it.LagDays > 0 {
		lag = fmt.Sprintf("，较最新数据滞后 %d 天", it.LagDays)
	}
	if group == "rates" {
		bp := "n/a"
		if it.Change != nil {
			bp = fmt.Sprintf("%+.1f bp", *it.Change*100)
		}
		return fmt.Sprintf("%s %s%% %s %s 个百分点（%s）[%s%s]", it.Name, fqNum(it.Close, 3), fqArrow(it.Change), fqSigned(it.Change, 3), bp, it.Date, lag)
	}
	prec := 2
	if group == "fx" {
		prec = 4
	}
	return fmt.Sprintf("%s %s %s %s (%s%%) [%s%s]", it.Name, fqNum(it.Close, prec), fqArrow(it.Change), fqSigned(it.Change, prec), fqSigned(it.ChangePercent, 2), it.Date, lag)
}

func formatGlobalMarket(body []byte) string {
	var r struct {
		Status      string                       `json:"status"`
		Date        string                       `json:"date"`
		DataDate    string                       `json:"data_date"`
		Source      string                       `json:"source"`
		Count       int                          `json:"count"`
		Expected    int                          `json:"expected_count"`
		Data        map[string]map[string]gmItem `json:"data"`
		Summary     map[string]map[string]any    `json:"summary"`
		DataContext struct {
			Issues []json.RawMessage `json:"issues"`
			Rules  []string          `json:"ai_interpretation_rules"`
		} `json:"data_context"`
	}
	if err := json.Unmarshal(body, &r); err != nil || r.Status != "success" || len(r.Data) == 0 {
		return "Finance Platform market snapshot unavailable: " + truncateRunes(string(body), 300)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Global market snapshot - latest close of each market (request date %s, latest data date %s, items %d/%d, source %s)\n",
		r.Date, r.DataDate, r.Count, r.Expected, r.Source)

	for _, g := range gmGroups {
		items := r.Data[g.key]
		if len(items) == 0 {
			continue
		}
		keys := append([]string{}, g.order...)
		var extra []string
		for k := range items {
			if !gmHas(g.order, k) {
				extra = append(extra, k)
			}
		}
		sort.Strings(extra)
		keys = append(keys, extra...)

		fmt.Fprintf(&b, "\n[%s]", g.title)
		if s, ok := r.Summary[g.key]; ok {
			if st, ok := s["state"].(string); ok && st != "" {
				fmt.Fprintf(&b, " 地区汇总: %s", st)
				adv, ok1 := s["advance"].(float64)
				dec, ok2 := s["decline"].(float64)
				if ok1 && ok2 {
					fmt.Fprintf(&b, "（上涨 %.0f / 下跌 %.0f）", adv, dec)
				}
			}
		}
		b.WriteString("\n")
		for _, k := range keys {
			if it, ok := items[k]; ok {
				b.WriteString("- " + gmLine(g.key, it) + "\n")
			}
		}
	}

	if risk, ok := r.Summary["risk"]; ok {
		if st, ok := risk["state"].(string); ok && st != "" {
			fmt.Fprintf(&b, "\n风险情绪: %s\n", st)
		}
	}
	if len(r.DataContext.Issues) > 0 {
		b.WriteString("\nData issues (must be mentioned):\n")
		for _, is := range r.DataContext.Issues {
			b.WriteString("- " + truncateRunes(string(is), 200) + "\n")
		}
	}
	if len(r.DataContext.Rules) > 0 {
		b.WriteString("\nInterpretation rules:\n")
		for _, rule := range r.DataContext.Rules {
			b.WriteString("- " + rule + "\n")
		}
	}
	return b.String()
}
