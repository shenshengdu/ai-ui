package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 盘中「今天这一根」K 线：库里的日线要收盘后（北京 18:40）才有当天的，K 线页用这个临时拼上最后一根（不写库）。
// GET /api/tools/finance/live?symbol=002594.SZ
// A 股：交易所网站为主（深市 szse.cn、沪市 yunhq.sse.com.cn），失败退回腾讯；港股：腾讯。
// 这些请求从本机发出，不占阿里云每日收盘同步（腾讯）的请求额度。

var (
	liveSZSEURL    = "https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code="
	liveSSEURL     = "http://yunhq.sse.com.cn:32041/v1/sh1/snap/"
	liveTencentURL = "https://qt.gtimg.cn/q="
	liveHTTPClient = &http.Client{Timeout: 8 * time.Second}
	liveNow        = time.Now
)

var liveSymbolRe = regexp.MustCompile(`^(\d{6})\.(SH|SS|SZ)$|^(\d{1,5})\.HK$`)

const liveTTL = 15 * time.Second

type liveResp struct {
	Status    string    `json:"status"`
	Symbol    string    `json:"symbol"`
	Source    string    `json:"source,omitempty"`
	Bar       *klineBar `json:"bar,omitempty"`
	PrevClose *float64  `json:"prev_close,omitempty"`
	Time      string    `json:"time,omitempty"` // 行情时间（北京）
	Trading   bool      `json:"trading"`        // 正在交易时段、而且是今天的行情：前端继续定时刷新
	Error     string    `json:"error,omitempty"`
}

type liveQuote struct {
	date, clock                    string // 2026-11-13, 14:59:58
	open, high, low, last, prev, v float64
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
		_ = json.NewEncoder(w).Encode(liveResp{Status: "error", Symbol: symbol, Error: "只支持 A 股（600519.SH）和港股（0700.HK）"})
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
	if hk {
		code := fmt.Sprintf("%05s", m[3])
		code = strings.ReplaceAll(code, " ", "0")
		srcs = []src{{"腾讯", func() (*liveQuote, error) { return liveTencent(ctx, "hk"+code, true) }}}
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
		today := liveNow().In(bjZone).Format("2006-01-02")
		return liveResp{Status: "success", Symbol: symbol, Source: s.name,
			Bar:       &klineBar{T: q.date, O: &o, H: &h, L: &l, C: &c, V: &v},
			PrevClose: &p, Time: q.date + " " + q.clock,
			Trading: q.date == today && liveSession(liveNow(), hk)}
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
	if !hk {
		vol *= 100
	}
	return &liveQuote{date: t[:4] + "-" + t[4:6] + "-" + t[6:8], clock: t[8:10] + ":" + t[10:12] + ":" + t[12:14],
		open: open, high: pf(p[33]), low: pf(p[34]), last: last, prev: pf(p[4]), v: vol}, nil
}
