package tools

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestFinanceMarketsProxy(t *testing.T) {
	calls := 0
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-API-Key") != "k" || r.URL.Path != "/api/v1/markets/quotes" || r.URL.Query().Get("symbols") != "000001.SH,^GSPC,GC=F" {
			http.Error(w, "bad "+r.URL.RawQuery, http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","quotes":[{"symbol":"^GSPC","price":6000}]}`))
	}))
	defer platform.Close()
	t.Setenv("FINANCE_BASE_URL", platform.URL)
	t.Setenv("FINANCE_API_KEY", "k")
	klineCacheMu.Lock()
	klineCache = map[string]klineCached{}
	klineCacheMu.Unlock()
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		financeMarkets(rec, httptest.NewRequest(http.MethodGet, "/finance/markets?symbols=000001.sh,%5EGSPC,GC%3DF,%5EGSPC", nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), "6000") {
			t.Fatalf("code %d body %s", rec.Code, rec.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("second call should be cached, calls %d", calls)
	}
	many := make([]string, 41)
	for i := range many {
		many[i] = "A" + strconv.Itoa(i)
	}
	for _, q := range []string{"symbols=", "symbols=../x", "symbols=" + strings.Join(many, ",")} {
		rec := httptest.NewRecorder()
		financeMarkets(rec, httptest.NewRequest(http.MethodGet, "/finance/markets?"+q, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: want 400, got %d", q[:min(len(q), 30)], rec.Code)
		}
	}
}
