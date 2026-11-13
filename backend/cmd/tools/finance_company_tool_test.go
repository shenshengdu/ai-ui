package tools

import (
	"strings"
	"testing"
	"time"
)

func TestFinanceCompanyTool(t *testing.T) {
	if !isFinanceTool("finance_company") {
		t.Fatal("finance_company should be a finance tool")
	}
	found := false
	for _, tl := range financeBuiltInTools() {
		found = found || tl.Name == "finance_company"
	}
	if !found {
		t.Fatal("finance_company not registered")
	}
	if p, err := financeCompanyPath("600519.sh", "announcements", 0); err != nil || p != "/api/v1/company/600519.SH/announcements?limit=30" {
		t.Fatalf("path %q %v", p, err)
	}
	if p, _ := financeCompanyPath("AAPL", "financials", 5); p != "/api/v1/company/AAPL/financials?limit=40" {
		t.Fatalf("path %q", p)
	}
	for _, bad := range [][2]string{{"../x", "financials"}, {"AAPL", "news"}} {
		if _, err := financeCompanyPath(bad[0], bad[1], 0); err == nil {
			t.Fatalf("%v should fail", bad)
		}
	}
	ann := formatFinanceCompany("announcements", []byte(`{"symbol":"600519.SH","source":"cninfo","backfilling":true,"announcements":[{"time":"2026-10-30 00:00","title":"2026年第三季度报告","category":"三季报","url":"http://static.cninfo.com.cn/a.PDF"}]}`), time.Now())
	if !strings.Contains(ann, "三季报 | 2026年第三季度报告 | http://static.cninfo.com.cn/a.PDF") || !strings.Contains(ann, "正在补") {
		t.Fatalf("ann: %s", ann)
	}
	now := time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC)
	fin := formatFinanceCompany("financials", []byte(`{"symbol":"600519.SH","source":"eastmoney","rows":[
		{"report_date":"2026-09-30","period_type":"三季报","ann_date":"2026-10-31","currency":"CNY","revenue":133283652508.95,"revenue_yoy":6.3,"net_profit":6.4e10,"eps":52.6,"roe":26.1},
		{"report_date":"2020-12-31","period_type":"年报","revenue":1e11}]}`), now)
	if !strings.Contains(fin, "2026-09-30 | 三季报 | 2026-10-31 | 1332.84 | 6.30% | 640.00 | -% | 52.600 | 26.10% | -% | -") || strings.Contains(fin, "2020-12-31") || !strings.Contains(fin, "亿 CNY") {
		t.Fatalf("fin: %s", fin)
	}
}
