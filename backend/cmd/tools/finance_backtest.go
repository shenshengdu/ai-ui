package tools

// A 股因子回测：阿里云 ah-stock-db 排队跑（约 1~2 分钟一个），结果存在那边；这里经金融平台转发。
//   finance_backtest_factors -> GET  /api/v1/backtest/factors
//   finance_backtest_run     -> POST /api/v1/backtest {spec}（必须先在对话里把策略讲给用户、用户明确同意；然后最多等 150 秒）
//   finance_backtest_get     -> GET  /api/v1/backtest/{id}
//   finance_backtest_list    -> GET  /api/v1/backtests?limit=
// 页面：GET /api/tools/finance/backtests、/api/tools/finance/backtest?id=（右侧回测列表、/backtest/:id 详情页）

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/google/uuid"
)

var backtestIDRe = regexp.MustCompile(`^[0-9a-f]{12}$`)

// 测试里改短
var (
	backtestWait = 150 * time.Second
	backtestPoll = 5 * time.Second
)

const backtestSpecDoc = `策略只能用固定格式（不能写代码）：
{"name":"策略名（中文，简短）",
 "universe":{"pool":"all_a|hs300|zz500|zz1000|sz50","exclude":["st","new_listed_365d","suspended"],"min_avg_amount":30000000,"industries":["行业名关键词，可省略"]},
 "filters":[{"factor":"roe","op":">","value":10},{"factor":"pe_ttm","op":"between","value":[0,30]},{"factor":"mom_6m","op":"top_pct","value":30}],
 "rank":[{"factor":"ep","weight":0.5},{"factor":"roe","weight":0.3},{"factor":"vol_60d","weight":0.2,"order":"asc"}],
 "hold":20,"rebalance":"weekly|monthly|quarterly","weighting":"equal",
 "period":["2015-01-01",null],"benchmark":"000300.SH|000905.SH|000852.SH|000016.SH|000001.SH|399006.SZ",
 "costs":{"commission":0.00025,"stamp_tax_sell":0.0005,"slippage":0.001}}
op：> >= < <= between top_pct bottom_pct（百分比 0~100）；rank 每个因子先横截面排名再按 weight 加权，order 省略用因子默认方向（asc=越小越好）；
hold 1~100 只等权；period 起点不早于 2010-01-01、至少 1 年，终点 null = 最新；省略的字段用默认值。因子名先用 finance_backtest_factors 查。`

func financeBacktestTools() []*Tool {
	return []*Tool{{
		ID:          uuid.New().String(),
		Name:        "finance_backtest_factors",
		Description: "A 股因子回测可用的因子（名字、说明、默认方向）、股票池和基准。用户想回测选股策略时先调它，再按这些因子名设计策略。",
		InputSchema: `{"type":"object","properties":{},"additionalProperties":false}`,
		IsEnabled:   true,
	}, {
		ID:   uuid.New().String(),
		Name: "finance_backtest_run",
		Description: "提交一个 A 股因子选股回测（后复权、按调仓日收盘打分、下一交易日开盘成交、扣佣金印花税滑点、涨跌停买卖不了、退市按最后价卖出；" +
			"附带同候选池随机选股对照和最近几年样本外表现）。" +
			"调用前必须：先用中文把完整策略讲给用户（股票池和排除项、每个筛选条件、打分因子和权重方向、持股数、调仓频率、区间、基准、成本），" +
			"问用户「按这个跑吗？」，用户明确同意后才调用，并带 user_confirmed=true；用户改了就按改后的再确认一次。" +
			"一个回测约 1~2 分钟，排队时更久（每天 18:30–20:30 数据更新期间暂停）；工具最多等 150 秒，没跑完就告诉用户结果会出现在右侧「回测」列表里，稍后可用 finance_backtest_get 查。" +
			"解读结果时数字原样引用，说清楚是历史回测、不代表未来，要提到随机选股对照（策略年化超过了多少比例的随机组合）和样本外表现；" +
			"不要据此给出买卖建议。\n" + backtestSpecDoc,
		InputSchema: `{"type":"object","properties":{"spec":{"type":"object","description":"策略（固定格式，见工具说明）"},` +
			`"user_confirmed":{"type":"boolean","description":"用户已在对话里看过中文策略说明并明确同意运行"}},"required":["spec","user_confirmed"],"additionalProperties":false}`,
		IsEnabled: true,
	}, {
		ID:   uuid.New().String(),
		Name: "finance_backtest_get",
		Description: "查一个回测的状态和结果（id 12 位，来自 finance_backtest_run 或 finance_backtest_list）：排队 / 运行中给进度；完成给指标（年化、最大回撤、夏普、超额、换手）、" +
			"逐年收益、随机选股对照、样本外、诊断（平均候选数、涨跌停买卖不了的次数）和区间末最新选股。",
		InputSchema: `{"type":"object","properties":{"id":{"type":"string","description":"回测 id，12 位十六进制"}},"required":["id"],"additionalProperties":false}`,
		IsEnabled:   true,
	}, {
		ID:          uuid.New().String(),
		Name:        "finance_backtest_list",
		Description: "最近的回测列表（id、策略名、第几次、状态、年化、最大回撤、夏普、超额、随机对照百分位）。用户说「上次那个回测」「之前跑过的」时用它找 id。",
		InputSchema: `{"type":"object","properties":{"limit":{"type":"integer","description":"条数，默认 20，最多 50"}},"additionalProperties":false}`,
		IsEnabled:   true,
	}}
}

