package tools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFinanceKlineParseAndProxy(t *testing.T) {
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "k" || r.URL.Path != "/api/v1/history/AAPL" || r.URL.Query().Get("period") != "6mo" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","source":"local","data":[
			{"date":"2026-11-10","open":1,"high":2,"low":0.5,"close":1.5,"volume":100},
			{"date":"2026-11-11T00:00:00","open":1.5,"high":2.5,"low":1,"close":2,"volume":200},
			{"date":"2026-11-12","open":null,"close":null}]}`))
	}))
	defer platform.Close()
	t.Setenv("FINANCE_BASE_URL", platform.URL)
	t.Setenv("FINANCE_API_KEY", "k")

	rec := httptest.NewRecorder()
	financeKline(rec, httptest.NewRequest(http.MethodGet, "/finance/kline?symbol=aapl&period=6mo", nil))
	var got klineResp
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != 200 {
		t.Fatalf("code %d body %s", rec.Code, rec.Body.String())
	}
	if got.Status != "success" || got.Source != "local" || len(got.Data) != 2 || got.Data[1].T != "2026-11-11" || *got.Data[1].C != 2 {
		t.Fatalf("unexpected: %+v", got)
	}
	if rec.Body.Len() == 0 || strings.Contains(rec.Body.String(), "\"k\"") {
		t.Fatalf("api key must not leak: %s", rec.Body.String())
	}

	for _, q := range []string{"symbol=600519.SH", "symbol=AAPL&period=10y", "symbol=../x"} {
		rec := httptest.NewRecorder()
		financeKline(rec, httptest.NewRequest(http.MethodGet, "/finance/kline?"+q, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", q, rec.Code)
		}
	}
}
