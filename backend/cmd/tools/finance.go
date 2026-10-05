package tools

// Finance Platform tools (ported from the OpenClaw "finance-platform" plugin).
//
// Env (set in /etc/ssd-ai-ui-backend.env):
//   FINANCE_BASE_URL  e.g. http://100.78.38.91:18000   (fixed by the operator, never by the model)
//   FINANCE_API_KEY   sent as X-API-Key

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/google/uuid"
)

const financeMaxBody = 2 << 20 // 2 MiB read limit

var financeSymbolRe = regexp.MustCompile(`^[A-Z0-9.\-]{1,15}$`)

var financeHTTPClient = &http.Client{}

func isFinanceTool(name string) bool {
	switch name {
	case "finance_stock", "finance_technical", "finance_valuation", "finance_market":
		return true
	}
	return false
}

func financeBuiltInTools() []*Tool {
	symbolSchema := `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码，例如 AAPL、NVDA、MSFT、TSLA。"}},"required":["symbol"],"additionalProperties":false}`
	return []*Tool{
		{
			ID:          uuid.New().String(),
			Name:        "finance_stock",
			Description: "获取股票综合金融数据，包括实时行情、基本面、TTM估值、技术分析、Finnhub相关新闻和Google News相关新闻。适合回答个股分析、估值、财务状况和近期催化剂等问题。",
			InputSchema: symbolSchema,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_technical",
			Description: "获取指定股票的 Quant Technical 技术面量化分析。必须以 Finance Platform 返回的 Quant Technical 模型结果为准，不要自行重新计算或修改模型评分。回答时应先给出综合技术面结论，再结合模型中的趋势、动量、价格行为、RSI、MACD、Stochastic、ADX/DI、量价关系、相对强弱、风险和技术背离解释原因。趋势判断应结合短期、中期、长期趋势以及价格结构；ADX 不能单独视为看多或看空，应结合 +DI/-DI 判断方向和趋势强度；RSI 超买超卖应结合趋势环境解释，不能把超买直接等同于看跌或超卖直接等同于看涨；技术背离、量价关系和风险信号应作为确认或警示因素，而不是脱离整体趋势单独下结论。综合评分反映模型对当前技术状态的量化判断，应同时说明主要支撑因素和主要风险因素。",
			InputSchema: symbolSchema,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_valuation",
			Description: "获取指定股票的 Quant Valuation 量化估值分析。必须严格以 Finance Platform 返回的 Quant Valuation 原始结果为准，只能解释和组织模型结果，不得自行重新计算、修改、推导或覆盖任何估值评分、维度评分、指标评分或状态。必须遵守以下规则：1）不得自行重新计算估值分数、维度分数、同行中位数、百分位数或 Overall Score；2）不得补充 Finance Platform 未返回的估值指标、数据、阈值或结论；3）不得自行选择、猜测或编造 peers，只有用户明确提供 peers 时才传入同行比较；4）未提供 peers 时，必须明确说明模型实际返回的 coverage，并说明 peer_relative_valuation 未纳入计算，不得假装是完整六维估值；5）提供 peers 时，必须明确说明 peers_requested、peers_used、peers_failed 和模型返回的 coverage；6）必须区分估值水平与公司基本面质量，Quant Valuation 的 overvalued/undervalued/deeply_overvalued/deeply_undervalued 只描述价格相对于模型估值参考指标的位置，不代表 Fundamental Quality 好坏；7）必须区分当前估值水平与未来股价涨跌，不得根据估值模型推断短期或未来价格方向；8）historical_valuation 必须明确说明是基于历史季度估值倍数分布的历史分位分析，不是 point-in-time 回测；如果模型返回历史分析说明，必须保留其数据口径和限制；9）不得将 valuation 结果转换成买入、卖出、买入区、卖出区、目标价或交易建议；10）不得把 overvalued、undervalued、deeply_overvalued、deeply_undervalued 解释成买卖信号；11）不得自行引入无风险利率、行业估值标准、外部估值阈值或其他模型没有返回的基准来改变模型结论；12）不得对多个股票进行最贵、最便宜、最高、最低、第一、第二、最佳、最健康、最有吸引力等排名或排序；13）不得在多个股票之间创建新的综合排名、评分、胜负关系或“谁更好”的结论；14）如果用户要求比较多个股票，只能逐项展示 Finance Platform 已返回的原始指标、维度分数、状态、coverage 和模型提供的 peer_relative_valuation 结果，不得自行生成新的横向排名；15）如果不同股票的 coverage、历史样本数量或可用指标不同，必须明确指出可比性限制，不得因为某股票 Overall Score 更高就判断其估值一定优于另一股票；16）不得使用“唯一亮点”“核心优势”“最健康”“明显更便宜”“输在某维度”等带有新的综合评价含义的表述，除非该结论本身明确存在于 Finance Platform 原始输出中；17）不得根据公司类型、商业模式、会计结构等外部知识自行修改或弱化模型指标，例如不得因为某公司的 PB 可能具有特殊会计含义而自行调整 PB 对估值结论的权重；18）回答估值分析时，应先给出模型原始 Overall Score、State、Coverage 和数据日期，再按模型实际返回的维度解释主要估值因素，并明确说明缺失维度；19）所有数字、评分、分位数、同行数量、历史周期和状态必须优先引用模型原始输出，不得自行计算；20）估值分析与 Fundamental、Technical、Market 等模型必须保持职责分离；如果同时存在其他模型结果，可以并列引用，但不得把其他模型结果重新混入 Quant Valuation 的评分或排名。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"目标股票代码，例如 AAPL、NVDA、MSFT、TSLA。"},"peers":{"type":"array","items":{"type":"string","description":"可比公司股票代码，例如 MSFT、GOOGL、NVDA、AMZN。"},"maxItems":10,"description":"可选的同行股票代码列表。只有用户明确提供同行，或问题明确要求使用指定同行进行比较时才传入。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_market",
			Description: "获取全球市场综合数据。market=overview 获取全球市场行情；market=nasdaq100 获取纳斯达克100量化分析，包括Trend、Momentum、Volatility、Breadth、Volume、Money Flow、Regime和Composite；market=sp500 获取标普500量化分析，包括Trend、Momentum、Volatility、Breadth、Volume、Money Flow、Regime和Composite。",
			InputSchema: `{"type":"object","properties":{"market":{"type":"string","enum":["overview","nasdaq100","sp500"],"description":"市场类型：overview=全球市场行情，nasdaq100=纳斯达克100量化分析，sp500=标普500量化分析。不传时默认为overview。"}},"additionalProperties":false}`,
			IsEnabled:   true,
		},
	}
}

