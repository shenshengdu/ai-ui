package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 盘中「今天这一根」K 线：库里的日线要收盘后（北京 18:40）才有当天的，K 线页用这个临时拼上最后一根（不写库）。
// GET /api/tools/finance/live?symbol=002594.SZ
// A 股：交易所网站为主（深市 szse.cn、沪市 yunhq.sse.com.cn），失败退回腾讯；
// 港股：金融平台 /api/v1/markets/hk_live（富途实时优先，再老虎），拿不到用腾讯（盘中延迟约 15 分钟，delayed=true）；
// 美股：金融平台 /api/v1/markets/us_live（盘中 FMP 名单内 / Alpaca 现价 + Finnhub 开高低；收盘后 Finnhub）。
// 这些请求从本机发出，不占阿里云每日收盘同步（腾讯）的请求额度。

var (
	liveSZSEURL    = "https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code="
	liveSSEURL     = "http://yunhq.sse.com.cn:32041/v1/sh1/snap/"
	liveTencentURL = "https://qt.gtimg.cn/q="
	liveYahooURL   = "https://query1.finance.yahoo.com/v8/finance/chart/"
	liveHTTPClient = &http.Client{Timeout: 8 * time.Second}
	liveNow        = time.Now
)

// 6 位.SH/SZ（A 股）| 1–5 位.HK（港股）| 美股字母代码 | 雅虎代码：^ 开头的指数、=X 汇率、=F 期货
var liveSymbolRe = regexp.MustCompile(`^(\d{6})\.(SH|SS|SZ)$|^(\d{1,5})\.HK$|^([A-Z][A-Z0-9\-]{0,5}(\.[A-Z])?)$|^(\^[A-Z0-9.\-]{1,12}|[A-Z0-9.\-]{1,12}=[XF])$`)

const liveTTL = 15 * time.Second

type liveResp struct {
	Status    string    `json:"status"`
	Symbol    string    `json:"symbol"`
	Source    string    `json:"source,omitempty"`
	Bar       *klineBar `json:"bar,omitempty"`
	PrevClose *float64  `json:"prev_close,omitempty"`
	Time      string    `json:"time,omitempty"`      // 行情时间（北京）
	Trading   bool      `json:"trading"`             // 正在交易时段、而且是今天的行情：前端继续定时刷新
	Delayed   bool      `json:"delayed,omitempty"`   // 盘中但用的是延迟行情（港股腾讯约 15 分钟、雅虎的期货 / 海外指数）
	DelayMin  int       `json:"delay_min,omitempty"` // 延迟多少分钟
	Error     string    `json:"error,omitempty"`
}

type liveQuote struct {
	date, clock                    string // 2026-11-13, 14:59:58
	open, high, low, last, prev, v float64
	noVol                          bool   // 没有可靠的成交量（美股名单外）：不画
	trading                        *bool  // 数据源自己说在不在交易时段（美股、雅虎）
	today                          string // 那个市场当地的今天（和 date 比：是不是今天的行情）
	srcName                        string // 数据源名（一个 src 里可能是几家之一）
	delayMin                       int
}

var (
	liveCacheMu sync.Mutex
	liveCache   = map[string]struct {
		r  liveResp
		at time.Time
	}{}
)

var bjZone = time.FixedZone("CST", 8*3600)

