package tools

import (
	"encoding/json"
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
	oldZ, oldS, oldT, oldN := liveSZSEURL, liveSSEURL, liveTencentURL, liveNow
	liveSZSEURL, liveSSEURL, liveTencentURL = srv.URL+"/szse?code=", srv.URL+"/sse/", srv.URL+"/qt?q="
	liveNow = func() time.Time { return now }
	liveCacheMu.Lock()
	liveCache = map[string]struct {
		r  liveResp
		at time.Time
	}{}
	liveCacheMu.Unlock()
	t.Cleanup(func() { liveSZSEURL, liveSSEURL, liveTencentURL, liveNow = oldZ, oldS, oldT, oldN })
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
