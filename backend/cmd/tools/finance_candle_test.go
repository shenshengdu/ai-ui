package tools

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	logger "github.com/charmbracelet/log"
)

func TestFinanceCandleTool(t *testing.T) {
	if !isFinanceTool("finance_candle") {
		t.Fatal("finance_candle should be a finance tool")
	}
	found := false
	for _, tl := range financeBuiltInTools() {
		found = found || tl.Name == "finance_candle"
	}
	if !found {
		t.Fatal("finance_candle not registered")
	}
	if log == nil { // 正式运行时 SetUpTools 会设好；单独跑这个测试时没有
		log = logger.New(io.Discard)
	}
	var gotPath, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		_, _ = w.Write([]byte(`{"status":"success","symbol":"600519.SH","patterns":[{"id":"hammer","name":"锤子线"}],"outlook":{"lean":"中性"}}`))
	}))
	defer srv.Close()
	t.Setenv("FINANCE_BASE_URL", srv.URL)
	t.Setenv("FINANCE_API_KEY", "k")
	out := financeTool(context.Background(), "finance_candle", `{"symbol":"600519.sh"}`)
	if !strings.Contains(out.Content, "锤子线") || gotPath != "/api/v1/candle/600519.SH" || gotQuery != "" {
		t.Fatalf("default: %s %s %s", gotPath, gotQuery, out.Content)
	}
	financeTool(context.Background(), "finance_candle", `{"symbol":"AAPL","years":10}`)
	if gotPath != "/api/v1/candle/AAPL" || gotQuery != "years=10" {
		t.Fatalf("years: %s %s", gotPath, gotQuery)
	}
	if out := financeTool(context.Background(), "finance_candle", `{"symbol":"../x"}`); !strings.Contains(out.Content, "invalid stock symbol") {
		t.Fatalf("bad symbol: %s", out.Content)
	}
}