func isBacktestTool(name string) bool {
	switch name {
	case "finance_backtest_factors", "finance_backtest_run", "finance_backtest_get", "finance_backtest_list":
		return true
	}
	return false
}

// backtestCall：请求金融平台；返回 HTTP 状态码和 body（错误时 body 里是平台的 detail）
func backtestCall(ctx context.Context, method, path string, body []byte, timeout time.Duration) (int, []byte, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		return 0, nil, fmt.Errorf("服务器没有配置金融平台（FINANCE_BASE_URL / FINANCE_API_KEY）")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := financeHTTPClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, financeMaxBody))
	return resp.StatusCode, b, nil
}

// 平台报错 {"detail": "..."} → 中文原因
func backtestErrText(code int, body []byte) string {
	var e struct {
		Detail any `json:"detail"`
	}
	if json.Unmarshal(body, &e) == nil && e.Detail != nil {
		if s, ok := e.Detail.(string); ok {
			return s
		}
		b, _ := json.Marshal(e.Detail)
		return truncateRunes(string(b), 500)
	}
	return fmt.Sprintf("HTTP %d: %s", code, truncateRunes(string(body), 300))
}

// 给模型看的结果：去掉净值曲线、每期持仓、随机组合明细（页面上看），其余原样
func backtestForModel(body []byte) string {
	var d struct {
		Backtest map[string]any `json:"backtest"`
	}
	if err := json.Unmarshal(body, &d); err != nil || d.Backtest == nil {
		return string(body)
	}
	b := d.Backtest
	if res, ok := b["result"].(map[string]any); ok {
		delete(res, "nav")
		delete(res, "benchmark_nav")
		delete(res, "spec") // 外层已有
		if h, ok := res["holdings"].([]any); ok {
			res["holdings"] = fmt.Sprintf("共 %d 期持仓（页面上看）", len(h))
		}
		if r, ok := res["random"].(map[string]any); ok {
			if xs, ok := r["cagr"].([]any); ok && len(xs) > 0 {
				r["cagr_min"], r["cagr_median"], r["cagr_max"] = xs[0], xs[len(xs)/2], xs[len(xs)-1]
				delete(r, "cagr")
			}
		}
	}
	if id, ok := b["id"].(string); ok {
		b["page"] = "/backtest/" + id
	}
	out, _ := json.Marshal(b)
	return string(out)
}

func backtestStatus(body []byte) string {
	var d struct {
		Backtest struct {
			Status string `json:"status"`
		} `json:"backtest"`
	}
	_ = json.Unmarshal(body, &d)
	return d.Backtest.Status
}

