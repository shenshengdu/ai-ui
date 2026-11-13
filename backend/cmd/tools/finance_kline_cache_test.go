package tools

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFinanceKlineCacheAndGzip(t *testing.T) {
	calls := 0
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var b strings.Builder
		b.WriteString(`{"source":"ahdb","data":[`)
		for i := 0; i < 300; i++ {
			if i > 0 {
				b.WriteString(",")
			}
			fmt.Fprintf(&b, `{"date":"2020-01-%02d","open":1,"high":2,"low":0.5,"close":1.5,"volume":100}`, i%28+1)
		}
		b.WriteString(`]}`)
		_, _ = w.Write([]byte(b.String()))
	}))
	defer platform.Close()
	t.Setenv("FINANCE_BASE_URL", platform.URL)
	t.Setenv("FINANCE_API_KEY", "k")
	klineCacheMu.Lock()
	klineCache = map[string]klineCached{}
	klineCacheMu.Unlock()

	rec := httptest.NewRecorder()
	financeKline(rec, httptest.NewRequest(http.MethodGet, "/finance/kline?symbol=600519.SH&period=max", nil))
	if rec.Code != 200 || rec.Header().Get("Content-Encoding") != "" || calls != 1 {
		t.Fatalf("first: code %d enc %q calls %d", rec.Code, rec.Header().Get("Content-Encoding"), calls)
	}
	req := httptest.NewRequest(http.MethodGet, "/finance/kline?symbol=600519.sh&period=max", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	rec = httptest.NewRecorder()
	financeKline(rec, req)
	if calls != 1 || rec.Header().Get("X-Kline-Cache") != "hit" || rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("second should be cached+gzip: calls %d headers %v", calls, rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(zr)
	var got klineResp
	if err := json.Unmarshal(raw, &got); err != nil || got.Status != "success" || len(got.Data) != 300 {
		t.Fatalf("gzip body: %v %+v", err, got.Status)
	}
	// 范围不同：重新取
	rec = httptest.NewRecorder()
	financeKline(rec, httptest.NewRequest(http.MethodGet, "/finance/kline?symbol=600519.SH&period=1y", nil))
	if calls != 2 {
		t.Fatalf("different period should fetch, calls %d", calls)
	}
}