const valuationOutputPolicy = `VALUATION_OUTPUT_POLICY:
{"comparison_mode":"descriptive_only","cross_stock_ranking":false,"cross_stock_scoring":false,"winner_selection":false,
"allowed":["原始 Overall Score","原始 State","原始 Coverage","原始 valuation metrics","原始 dimension scores","原始 dimension states","原始 historical percentile","原始 peer_relative_valuation","coverage comparability limitations"],
"forbidden":["跨股票贵到便宜排序","跨股票第一第二排名","谁最贵或最便宜","谁最好或最健康","谁更有吸引力","跨股票综合评分","winner / loser","唯一亮点","核心优势","核心劣势","重新综合多个指标形成新结论","使用外部知识修改模型指标含义"]}

FINANCE_PLATFORM_RAW_RESULT:
`

func financeError(format string, a ...any) providers.ToolOutput {
	return providers.ToolOutput{Content: "Finance Platform error: " + fmt.Sprintf(format, a...)}
}

func normalizeSymbol(s string) (string, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	return s, financeSymbolRe.MatchString(s)
}

// financeTool executes one of the finance_* tools.
func financeTool(ctx context.Context, name, args string) providers.ToolOutput {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FINANCE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("FINANCE_API_KEY"))
	if base == "" || key == "" {
		return financeError("FINANCE_BASE_URL / FINANCE_API_KEY is not configured on the server")
	}

	var p struct {
		Symbol string   `json:"symbol"`
		Peers  []string `json:"peers"`
		Market string   `json:"market"`
	}
	if strings.TrimSpace(args) != "" {
		if err := json.Unmarshal([]byte(args), &p); err != nil {
			return financeError("invalid arguments: %v", err)
		}
	}

	var path string
	timeout := 60 * time.Second
	prefix := ""

	switch name {
	case "finance_stock", "finance_technical", "finance_valuation":
		sym, ok := normalizeSymbol(p.Symbol)
		if !ok {
			return financeError("invalid stock symbol: %q", p.Symbol)
		}
		switch name {
		case "finance_stock":
			path = "/api/v1/openclaw/stock/" + url.PathEscape(sym)
		case "finance_technical":
			path = "/api/v1/quant/technical/" + url.PathEscape(sym)
			timeout = 120 * time.Second
		case "finance_valuation":
			path = "/api/v1/quant/valuation/" + url.PathEscape(sym)
			timeout = 120 * time.Second
			prefix = valuationOutputPolicy
			seen := map[string]bool{}
			var peers []string
			for _, raw := range p.Peers {
				if strings.TrimSpace(raw) == "" {
					continue
				}
				peer, ok := normalizeSymbol(raw)
				if !ok {
					return financeError("invalid peer stock symbol: %q", raw)
				}
				if peer == sym {
					return financeError("peer list must not contain target symbol: %s", sym)
				}
				if !seen[peer] {
					seen[peer] = true
					peers = append(peers, url.QueryEscape(peer))
				}
			}
			if len(peers) > 10 {
				return financeError("too many peers: maximum 10")
			}
			if len(peers) > 0 {
				path += "?peers=" + strings.Join(peers, ",")
			}
		}
	case "finance_market":
		switch p.Market {
		case "", "overview":
			path, timeout = "/api/v1/openclaw/market", 90*time.Second
		case "nasdaq100":
			path, timeout = "/api/v1/quant/nasdaq/analysis", 120*time.Second
		case "sp500":
			path, timeout = "/api/v1/quant/sp500/analysis", 120*time.Second
		default:
			return financeError("invalid market %q (use overview, nasdaq100 or sp500)", p.Market)
		}
	default:
		return financeError("unknown tool %s", name)
	}

	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return financeError("%v", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)

	start := time.Now()
	resp, err := financeHTTPClient.Do(req)
	if err != nil {
		log.Error("Finance Platform request failed", "tool", name, "path", path, "err", err)
		return financeError("request failed: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, financeMaxBody))
	log.Info("Finance Platform request", "tool", name, "path", path, "status", resp.StatusCode,
		"bytes", len(body), "duration", time.Since(start))

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return financeError("HTTP %d: %s", resp.StatusCode, truncateRunes(string(body), 500))
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, body); err != nil {
		return financeError("invalid JSON: %s", truncateRunes(string(body), 500))
	}
	return providers.ToolOutput{Content: prefix + compact.String()}
}
