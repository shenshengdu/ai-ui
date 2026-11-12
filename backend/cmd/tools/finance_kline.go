package tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// 日 K 线数据：前端 ```kline``` 代码块用。浏览器只调这里（需要登录），平台的 API key 只在服务器上。
// GET /api/tools/finance/kline?symbol=AAPL&period=1y
// 美股（平台本地库）、A 股（600519.SH）、港股（0700.HK）都可以：平台按代码分到对应数据源。

var klineSymbolRe = regexp.MustCompile(`^([A-Z][A-Z0-9.\-]{0,9}|\d{6}\.(SH|SZ|SS|BJ)|\d{1,5}\.HK)$`)
var klinePeriods = map[string]bool{"3mo": true, "6mo": true, "1y": true, "2y": true, "5y": true, "max": true}

type klineBar struct {
	T string   `json:"t"`
	O *float64 `json:"o"`
	H *float64 `json:"h"`
	L *float64 `json:"l"`
	C *float64 `json:"c"`
	V *float64 `json:"v"`
}

type klineResp struct {
	Status string     `json:"status"`
	Symbol string     `json:"symbol"`
	Period string     `json:"period"`
	Source string     `json:"source,omitempty"`
	Error  string     `json:"error,omitempty"`
	Data   []klineBar `json:"data,omitempty"`
}

func klineJSON(w http.ResponseWriter, code int, v klineResp) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func financeKline(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	period := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("period")))
	if period == "" {
		period = "1y"
	}
	if !klinePeriods[period] {
		klineJSON(w, http.StatusBadRequest, klineResp{Status: "error", Symbol: symbol, Period: period, Error: "period 只能是 3mo、6mo、1y、2y、5y、max"})
		return
	}
	if !klineSymbolRe.MatchString(symbol) {
		klineJSON(w, http.StatusBadRequest, klineResp{Status: "error", Symbol: symbol, Period: period,
			Error: "股票代码格式：美股 AAPL、A 股 600519.SH、港股 0700.HK"})
		return
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		klineJSON(w, http.StatusServiceUnavailable, klineResp{Status: "error", Symbol: symbol, Period: period, Error: "服务器没有配置金融平台"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		base+"/api/v1/history/"+url.PathEscape(symbol)+"?period="+url.QueryEscape(period), nil)
	if err != nil {
		klineJSON(w, http.StatusInternalServerError, klineResp{Status: "error", Symbol: symbol, Period: period, Error: "请求构造失败"})
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	resp, err := financeHTTPClient.Do(req)
	if err != nil {
		klineJSON(w, http.StatusBadGateway, klineResp{Status: "error", Symbol: symbol, Period: period, Error: "金融平台连不上"})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, financeMaxBody))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		klineJSON(w, http.StatusBadGateway, klineResp{Status: "error", Symbol: symbol, Period: period,
			Error: "金融平台返回 HTTP " + http.StatusText(resp.StatusCode)})
		return
	}
	out, err := parseKlineHistory(body)
	if err != nil || len(out.Data) == 0 {
		klineJSON(w, http.StatusBadGateway, klineResp{Status: "error", Symbol: symbol, Period: period, Error: "没有拿到历史数据"})
		return
	}
	out.Status, out.Symbol, out.Period = "success", symbol, period
	klineJSON(w, http.StatusOK, out)
}

// 平台 /api/v1/history 返回 {"source": ..., "data": [{"date","open","high","low","close","volume"}]}
func parseKlineHistory(body []byte) (klineResp, error) {
	var raw struct {
		Source string `json:"source"`
		Data   []struct {
			Date   string   `json:"date"`
			Open   *float64 `json:"open"`
			High   *float64 `json:"high"`
			Low    *float64 `json:"low"`
			Close  *float64 `json:"close"`
			Volume *float64 `json:"volume"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return klineResp{}, err
	}
	out := klineResp{Source: raw.Source}
	for _, d := range raw.Data {
		if d.Close == nil || len(d.Date) < 10 {
			continue
		}
		out.Data = append(out.Data, klineBar{T: d.Date[:10], O: d.Open, H: d.High, L: d.Low, C: d.Close, V: d.Volume})
	}
	return out, nil
}

// 股票搜索（K 线页的搜索框）：GET /api/tools/finance/search?q=茅台 → 平台 /api/v1/symbols/search
func financeSymbolSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	w.Header().Set("Content-Type", "application/json")
	if q == "" || len([]rune(q)) > 20 || strings.ContainsAny(q, "\r\n\t") {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"error","error":"q：1–20 个字"}`))
		return
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"status":"error","error":"服务器没有配置金融平台"}`))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/v1/symbols/search?limit=20&q="+url.QueryEscape(q), nil)
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
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"status":"error","error":"金融平台搜索失败"}`))
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	_, _ = w.Write(body)
}
