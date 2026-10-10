package tools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/providers"
)

// 搜索流程：缓存 → 美股相关依次走 Brave、SerpApi(Google)（失败/额度用完回退）→ SearXNG（经 nginx 缓存，失败直连）

const (
	searxPrimary  = "http://127.0.0.1:8891/search" // nginx 缓存
	searxFallback = "http://127.0.0.1:8888/search" // 直连 SearXNG
	ttlStock      = 2 * time.Hour
	ttlGeneral    = 3 * time.Hour
	ttlFallback   = 30 * time.Minute
	paidSkip      = 12 * time.Hour
	maxResults    = 8
)

type searchItem struct {
	Title, URL, Content, Source string
}

type searxSearchResponse struct {
	Query   string `json:"query"`
	Results []struct {
		URL     string `json:"url"`
		Title   string `json:"title"`
		Content string `json:"content"`
		Engine  string `json:"engine"`
	} `json:"results"`
}

type cacheEntry struct {
	at       time.Time
	ttl      time.Duration
	provider string
	items    []searchItem
}

type wsPaid struct {
	name        string
	envKey      string
	envLimit    string
	defLimit    int
	usageFile   string
	fetch       func(q, key string) ([]searchItem, int, string, error)
	isExhausted func(status int, body string) bool
	exhausted   time.Time
}

var (
	usMarketWords = regexp.MustCompile(`(?i)(\bstocks?\b|\bshares?\b|\bearnings\b|\bguidance\b|\beps\b|\bnasdaq\b|\bnyse\b|s&p|\bsp500\b|dow jones|wall street|\bsec\b|10-k|10-q|8-k|13f|price target|\banalysts?\b|\bdividends?\b|buyback|\bipo\b|market cap|pre-?market|after-?hours|\bfomc\b|\bfed\b|treasury|\betf\b|美股|纳斯达克|纳指|标普|道琼斯|道指|华尔街|美联储|美债|中概股)`)
	dollarTicker  = regexp.MustCompile(`\$[A-Za-z]{1,5}\b`)
	upperToken    = regexp.MustCompile(`\b[A-Z]{2,5}\b`)
	htmlTag       = regexp.MustCompile(`<[^>]+>`)
	notTicker     = map[string]bool{"AI": true, "CEO": true, "CFO": true, "USA": true, "US": true, "UK": true, "EU": true,
		"GDP": true, "CPI": true, "PPI": true, "API": true, "IT": true, "PC": true, "TV": true, "OK": true, "FAQ": true,
		"PDF": true, "HTML": true, "UN": true, "EV": true, "VR": true, "AR": true, "LLM": true, "GPU": true, "CPU": true,
		"FY": true, "JSON": true, "HTTP": true, "URL": true}

	searchCache   = map[string]cacheEntry{}
	searchCacheMu sync.Mutex
	wsUsageMu     sync.Mutex

	wsPaidProviders = []*wsPaid{
		{name: "Brave", envKey: "BRAVE_API_KEY", envLimit: "BRAVE_MONTHLY_LIMIT", defLimit: 550,
			usageFile: "data/brave_usage", fetch: braveFetch, isExhausted: braveIsExhausted},
		{name: "SerpApi(Google)", envKey: "SERPAPI_API_KEY", envLimit: "SERPAPI_MONTHLY_LIMIT", defLimit: 240,
			usageFile: "data/serpapi_usage", fetch: serpFetch, isExhausted: serpIsExhausted},
	}
)

func isUSStock(q, category string) bool {
	if category == "stock" {
		return true
	}
	if usMarketWords.MatchString(q) || dollarTicker.MatchString(q) {
		return true
	}
	for _, t := range upperToken.FindAllString(q, -1) {
		if !notTicker[t] {
			return true
		}
	}
	return false
}

func normalizeQuery(q string) string {
	return strings.Join(strings.Fields(strings.ToLower(q)), " ")
}

func cacheGet(key string) (cacheEntry, bool) {
	searchCacheMu.Lock()
	defer searchCacheMu.Unlock()
	e, ok := searchCache[key]
	if !ok || time.Since(e.at) > e.ttl {
		return cacheEntry{}, false
	}
	return e, true
}

func cachePut(key, provider string, items []searchItem, ttl time.Duration) {
	searchCacheMu.Lock()
	defer searchCacheMu.Unlock()
	if len(searchCache) > 500 {
		for k, e := range searchCache {
			if time.Since(e.at) > e.ttl {
				delete(searchCache, k)
			}
		}
		if len(searchCache) > 500 {
			searchCache = map[string]cacheEntry{}
		}
	}
	searchCache[key] = cacheEntry{at: time.Now(), ttl: ttl, provider: provider, items: items}
}

