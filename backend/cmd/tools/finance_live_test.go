package tools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func liveSetup(t *testing.T, h http.HandlerFunc, now time.Time) *int {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; h(w, r) }))
	t.Cleanup(srv.Close)
	oldZ, oldS, oldT, oldN, oldY := liveSZSEURL, liveSSEURL, liveTencentURL, liveNow, liveYahooURL
	liveSZSEURL, liveSSEURL, liveTencentURL, liveYahooURL = srv.URL+"/szse?code=", srv.URL+"/sse/", srv.URL+"/qt?q=", srv.URL+"/yahoo/"
	liveNow = func() time.Time { return now }
	liveCacheMu.Lock()
	liveCache = map[string]struct {
		r  liveResp
		at time.Time
	}{}
	liveCacheMu.Unlock()
	t.Cleanup(func() { liveSZSEURL, liveSSEURL, liveTencentURL, liveNow, liveYahooURL = oldZ, oldS, oldT, oldN, oldY })
	return &calls
}

func liveCall(t *testing.T, sym string) liveResp {
	rec := httptest.NewRecorder()
	financeLive(rec, httptest.NewRequest(http.MethodGet, "/finance/live?symbol="+sym, nil))
	var out liveResp
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("bad json %s", rec.Body.String())
	}
	return out
}

var bj1430 = time.Date(2026, 11, 13, 14, 30, 0, 0, bjZone)

func TestLiveSZSE(t *testing.T) {
	calls := liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/szse" || r.URL.Query().Get("code") != "002594" {
			http.Error(w, "x", 404)
			return
		}
		_, _ = w.Write([]byte(`{"datetime":"2026-11-13 14:30","code":"0","data":{"code":"002594","name":"比亚迪","close":"80.32","open":"80.77","now":"79.99","high":"80.84","low":"79.86","volume":265338,"amount":2129455930.78,"marketTime":"2026-11-13 14:29:58"}}`))
	}, bj1430)
	for i := 0; i < 2; i++ {
		r := liveCall(t, "002594.sz")
		if r.Status != "success" || r.Source != "深交所" || r.Bar == nil || r.Bar.T != "2026-11-13" || *r.Bar.C != 79.99 ||
			*r.Bar.O != 80.77 || *r.Bar.V != 26533800 || *r.PrevClose != 80.32 || !r.Trading || r.Time != "2026-11-13 14:29:58" {
			t.Fatalf("%+v", r)
		}
	}
	if *calls != 1 {
		t.Fatalf("second call should be cached, calls %d", *calls)
	}
}

func TestLiveSSEAndAfterClose(t *testing.T) {
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":"600519","date":20261113,"time":150001,"snap":["贵州茅台",1410.27,1404.0,1437.69,1394.0,1435.26,24.99,1.77,4177984,5954834070,177300]}`))
	}, time.Date(2026, 11, 13, 16, 0, 0, 0, bjZone))
	r := liveCall(t, "600519.SH")
	if r.Source != "上交所" || *r.Bar.H != 1437.69 || *r.Bar.L != 1394 || *r.Bar.V != 4177984 || r.Trading || r.Time != "2026-11-13 15:00:01" {
		t.Fatalf("%+v", r)
	}
}

func TestLiveFallbackToTencent(t *testing.T) {
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/sse/") {
			http.Error(w, "down", 502)
			return
		}
		f := make([]string, 50)
		f[0], f[1], f[2], f[3], f[4], f[5], f[6] = "1", "茅台", "600519", "1435.26", "1410.27", "1404.00", "41779"
		f[30], f[33], f[34] = "20261113142959", "1437.69", "1394.00"
		_, _ = w.Write([]byte(`v_sh600519="` + strings.Join(f, "~") + `";`))
	}, bj1430)
	r := liveCall(t, "600519.SH")
	if r.Source != "腾讯" || *r.Bar.C != 1435.26 || *r.Bar.V != 4177900 || !r.Trading {
		t.Fatalf("%+v", r)
	}
}

