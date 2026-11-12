package tools

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFinanceCompanyProxy(t *testing.T) {
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "k" {
			http.Error(w, "bad", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/company/600519.SH/announcements":
			_, _ = w.Write([]byte(`{"status":"success","announcements":[{"title":"2026年第三季度报告","url":"http://static.cninfo.com.cn/x.PDF"}]}`))
		case "/api/v1/company/AAPL/financials":
			if r.URL.Query().Get("limit") != "12" {
				http.Error(w, "limit", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","rows":[{"report_date":"2026-09-27"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer platform.Close()
	t.Setenv("FINANCE_BASE_URL", platform.URL)
	t.Setenv("FINANCE_API_KEY", "k")
	for q, want := range map[string]string{
		"symbol=600519.sh&kind=announcements": "static.cninfo.com.cn",
		"symbol=AAPL&kind=financials":         "2026-09-27",
	} {
		rec := httptest.NewRecorder()
		financeCompany(rec, httptest.NewRequest(http.MethodGet, "/finance/company?"+q, nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("%s: code %d body %s", q, rec.Code, rec.Body.String())
		}
	}
	for _, q := range []string{"symbol=AAPL&kind=x", "symbol=^N225&kind=announcements", "symbol=GC=F&kind=financials", "symbol=a/b&kind=financials", "kind=financials"} {
		rec := httptest.NewRecorder()
		financeCompany(rec, httptest.NewRequest(http.MethodGet, "/finance/company?"+q, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: want 400, got %d", q, rec.Code)
		}
	}
}
