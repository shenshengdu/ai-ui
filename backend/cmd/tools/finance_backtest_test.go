package tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func backtestServer(t *testing.T, h http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	t.Setenv("FINANCE_BASE_URL", srv.URL)
	t.Setenv("FINANCE_API_KEY", "k")
	oldWait, oldPoll := backtestWait, backtestPoll
	backtestWait, backtestPoll = 300*time.Millisecond, 10*time.Millisecond
	t.Cleanup(func() { backtestWait, backtestPoll = oldWait, oldPoll })
}

func TestBacktestRunNeedsConfirmation(t *testing.T) {
	backtestServer(t, func(w http.ResponseWriter, r *http.Request) { t.Fatal("不应该请求平台") })
	out := backtestTool(context.Background(), "finance_backtest_run", `{"spec":{"name":"x"},"user_confirmed":false}`)
	if !strings.Contains(out.Content, "user_confirmed") {
		t.Fatalf("got %s", out.Content)
	}
}

func TestBacktestRunWaitsForDone(t *testing.T) {
	var polls int32
	backtestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "k" {
			t.Errorf("no key")
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/backtest":
			b, _ := io.ReadAll(r.Body)
			var d map[string]map[string]any
			_ = json.Unmarshal(b, &d)
			if d["spec"]["name"] != "低估值" {
				t.Errorf("spec not forwarded: %s", b)
			}
			_, _ = w.Write([]byte(`{"status":"success","backtest":{"id":"abcdef012345","status":"queued","ahead":0}}`))
		case r.URL.Path == "/api/v1/backtest/abcdef012345":
			if atomic.AddInt32(&polls, 1) < 3 {
				_, _ = w.Write([]byte(`{"status":"success","backtest":{"id":"abcdef012345","status":"running","progress":0.5}}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","backtest":{"id":"abcdef012345","status":"done","result":{
				"metrics":{"strategy":{"cagr":12.3}},"nav":[["2015-01-05",1]],"benchmark_nav":[["2015-01-05",1]],
				"holdings":[{"signal":"a"},{"signal":"b"}],"random":{"runs":3,"cagr":[1,2,3],"strategy_percentile":90},"spec":{}}}}`))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	})
	out := backtestTool(context.Background(), "finance_backtest_run", `{"spec":{"name":"低估值"},"user_confirmed":true}`)
	for _, want := range []string{`"cagr":12.3`, `"page":"/backtest/abcdef012345"`, `共 2 期持仓`, `"cagr_median":2`} {
		if !strings.Contains(out.Content, want) {
			t.Fatalf("missing %s in %s", want, out.Content)
		}
	}
	for _, no := range []string{`"nav"`, `"benchmark_nav"`} {
		if strings.Contains(out.Content, no) {
			t.Fatalf("should drop %s: %s", no, out.Content)
		}
	}
}

func TestBacktestRunTimeoutAndSpecError(t *testing.T) {
	bad := true
	backtestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if bad {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"detail":"因子不认识：foo"}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","backtest":{"id":"abcdef012345","status":"queued"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","backtest":{"id":"abcdef012345","status":"queued","ahead":2}}`))
	})
	out := backtestTool(context.Background(), "finance_backtest_run", `{"spec":{"rank":[{"factor":"foo"}]},"user_confirmed":true}`)
	if !strings.Contains(out.Content, "因子不认识：foo") {
		t.Fatalf("got %s", out.Content)
	}
	bad = false
	out = backtestTool(context.Background(), "finance_backtest_run", `{"spec":{"name":"x"},"user_confirmed":true}`)
	if !strings.Contains(out.Content, "还没跑完") || !strings.Contains(out.Content, `"ahead":2`) {
		t.Fatalf("got %s", out.Content)
	}
}

func TestBacktestGetListAndHTTP(t *testing.T) {
	backtestServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/backtests":
			if r.URL.Query().Get("limit") != "20" && r.URL.Query().Get("limit") != "50" {
				t.Errorf("limit %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"status":"success","backtests":[{"id":"abcdef012345"}]}`))
		case "/api/v1/backtest/abcdef012345":
			_, _ = w.Write([]byte(`{"status":"success","backtest":{"id":"abcdef012345","status":"done","full":"` + r.URL.Query().Get("full") + `"}}`))
		default:
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"detail":"没有这个回测"}`))
		}
	})
	if out := backtestTool(context.Background(), "finance_backtest_list", `{}`); !strings.Contains(out.Content, "abcdef012345") {
		t.Fatalf("list: %s", out.Content)
	}
	if out := backtestTool(context.Background(), "finance_backtest_get", `{"id":"../x"}`); !strings.Contains(out.Content, "12 位") {
		t.Fatalf("bad id: %s", out.Content)
	}
	if out := backtestTool(context.Background(), "finance_backtest_get", `{"id":"0123456789ab"}`); !strings.Contains(out.Content, "没有这个回测") {
		t.Fatalf("404: %s", out.Content)
	}
	rec := httptest.NewRecorder()
	financeBacktestHTTP(rec, httptest.NewRequest("GET", "/finance/backtest?id=abcdef012345&full=0", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"full":"0"`) {
		t.Fatalf("http get: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	financeBacktestHTTP(rec, httptest.NewRequest("GET", "/finance/backtests", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "abcdef012345") {
		t.Fatalf("http list: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	financeBacktestHTTP(rec, httptest.NewRequest("GET", "/finance/backtest?id=0123456789ab", nil))
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "没有这个回测") {
		t.Fatalf("http 404: %d %s", rec.Code, rec.Body.String())
	}
}

func TestBacktestToolsRegistered(t *testing.T) {
	names := map[string]bool{}
	for _, tl := range financeBuiltInTools() {
		names[tl.Name] = true
		if isBacktestTool(tl.Name) && !json.Valid([]byte(tl.InputSchema)) {
			t.Fatalf("bad schema %s", tl.Name)
		}
	}
	for _, n := range []string{"finance_backtest_factors", "finance_backtest_run", "finance_backtest_get", "finance_backtest_list"} {
		if !names[n] || !isFinanceTool(n) {
			t.Fatalf("%s not registered", n)
		}
	}
}