func financeLive(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	m := liveSymbolRe.FindStringSubmatch(symbol)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if m == nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(liveResp{Status: "error", Symbol: symbol, Error: "只支持 A 股（600519.SH）、港股（0700.HK）和美股（AAPL）"})
		return
	}
	liveCacheMu.Lock()
	c, ok := liveCache[symbol]
	liveCacheMu.Unlock()
	if ok && liveNow().Sub(c.at) < liveTTL {
		_ = json.NewEncoder(w).Encode(c.r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	out := liveLookup(ctx, symbol, m)
	liveCacheMu.Lock()
	if len(liveCache) > 500 {
		liveCache = map[string]struct {
			r  liveResp
			at time.Time
		}{}
	}
	liveCache[symbol] = struct {
		r  liveResp
		at time.Time
	}{out, liveNow()}
	liveCacheMu.Unlock()
	_ = json.NewEncoder(w).Encode(out)
}

func liveLookup(ctx context.Context, symbol string, m []string) liveResp {
	type src struct {
		name string
		get  func() (*liveQuote, error)
	}
	var srcs []src
	hk := m[3] != ""
	us := m[4] != ""
	yahoo := m[6] != ""
	if yahoo { // 指数 / 汇率 / 期货：只有雅虎
		srcs = []src{{"雅虎", func() (*liveQuote, error) { return liveYahoo(ctx, m[6]) }}}
	} else if us { // 美股：雅虎优先（全部美股、全市场成交量、不要密钥），不行再金融平台（FMP / Alpaca+Finnhub）
		srcs = []src{{"雅虎", func() (*liveQuote, error) { return liveYahoo(ctx, m[4]) }},
			{"", func() (*liveQuote, error) { return liveUS(ctx, m[4]) }}}
	} else if hk {
		code := fmt.Sprintf("%05s", m[3])
		code = strings.ReplaceAll(code, " ", "0")
		srcs = []src{{"富途", func() (*liveQuote, error) { return liveTiger(ctx, code) }},
			{"腾讯", func() (*liveQuote, error) { return liveTencent(ctx, "hk"+code, true) }}}
	} else {
		code, ex := m[1], m[2]
		if ex == "SZ" {
			srcs = append(srcs, src{"深交所", func() (*liveQuote, error) { return liveSZSE(ctx, code) }})
			srcs = append(srcs, src{"腾讯", func() (*liveQuote, error) { return liveTencent(ctx, "sz"+code, false) }})
		} else {
			srcs = append(srcs, src{"上交所", func() (*liveQuote, error) { return liveSSE(ctx, code) }})
			srcs = append(srcs, src{"腾讯", func() (*liveQuote, error) { return liveTencent(ctx, "sh"+code, false) }})
		}
	}
	var lastErr error
	for _, s := range srcs {
		q, err := s.get()
		if err != nil {
			lastErr = err
			continue
		}
		if q == nil { // 还没开盘（集合竞价前）：没有今天的价
			return liveResp{Status: "success", Symbol: symbol, Source: s.name, Trading: liveSession(liveNow(), hk)}
		}
		o, h, l, c, v, p := q.open, q.high, q.low, q.last, q.v, q.prev
		var vp *float64
		if !q.noVol {
			vp = &v
		}
		name := s.name
		if q.srcName != "" {
			name = q.srcName
		}
		trading := false
		if q.trading != nil {
			trading = *q.trading && q.date == q.today
		} else {
			trading = q.date == liveNow().In(bjZone).Format("2006-01-02") && liveSession(liveNow(), hk)
		}
		delay := q.delayMin
		if hk && name == "腾讯" {
			delay = 15
		}
		return liveResp{Status: "success", Symbol: symbol, Source: name,
			Bar:       &klineBar{T: q.date, O: &o, H: &h, L: &l, C: &c, V: vp},
			PrevClose: &p, Time: q.date + " " + q.clock,
			Trading: trading, Delayed: delay > 0 && trading, DelayMin: delay}
	}
	msg := "实时行情取不到"
	if lastErr != nil {
		msg += "：" + lastErr.Error()
	}
	return liveResp{Status: "error", Symbol: symbol, Error: msg}
}

// 交易时段（北京，含集合竞价和收盘后几分钟）：A 股 9:15–15:05，港股 9:00–16:15
func liveSession(now time.Time, hk bool) bool {
	t := now.In(bjZone)
	if t.Weekday() == time.Saturday || t.Weekday() == time.Sunday {
		return false
	}
	m := t.Hour()*60 + t.Minute()
	if hk {
		return m >= 9*60 && m < 16*60+15
	}
	return m >= 9*60+15 && m < 15*60+5
}

func liveGet(ctx context.Context, u, referer string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := liveHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 256<<10))
}

func pf(s string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return f
}

