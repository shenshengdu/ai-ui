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

// 行情看板（K 线页「大盘 / 全球市场」面板）：GET /api/tools/finance/markets?symbols=000001.SH,HSI.HK,^GSPC,GC=F
// → 平台 /api/v1/markets/quotes；缓存 60 秒（面板每分钟刷新一次，多人打开也只问一次平台）
func financeMarkets(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var syms []string
	seen := map[string]bool{}
	for _, s := range strings.Split(r.URL.Query().Get("symbols"), ",") {
		s = strings.ToUpper(strings.TrimSpace(s))
		if s == "" || seen[s] {
			continue
		}
		if !klineSymbolRe.MatchString(s) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"status":"error","error":"代码格式不对"}`))
			return
		}
		seen[s] = true
		syms = append(syms, s)
	}
	if len(syms) == 0 || len(syms) > 40 {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"error","error":"symbols：1–40 个代码"}`))
		return
	}
	joined := strings.Join(syms, ",")
	cacheKey := "markets|" + joined
	if c, ok := klineCacheGet(cacheKey); ok {
		klineWrite(w, r, c, true)
		return
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"status":"error","error":"服务器没有配置金融平台"}`))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/v1/markets/quotes?symbols="+url.QueryEscape(joined), nil)
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
	c := gzipCached(body)
	c.ttl = time.Minute
	klineCachePut(cacheKey, c)
	w.Header().Set("Cache-Control", "private, max-age=30")
	klineWrite(w, r, c, false)
}