func wsMonthlyLimit(env string, def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv(env))); err == nil && v > 0 {
		return v
	}
	return def
}

// 调用方需持有 wsUsageMu
func wsUsageGet(file string) int {
	b, err := os.ReadFile(file)
	if err != nil {
		return 0
	}
	f := strings.Fields(string(b))
	if len(f) != 2 || f[0] != time.Now().Format("2006-01") {
		return 0
	}
	n, _ := strconv.Atoi(f[1])
	return n
}

// 调用方需持有 wsUsageMu
func wsUsageAdd(file string) int {
	n := wsUsageGet(file) + 1
	_ = os.WriteFile(file, []byte(fmt.Sprintf("%s %d", time.Now().Format("2006-01"), n)), 0644)
	return n
}

// 发请求；出错时去掉 URL（SerpApi 的 key 在 URL 里），避免泄露到工具输出
func wsDoRequest(req *http.Request, timeout time.Duration) ([]byte, int, error) {
	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		if ue, ok := err.(*url.Error); ok {
			err = ue.Err
		}
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return body, resp.StatusCode, nil
}

func braveFetch(q, key string) ([]searchItem, int, string, error) {
	u := "https://api.search.brave.com/res/v1/web/search?" + url.Values{"q": {q}, "count": {"10"}}.Encode()
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, 0, "", err
	}
	req.Header.Set("X-Subscription-Token", key)
	req.Header.Set("Accept", "application/json")
	body, status, err := wsDoRequest(req, 20*time.Second)
	if err != nil || status != http.StatusOK {
		return nil, status, strings.ToLower(string(body)), err
	}
	var br struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
				Age         string `json:"age"`
			} `json:"results"`
		} `json:"web"`
	}
	if json.Unmarshal(body, &br) != nil {
		return nil, status, "", nil
	}
	var items []searchItem
	for _, r := range br.Web.Results {
		content := strings.TrimSpace(htmlTag.ReplaceAllString(r.Description, ""))
		if r.Age != "" {
			content = r.Age + " " + content
		}
		items = append(items, searchItem{Title: r.Title, URL: r.URL, Content: content, Source: "brave"})
	}
	return items, status, "", nil
}

func braveIsExhausted(status int, body string) bool {
	return status == http.StatusPaymentRequired || strings.Contains(body, "quota") ||
		strings.Contains(body, "credit") || strings.Contains(body, "payment")
}

func serpFetch(q, key string) ([]searchItem, int, string, error) {
	u := "https://serpapi.com/search.json?" + url.Values{
		"engine": {"google"}, "q": {q}, "api_key": {key}, "num": {"10"}, "hl": {"en"}, "gl": {"us"},
	}.Encode()
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, 0, "", fmt.Errorf("request error")
	}
	body, status, err := wsDoRequest(req, 30*time.Second)
	if err != nil || status != http.StatusOK {
		return nil, status, strings.ToLower(string(body)), err
	}
	var sr struct {
		Error          string `json:"error"`
		OrganicResults []struct {
			Title   string `json:"title"`
			Link    string `json:"link"`
			Snippet string `json:"snippet"`
			Date    string `json:"date"`
		} `json:"organic_results"`
	}
	if json.Unmarshal(body, &sr) != nil {
		return nil, status, "", nil
	}
	if e := strings.ToLower(sr.Error); strings.Contains(e, "run out") || strings.Contains(e, "limit") {
		return nil, http.StatusTooManyRequests, e, nil
	}
	var items []searchItem
	for _, r := range sr.OrganicResults {
		content := strings.TrimSpace(r.Snippet)
		if r.Date != "" {
			content = r.Date + " " + content
		}
		items = append(items, searchItem{Title: r.Title, URL: r.Link, Content: content, Source: "google (serpapi)"})
	}
	return items, status, "", nil
}

func serpIsExhausted(status int, body string) bool {
	return status == http.StatusTooManyRequests || strings.Contains(body, "run out")
}

// 成功返回 (结果, 来源说明)；失败返回 (nil, 失败原因)
func wsRunProvider(p *wsPaid, q string) ([]searchItem, string) {
	key := strings.TrimSpace(os.Getenv(p.envKey))
	if key == "" {
		return nil, p.name + " not configured"
	}
	limit := wsMonthlyLimit(p.envLimit, p.defLimit)
	wsUsageMu.Lock()
	if time.Since(p.exhausted) < paidSkip {
		wsUsageMu.Unlock()
		return nil, p.name + " quota exhausted"
	}
	used := wsUsageGet(p.usageFile)
	wsUsageMu.Unlock()
	if used >= limit {
		return nil, fmt.Sprintf("%s monthly limit reached (%d/%d)", p.name, used, limit)
	}

	var items []searchItem
	var status int
	var body string
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		items, status, body, err = p.fetch(q, key)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		return nil, fmt.Sprintf("%s request failed: %v", p.name, err)
	}
	if status != http.StatusOK {
		if p.isExhausted(status, body) {
			wsUsageMu.Lock()
			p.exhausted = time.Now()
			wsUsageMu.Unlock()
			return nil, p.name + " quota exhausted"
		}
		return nil, fmt.Sprintf("%s HTTP %d", p.name, status)
	}
	wsUsageMu.Lock()
	used = wsUsageAdd(p.usageFile)
	wsUsageMu.Unlock()
	if len(items) == 0 {
		return nil, p.name + " returned no results"
	}
	return items, fmt.Sprintf("%s (monthly usage %d/%d)", p.name, used, limit)
}

