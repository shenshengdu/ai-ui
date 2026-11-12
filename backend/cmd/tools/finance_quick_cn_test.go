package tools

import (
	"strings"
	"testing"
)

func TestFinanceQuoteCNFormat(t *testing.T) {
	body := []byte(`{"status":"success","symbol":"600519.SH","name":"贵州茅台","market":"A","currency":"CNY",
	"price":1650,"prev_close":1640,"open":1642.5,"high":1660,"low":1638,"change":10,"change_percent":0.61,
	"timestamp":1794466803,"trade_date":"2026-11-12 (周四)","market_status":"closed - this is today's closing price",
	"price_label":"Close","data_time":"2026-11-12 15:00 Beijing time","now_local":"2026-11-12 15:30 Beijing time","source":"tencent"}`)
	out := formatFinanceQuote(body)
	for _, want := range []string{"600519.SH 贵州茅台 quote (China A-share, CNY)", "Trading date (Beijing time): 2026-11-12 (周四)",
		"Market status: closed", "Close: 1650.00", "▲ +10.00 (+0.61%)", "Source: tencent"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, " ET") {
		t.Fatalf("A-share quote must not use US Eastern time:\n%s", out)
	}
}
