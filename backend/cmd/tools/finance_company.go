package tools

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// 公司公告、主要财务（K 线页下方的标签页）：
// GET /api/tools/finance/company?symbol=600519.SH&kind=announcements|financials
// → 平台 /api/v1/company/{symbol}/announcements 或 /financials。第一次查某只 A/港股公告时平台会补近 3 年，可能要几十秒。
func financeCompany(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	limit := "50"
	switch kind {
	case "announcements":
	case "financials":
		limit = "40" // 最多 40 期；前端只显示最近 5 年（A 股 20 个季度，港股 10 个半年）
	default:
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"error","error":"kind 只能是 announcements 或 financials"}`))
		return
	}
	if !klineSymbolRe.MatchString(symbol) || strings.ContainsAny(symbol, "^=") {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"error","error":"代码格式：美股 AAPL、A 股 600519.SH、港股 0700.HK"}`))
		return
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"status":"error","error":"服务器没有配置金融平台"}`))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	u := base + "/api/v1/company/" + url.PathEscape(symbol) + "/" + kind + "?limit=" + limit
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	resp, err := financeHTTPClient.Do(req)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"status":"error","error":"金融平台连不上"}`))
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"status":"error","error":"金融平台查询失败"}`))
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=600")
	_, _ = w.Write(body)
}