func TestLiveHKAndPreOpen(t *testing.T) {
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") != "hk00700" {
			http.Error(w, "x", 404)
			return
		}
		f := make([]string, 50)
		f[3], f[4], f[5], f[6], f[30], f[33], f[34] = "500.5", "498", "499", "1234567", "2026/11/13 14:29:59", "502", "497"
		_, _ = w.Write([]byte(`v_hk00700="` + strings.Join(f, "~") + `";`))
	}, bj1430)
	r := liveCall(t, "700.HK")
	if r.Source != "腾讯" || *r.Bar.V != 1234567 || r.Bar.T != "2026-11-13" || !r.Trading {
		t.Fatalf("%+v", r)
	}
	// 开盘前：交易所还没有今天的价 → 没有 bar
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":"0","data":{"now":"","open":"","close":"80.32","marketTime":"2026-11-13 09:10:00","volume":0}}`))
	}, time.Date(2026, 11, 13, 9, 10, 0, 0, bjZone))
	if r := liveCall(t, "002594.SZ"); r.Status != "success" || r.Bar != nil || r.Trading {
		t.Fatalf("%+v", r)
	}
	if r := liveCall(t, "AAPL"); r.Status != "error" {
		t.Fatalf("%+v", r)
	}
}

func TestLiveHKTigerThenTencent(t *testing.T) {
	tiger := true
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fp/api/v1/markets/hk_live" {
			if !tiger || r.Header.Get("X-API-Key") != "k" || r.URL.Query().Get("symbols") != "0700.HK" {
				_, _ = w.Write([]byte(`{"status":"success","quotes":{}}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","quotes":{"00700":{"open":400,"high":405,"low":398,"price":403.2,"prev_close":401,"volume":1234567,"time":"2026-11-13 14:29:58","source":"futu"}}}`))
			return
		}
		f := make([]string, 50)
		f[3], f[4], f[5], f[6], f[30], f[33], f[34] = "500.5", "498", "499", "1234567", "2026/11/13 14:14:59", "502", "497"
		_, _ = w.Write([]byte(`v_hk00700="` + strings.Join(f, "~") + `";`))
	}, bj1430)
	t.Setenv("FINANCE_BASE_URL", liveTencentURL[:strings.Index(liveTencentURL, "/qt")]+"/fp")
	t.Setenv("FINANCE_API_KEY", "k")
	r := liveCall(t, "0700.HK")
	if r.Source != "富途" || *r.Bar.C != 403.2 || *r.Bar.V != 1234567 || r.Delayed || !r.Trading {
		t.Fatalf("%+v", r)
	}
	tiger = false
	liveCacheMu.Lock()
	liveCache = map[string]struct {
		r  liveResp
		at time.Time
	}{}
	liveCacheMu.Unlock()
	r = liveCall(t, "0700.HK")
	if r.Source != "腾讯" || !r.Delayed || *r.Bar.C != 500.5 {
		t.Fatalf("%+v", r)
	}
}

func TestLiveUS(t *testing.T) {
	trading := `true`
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/fp/api/v1/markets/us_live" || r.URL.Query().Get("symbols") != "ZZZZ" {
			http.Error(w, "x", 404)
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","trading":` + trading + `,"quotes":{"ZZZZ":{"date":"2026-11-13","time":"10:37:59","open":118.2,"high":120.5,"low":117.4,"price":120.5,"prev_close":119.1,"volume":null,"source":"alpaca+finnhub"}}}`))
	}, time.Date(2026, 11, 13, 15, 38, 0, 0, time.UTC))
	t.Setenv("FINANCE_BASE_URL", liveTencentURL[:strings.Index(liveTencentURL, "/qt")]+"/fp")
	t.Setenv("FINANCE_API_KEY", "k")
	r := liveCall(t, "zzzz")
	if r.Status != "success" || r.Source != "Alpaca+Finnhub" || r.Bar.V != nil || *r.Bar.C != 120.5 || !r.Trading ||
		r.Time != "2026-11-13 10:37:59" || r.Bar.T != "2026-11-13" {
		t.Fatalf("%+v", r)
	}
}

func yahooBody(price float64, ts, start, end int64, delayed int) string {
	return fmt.Sprintf(`{"chart":{"result":[{"meta":{"symbol":"X","regularMarketPrice":%v,"regularMarketDayHigh":360.83,"regularMarketDayLow":355.755,`+
		`"regularMarketVolume":40027467,"chartPreviousClose":354.88,"regularMarketTime":%d,"gmtoffset":-18000,"exchangeDataDelayedBy":%d,`+
		`"currentTradingPeriod":{"regular":{"start":%d,"end":%d}}},"indicators":{"quote":[{"open":[357.71]}]}}]}}`, price, ts, delayed, start, end)
}