// 深交所：{"data":{"now","open","high","low","close"(昨收),"volume"(手),"marketTime":"2026-11-13 15:30:00"}}
func liveSZSE(ctx context.Context, code string) (*liveQuote, error) {
	b, err := liveGet(ctx, liveSZSEURL+code, "https://www.szse.cn/market/trend/index.html")
	if err != nil {
		return nil, err
	}
	var d struct {
		Code string `json:"code"`
		Data *struct {
			Now, Open, High, Low, Close, MarketTime string
			Volume                                  json.Number
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &d); err != nil || d.Data == nil {
		return nil, fmt.Errorf("深交所返回格式不对")
	}
	x := d.Data
	if len(x.MarketTime) < 19 {
		return nil, fmt.Errorf("深交所没有行情时间")
	}
	last, open := pf(x.Now), pf(x.Open)
	if last <= 0 || open <= 0 {
		return nil, nil
	}
	vol, _ := x.Volume.Float64()
	return &liveQuote{date: x.MarketTime[:10], clock: x.MarketTime[11:19], open: open, high: pf(x.High), low: pf(x.Low),
		last: last, prev: pf(x.Close), v: vol * 100}, nil
}

// 上交所：{"date":20261113,"time":162901,"snap":[名称,昨收,今开,最高,最低,现价,涨跌,涨跌幅,成交量(股),成交额,...]}
func liveSSE(ctx context.Context, code string) (*liveQuote, error) {
	b, err := liveGet(ctx, liveSSEURL+code, "https://www.sse.com.cn/")
	if err != nil {
		return nil, err
	}
	var d struct {
		Date int64             `json:"date"`
		Time int64             `json:"time"`
		Snap []json.RawMessage `json:"snap"`
	}
	if err := json.Unmarshal(b, &d); err != nil || len(d.Snap) < 10 || d.Date < 19900101 {
		return nil, fmt.Errorf("上交所返回格式不对")
	}
	n := func(i int) float64 {
		var f float64
		_ = json.Unmarshal(d.Snap[i], &f)
		return f
	}
	last, open := n(5), n(2)
	if last <= 0 || open <= 0 {
		return nil, nil
	}
	ds := strconv.FormatInt(d.Date, 10)
	ts := fmt.Sprintf("%06d", d.Time)
	return &liveQuote{date: ds[:4] + "-" + ds[4:6] + "-" + ds[6:8], clock: ts[:2] + ":" + ts[2:4] + ":" + ts[4:6],
		open: open, high: n(3), low: n(4), last: last, prev: n(1), v: n(8)}, nil
}

// 腾讯：v_sh600519="1~名称~代码~现价~昨收~今开~成交量~...~[30]时间~...~[33]最高~[34]最低~..."
// A 股成交量单位是手、时间 20261113145958；港股成交量是股、时间 2026/11/13 16:08:09
func liveTencent(ctx context.Context, key string, hk bool) (*liveQuote, error) {
	b, err := liveGet(ctx, liveTencentURL+key, "https://gu.qq.com/")
	if err != nil {
		return nil, err
	}
	s := string(b)
	i := strings.Index(s, "=\"")
	j := strings.LastIndex(s, "\"")
	if i < 0 || j <= i+2 {
		return nil, fmt.Errorf("腾讯没有这只")
	}
	p := strings.Split(s[i+2:j], "~")
	if len(p) < 35 {
		return nil, fmt.Errorf("腾讯返回格式不对")
	}
	last, open := pf(p[3]), pf(p[5])
	if last <= 0 || open <= 0 {
		return nil, nil
	}
	t := strings.NewReplacer("/", "", "-", "", ":", "", " ", "").Replace(strings.TrimSpace(p[30]))
	if len(t) < 14 {
		return nil, fmt.Errorf("腾讯没有行情时间")
	}
	vol := pf(p[6])
	if !hk && !strings.HasPrefix(key, "sh688") && !strings.HasPrefix(key, "sh689") { // 手 → 股；科创板腾讯给的就是股
		vol *= 100
	}
	return &liveQuote{date: t[:4] + "-" + t[4:6] + "-" + t[6:8], clock: t[8:10] + ":" + t[10:12] + ":" + t[12:14],
		open: open, high: pf(p[33]), low: pf(p[34]), last: last, prev: pf(p[4]), v: vol}, nil
}

var etZone = func() *time.Location {
	if l, err := time.LoadLocation("America/New_York"); err == nil {
		return l
	}
	return time.FixedZone("EST", -5*3600)
}()

// 金融平台 GET：带 X-API-Key
func livePlatform(ctx context.Context, path string, out any) error {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		return fmt.Errorf("没有配置金融平台")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	resp, err := liveHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("金融平台连不上")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("金融平台 HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(out)
}

// 港股：金融平台 hk_live（先富途开放平台：实时、不分交易时段；再老虎：只在交易时段）；都没有 → 换腾讯
func liveTiger(ctx context.Context, five string) (*liveQuote, error) {
	var d struct {
		Quotes map[string]struct {
			O      *float64 `json:"open"`
			H      *float64 `json:"high"`
			L      *float64 `json:"low"`
			P      *float64 `json:"price"`
			PC     *float64 `json:"prev_close"`
			V      *float64 `json:"volume"`
			Time   string   `json:"time"`
			Source string   `json:"source"`
		} `json:"quotes"`
	}
	sym := strings.TrimLeft(five, "0")
	if len(sym) < 4 {
		sym = fmt.Sprintf("%04s", sym)
		sym = strings.ReplaceAll(sym, " ", "0")
	}
	if err := livePlatform(ctx, "/api/v1/markets/hk_live?symbols="+sym+".HK", &d); err != nil {
		return nil, err
	}
	q, ok := d.Quotes[five]
	if !ok || q.P == nil || *q.P <= 0 || len(q.Time) < 19 {
		return nil, fmt.Errorf("老虎没有这只的实时行情")
	}
	f := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	out := &liveQuote{date: q.Time[:10], clock: q.Time[11:19], open: f(q.O), high: f(q.H), low: f(q.L), last: *q.P, prev: f(q.PC),
		v: f(q.V), noVol: q.V == nil}
	if out.open <= 0 {
		out.open = out.last
	}
	out.srcName = map[string]string{"futu": "富途", "tiger": "老虎"}[q.Source]
	return out, nil
}

// 美股：金融平台 us_live（FMP 名单内 / Alpaca 现价 + Finnhub 开高低；收盘后 Finnhub）
func liveUS(ctx context.Context, sym string) (*liveQuote, error) {
	var d struct {
		Trading bool `json:"trading"`
		Quotes  map[string]struct {
			Date, Time, Source     string
			Open, High, Low, Price float64
			PrevClose              float64  `json:"prev_close"`
			Volume                 *float64 `json:"volume"`
		} `json:"quotes"`
	}
	if err := livePlatform(ctx, "/api/v1/markets/us_live?symbols="+sym, &d); err != nil {
		return nil, err
	}
	q, ok := d.Quotes[sym]
	if !ok || q.Price <= 0 || len(q.Date) != 10 || len(q.Time) < 8 {
		return nil, fmt.Errorf("美股实时行情取不到")
	}
	src := map[string]string{"fmp": "FMP", "alpaca+finnhub": "Alpaca+Finnhub", "alpaca": "Alpaca", "finnhub": "Finnhub"}[q.Source]
	if src == "" {
		src = q.Source
	}
	t := d.Trading
	out := &liveQuote{date: q.Date, clock: q.Time[:8], open: q.Open, high: q.High, low: q.Low, last: q.Price,
		prev: q.PrevClose, noVol: q.Volume == nil, trading: &t, srcName: src, today: liveNow().In(etZone).Format("2006-01-02")}
	if q.Volume != nil {
		out.v = *q.Volume
	}
	return out, nil
}

// 雅虎 chart：meta 里有现价、当天高低、成交量、行情时间、交易时段、延迟分钟数；开盘价在 indicators.quote[0].open。
// 实测（雅虎官方说明）：美股、美股指数、汇率是即时的；港股 15 分钟、期货 10–30 分钟、A 股 30 分钟
func liveYahoo(ctx context.Context, sym string) (*liveQuote, error) {
	b, err := liveGet(ctx, liveYahooURL+url.PathEscape(sym)+"?interval=1d&range=1d", "")
	if err != nil {
		return nil, err
	}
	var d struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Price      float64 `json:"regularMarketPrice"`
					High       float64 `json:"regularMarketDayHigh"`
					Low        float64 `json:"regularMarketDayLow"`
					Volume     float64 `json:"regularMarketVolume"`
					Prev       float64 `json:"chartPreviousClose"`
					PrevClose  float64 `json:"previousClose"`
					Time       int64   `json:"regularMarketTime"`
					GMTOffset  int64   `json:"gmtoffset"`
					DelayedBy  int     `json:"exchangeDataDelayedBy"`
					TradingPer struct {
						Regular struct {
							Start int64 `json:"start"`
							End   int64 `json:"end"`
						} `json:"regular"`
					} `json:"currentTradingPeriod"`
				} `json:"meta"`
				Indicators struct {
					Quote []struct {
						Open []*float64 `json:"open"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(b, &d); err != nil || len(d.Chart.Result) == 0 {
		return nil, fmt.Errorf("雅虎返回格式不对")
	}
	r := d.Chart.Result[0]
	m := r.Meta
	if m.Price <= 0 || m.Time == 0 {
		return nil, fmt.Errorf("雅虎没有这只的行情")
	}
	open := 0.0
	if q := r.Indicators.Quote; len(q) > 0 {
		for i := len(q[0].Open) - 1; i >= 0; i-- {
			if q[0].Open[i] != nil && *q[0].Open[i] > 0 {
				open = *q[0].Open[i]
				break
			}
		}
	}
	if open <= 0 {
		open = m.Price
	}
	local := func(t int64) time.Time { return time.Unix(t+m.GMTOffset, 0).UTC() }
	lt := local(m.Time)
	now := liveNow().Unix()
	trading := m.TradingPer.Regular.Start > 0 && now >= m.TradingPer.Regular.Start && now < m.TradingPer.Regular.End+300
	prev := m.Prev
	if m.PrevClose > 0 {
		prev = m.PrevClose
	}
	hi, lo := m.High, m.Low
	if hi <= 0 || hi < m.Price {
		hi = maxF(m.Price, open)
	}
	if lo <= 0 || lo > m.Price {
		lo = minF(m.Price, open)
	}
	return &liveQuote{date: lt.Format("2006-01-02"), clock: lt.Format("15:04:05"), open: open, high: hi, low: lo, last: m.Price,
		prev: prev, v: m.Volume, noVol: m.Volume <= 0, trading: &trading, today: local(now).Format("2006-01-02"),
		srcName: "雅虎", delayMin: m.DelayedBy}, nil
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