func backtestTool(ctx context.Context, name, args string) providers.ToolOutput {
	var p struct {
		Spec          map[string]any `json:"spec"`
		UserConfirmed bool           `json:"user_confirmed"`
		ID            string         `json:"id"`
		Limit         int            `json:"limit"`
	}
	if strings.TrimSpace(args) != "" {
		if err := json.Unmarshal([]byte(args), &p); err != nil {
			return financeError("invalid arguments: %v", err)
		}
	}
	get := func(path string) ([]byte, error) {
		code, body, err := backtestCall(ctx, http.MethodGet, path, nil, 30*time.Second)
		if err != nil {
			return nil, err
		}
		if code < 200 || code > 299 {
			return nil, fmt.Errorf("%s", backtestErrText(code, body))
		}
		return body, nil
	}
	switch name {
	case "finance_backtest_factors":
		body, err := get("/api/v1/backtest/factors")
		if err != nil {
			return financeError("%v", err)
		}
		return providers.ToolOutput{Content: string(body)}
	case "finance_backtest_list":
		if p.Limit < 1 || p.Limit > 50 {
			p.Limit = 20
		}
		body, err := get("/api/v1/backtests?limit=" + strconv.Itoa(p.Limit))
		if err != nil {
			return financeError("%v", err)
		}
		return providers.ToolOutput{Content: string(body)}
	case "finance_backtest_get":
		id := strings.ToLower(strings.TrimSpace(p.ID))
		if !backtestIDRe.MatchString(id) {
			return financeError("id 是 12 位十六进制：%q", p.ID)
		}
		body, err := get("/api/v1/backtest/" + id + "?full=1")
		if err != nil {
			return financeError("%v", err)
		}
		return providers.ToolOutput{Content: backtestForModel(body)}
	case "finance_backtest_run":
		if !p.UserConfirmed {
			return financeError("先用中文把完整策略讲给用户并得到明确同意，再带 user_confirmed=true 调用")
		}
		if len(p.Spec) == 0 {
			return financeError("spec 不能为空")
		}
		reqBody, _ := json.Marshal(map[string]any{"spec": p.Spec})
		code, body, err := backtestCall(ctx, http.MethodPost, "/api/v1/backtest", reqBody, 30*time.Second)
		if err != nil {
			return financeError("%v", err)
		}
		if code < 200 || code > 299 {
			return financeError("策略不对，改了再给用户确认：%s", backtestErrText(code, body))
		}
		var sub struct {
			Backtest struct {
				ID string `json:"id"`
			} `json:"backtest"`
		}
		_ = json.Unmarshal(body, &sub)
		id := sub.Backtest.ID
		if !backtestIDRe.MatchString(id) {
			return financeError("提交结果没有 id：%s", truncateRunes(string(body), 300))
		}
		// 等它跑完（最多 backtestWait）；对话被取消就不等了
		deadline := time.Now().Add(backtestWait)
		last := body
		var done <-chan struct{}
		if ctx != nil {
			done = ctx.Done()
		}
		for time.Now().Before(deadline) {
			select {
			case <-time.After(backtestPoll):
			case <-done:
				return providers.ToolOutput{Content: `{"note":"已提交，回测在后台继续跑","id":"` + id + `","page":"/backtest/` + id + `"}`}
			}
			b, gerr := get("/api/v1/backtest/" + id + "?full=1")
			if gerr != nil {
				continue
			}
			last = b
			if s := backtestStatus(b); s == "done" || s == "failed" {
				return providers.ToolOutput{Content: backtestForModel(b)}
			}
		}
		return providers.ToolOutput{Content: `{"note":"还没跑完（排队或运行中），结果会出现在右侧「回测」列表；稍后用 finance_backtest_get 查","latest":` +
			backtestForModel(last) + `}`}
	}
	return financeError("unknown tool %s", name)
}

// 页面用：GET /api/tools/finance/backtests?limit=50、GET /api/tools/finance/backtest?id=&full=0|1
func financeBacktestHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	var path string
	if strings.HasSuffix(r.URL.Path, "/backtests") {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit < 1 || limit > 200 {
			limit = 50
		}
		path = "/api/v1/backtests?limit=" + strconv.Itoa(limit)
	} else {
		id := r.URL.Query().Get("id")
		if !backtestIDRe.MatchString(id) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"status":"error","error":"id 是 12 位十六进制"}`))
			return
		}
		full := "1"
		if r.URL.Query().Get("full") == "0" {
			full = "0"
		}
		path = "/api/v1/backtest/" + id + "?full=" + full
	}
	code, body, err := backtestCall(r.Context(), http.MethodGet, path, nil, 30*time.Second)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "error", "error": "回测服务连不上"})
		return
	}
	if code < 200 || code > 299 {
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "error", "error": backtestErrText(code, body)})
		return
	}
	_, _ = w.Write(body)
}