func TestLiveYahooUSFirstThenPlatform(t *testing.T) {
	// 美东 2026-11-13 10:38（UTC 15:38）
	now := time.Date(2026, 11, 13, 15, 38, 0, 0, time.UTC)
	start, end := time.Date(2026, 11, 13, 14, 30, 0, 0, time.UTC).Unix(), time.Date(2026, 11, 13, 21, 0, 0, 0, time.UTC).Unix()
	yahooUp := true
	plat := 0
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/yahoo/"):
			if !yahooUp {
				http.Error(w, "x", 429)
				return
			}
			_, _ = w.Write([]byte(yahooBody(358.74, now.Unix()-5, start, end, 0)))
		case r.URL.Path == "/fp/api/v1/markets/us_live":
			plat++
			_, _ = w.Write([]byte(`{"status":"success","trading":true,"quotes":{"AAPL":{"date":"2026-11-13","time":"10:37:59","open":357,"high":360,"low":357,"price":358.7,"prev_close":354.88,"volume":10212487,"source":"fmp"}}}`))
		default:
			http.Error(w, "x", 404)
		}
	}, now)
	t.Setenv("FINANCE_BASE_URL", liveTencentURL[:strings.Index(liveTencentURL, "/qt")]+"/fp")
	t.Setenv("FINANCE_API_KEY", "k")
	r := liveCall(t, "AAPL")
	if r.Source != "雅虎" || *r.Bar.C != 358.74 || *r.Bar.O != 357.71 || *r.Bar.V != 40027467 || !r.Trading || r.Delayed ||
		r.Bar.T != "2026-11-13" || r.Time != "2026-11-13 10:37:55" || plat != 0 {
		t.Fatalf("%+v", r)
	}
	yahooUp = false
	liveCacheMu.Lock()
	liveCache = map[string]struct {
		r  liveResp
		at time.Time
	}{}
	liveCacheMu.Unlock()
	r = liveCall(t, "AAPL")
	if r.Source != "FMP" || plat != 1 || !r.Trading {
		t.Fatalf("雅虎挂了应该走平台：%+v", r)
	}
}

func TestLiveYahooIndexFuturesDelayed(t *testing.T) {
	now := time.Date(2026, 11, 13, 15, 38, 0, 0, time.UTC)
	start, end := time.Date(2026, 11, 13, 14, 30, 0, 0, time.UTC).Unix(), time.Date(2026, 11, 13, 21, 0, 0, 0, time.UTC).Unix()
	var seen []string
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.EscapedPath())
		delay := 0
		if strings.Contains(r.URL.EscapedPath(), "GC") {
			delay = 10
		}
		_, _ = w.Write([]byte(yahooBody(4100, now.Unix()-600, start, end, delay)))
	}, now)
	if r := liveCall(t, "^GSPC"); r.Source != "雅虎" || !r.Trading || r.Delayed {
		t.Fatalf("%+v", r)
	}
	r := liveCall(t, "GC=F")
	if !r.Delayed || r.DelayMin != 10 || !r.Trading {
		t.Fatalf("%+v", r)
	}
	if seen[0] != "/yahoo/%5EGSPC" || seen[1] != "/yahoo/GC=F" {
		t.Fatalf("%v", seen)
	}
}

func TestLiveHKIndexFutuThenYahoo(t *testing.T) {
	futuUp := true
	liveSetup(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/fp/api/v1/markets/hk_live":
			if !futuUp || r.URL.Query().Get("symbols") != "HSI.HK" {
				_, _ = w.Write([]byte(`{"status":"success","quotes":{}}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","quotes":{"HSI":{"open":25000,"high":25100,"low":24900,"price":25050,"prev_close":24980,"volume":1,"time":"2026-11-13 14:29:58","source":"futu"}}}`))
		case strings.HasPrefix(r.URL.Path, "/yahoo/"):
			now := bj1430.Unix()
			_, _ = w.Write([]byte(yahooBody(24990, now-900, now-3600, now+3600, 15)))
		default:
			http.Error(w, "x", 404)
		}
	}, bj1430)
	t.Setenv("FINANCE_BASE_URL", liveTencentURL[:strings.Index(liveTencentURL, "/qt")]+"/fp")
	t.Setenv("FINANCE_API_KEY", "k")
	for _, sym := range []string{"HSI.HK", "^HSI"} {
		r := liveCall(t, sym)
		if r.Source != "富途" || *r.Bar.C != 25050 || !r.Trading || r.Delayed {
			t.Fatalf("%s %+v", sym, r)
		}
	}
	futuUp = false
	liveCacheMu.Lock()
	liveCache = map[string]struct {
		r  liveResp
		at time.Time
	}{}
	liveCacheMu.Unlock()
	if r := liveCall(t, "^HSI"); r.Source != "雅虎" || !r.Delayed || r.DelayMin != 15 {
		t.Fatalf("富途没有时 ^HSI 退回雅虎：%+v", r)
	}
}