// 返回 (结果, 错误, 是否值得换地址重试)
func searxOnce(base, q string) ([]searchItem, error, bool) {
	u := base + "?" + url.Values{"q": {q}, "format": {"json"}}.Encode()
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err, false
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "SSD-AI-WebSearch/1.0")
	req.Header.Set("X-Real-IP", "127.0.0.1")

	body, status, err := wsDoRequest(req, 20*time.Second)
	if err != nil {
		return nil, fmt.Errorf("web search request failed: %v", err), true
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("web search returned HTTP %d", status), status >= 500
	}
	var result searxSearchResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("error decoding search response: %v", err), false
	}
	items := make([]searchItem, 0, len(result.Results))
	for _, r := range result.Results {
		items = append(items, searchItem{Title: r.Title, URL: r.URL, Content: r.Content, Source: r.Engine})
	}
	return items, nil, false
}

func searxSearch(q string) ([]searchItem, error) {
	var lastErr error
	for _, base := range []string{searxPrimary, searxFallback} {
		items, err, retry := searxOnce(base, q)
		if err == nil {
			return items, nil
		}
		lastErr = err
		if !retry {
			break
		}
	}
	return nil, lastErr
}

func formatResults(query, provider string, items []searchItem) string {
	var out strings.Builder
	out.WriteString(fmt.Sprintf("Web search results for: %s\nProvider: %s\n\n", query, provider))
	n := maxResults
	if len(items) < n {
		n = len(items)
	}
	for i := 0; i < n; i++ {
		it := items[i]
		out.WriteString(fmt.Sprintf("%d. %s\n", i+1, strings.TrimSpace(it.Title)))
		if u := strings.TrimSpace(it.URL); u != "" {
			out.WriteString(fmt.Sprintf("URL: %s\n", u))
		}
		if c := strings.TrimSpace(it.Content); c != "" {
			out.WriteString(fmt.Sprintf("Snippet: %s\n", c))
		}
		if it.Source != "" {
			out.WriteString(fmt.Sprintf("Source: %s\n", it.Source))
		}
		out.WriteString("\n")
	}
	return out.String()
}

func webSearchTool(args string) providers.ToolOutput {
	var params struct {
		Query    string `json:"query"`
		Category string `json:"category"`
	}
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return providers.ToolOutput{Content: fmt.Sprintf("error decoding arguments: %v", err)}
	}
	params.Query = strings.TrimSpace(params.Query)
	if params.Query == "" {
		return providers.ToolOutput{Content: "error: query is required"}
	}

	usePaid := isUSStock(params.Query, params.Category)
	kind, ttl := "general", ttlGeneral
	if usePaid {
		kind, ttl = "stock", ttlStock
	}
	key := kind + "|" + normalizeQuery(params.Query)

	if e, ok := cacheGet(key); ok {
		provider := fmt.Sprintf("%s (cached, %d min ago)", e.provider, int(time.Since(e.at).Minutes()))
		return providers.ToolOutput{Content: formatResults(params.Query, provider, e.items)}
	}

	note := ""
	if usePaid {
		var reasons []string
		for _, p := range wsPaidProviders {
			items, info := wsRunProvider(p, params.Query)
			if items != nil {
				cachePut(key, p.name, items, ttl)
				return providers.ToolOutput{Content: formatResults(params.Query, info, items)}
			}
			reasons = append(reasons, info)
		}
		note = " (" + strings.Join(reasons, "; ") + "; fell back to SearXNG)"
		ttl = ttlFallback
	}

	items, err := searxSearch(params.Query)
	if err != nil {
		return providers.ToolOutput{Content: err.Error()}
	}
	if len(items) == 0 {
		return providers.ToolOutput{Content: fmt.Sprintf("No web search results found for: %s", params.Query)}
	}
	cachePut(key, "SearXNG", items, ttl)
	return providers.ToolOutput{Content: formatResults(params.Query, "SearXNG"+note, items)}
}
