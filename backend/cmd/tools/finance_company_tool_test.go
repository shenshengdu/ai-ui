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
	if p, _ := financeCompanyPath("300612.SZ", "profile", 0); p != "/api/v1/company/300612.SZ/profile" {
		t.Fatalf("profile path %q", p)
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
	pr := formatFinanceCompany("profile", []byte(`{"symbol":"300612.SZ","name":"宣亚国际","source":"eastmoney_f10","fetched_at":"2026-11-13T06:00:00Z",
		"industry":{"csrc":"商务服务业","em":"传媒-营销广告-营销服务","sw_code":"720402"},
		"profile":{"full_name":"宣亚国际营销科技（北京）股份有限公司","found_date":"2007-06-20"},
		"issue":{"listing_date":"2017-02-15","issue_price":16},
		"main_business":{"report_date":"2026-06-30","by_product":[{"name":"数字广告","revenue":80000000,"ratio_pct":62,"gross_margin_pct":8}]}}`), now)
	for _, want := range []string{"证监会行业：商务服务业", "东方财富行业：传媒-营销广告-营销服务", "发行价：16", "上市日期：2017-02-15", "主营构成·按产品：数字广告 0.80亿（62.0%，毛利率 8.0%）"} {
		if !strings.Contains(pr, want) {
			t.Fatalf("profile missing %q:\n%s", want, pr)
		}
	}
}
