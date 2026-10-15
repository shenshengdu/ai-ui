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

// 预热状态查询在平台忙时可能超时;此时不报错,告诉用户平台繁忙、预热通常仍在后台进行。
const warmupBusyJSON = `{"state":"busy","message_zh":"平台正忙，没能及时返回预热进度。预热任务通常仍在后台继续，请几分钟后再问；不要连续重复查询，会加重平台负担。"}`

var financeSymbolRe = regexp.MustCompile(`^[A-Z0-9.\-]{1,15}$`)

var financeThemeRe = regexp.MustCompile(`^[a-z_]{1,32}$`)

var financeHTTPClient = &http.Client{}

func isFinanceTool(name string) bool {
	switch name {
	case "finance_stock", "finance_technical", "finance_valuation", "finance_market", "finance_market_news", "finance_decision", "finance_quote", "finance_global_market", "finance_peer_compare", "finance_peer_group_save", "finance_peer_quant", "finance_warmup_status":
		return true
	}
	return false
}

func financeBuiltInTools() []*Tool {
	return append(financeBaseTools(), financeQuickTools()...)
}

func financeBaseTools() []*Tool {
	symbolSchema := `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码，例如 AAPL、NVDA、MSFT、TSLA。"}},"required":["symbol"],"additionalProperties":false}`
	return []*Tool{
		{
			ID:          uuid.New().String(),
			Name:        "finance_stock",
			Description: "获取股票综合金融数据：实时行情、基本面（SEC 口径）、TTM 估值、技术分析，以及 sec_events（SEC 申报：8-K、10-Q/10-K、Form 4 内部人交易、13D/13G 持股）、company_ir（公司 IR 公告与下次财报日；多数公司没有可用订阅，available=false 属正常）、news（多源个股新闻，含 content_level / publisher_count / article_type）、analyst（分析师评级与目标价，为他人观点）、data_context（各模块数据日期与交叉验证警告）和 Google News。证据优先级：SEC 申报 > 公司 IR > 新闻 > 分析师；新闻只是线索，不是事实。某模块无数据或 available=false 时如实说明，不得用记忆补写。适合回答个股分析、估值、财务状况和近期催化剂等问题。",
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
		{
			ID:          uuid.New().String(),
			Name:        "finance_decision",
			Description: "获取个股“决策参考”的结构化结果：由平台用确定性规则，基于基本面/技术面/估值/大盘四个量化模型的原始状态，算出四维打分（10.1）、基础档位（10.2）、6 类风险信号及触发证据（10.3）、最终档位，并预先生成第一节核心结论、10.1–10.3 和第七节四维方向的文字（render）。做综合研究（类型 E）时，在 finance_stock / finance_technical / finance_valuation / finance_market 之后最后调用一次。报告里的最终档位、风险信号数量、核心结论、交叉验证必须原样引用这份结果，不得自行重算或改写档位和数字；第 6 类“已证实的重大负面新闻”不自动触发，需你按 SOP 判断，触发时改用 tier_if_news_signal。大盘基准自动选择：纳斯达克100成分股用 nasdaq100，其余用 sp500。errors 非空表示某模型取数失败，该维度已按缺失处理，必须在数据说明里写明。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"股票代码，例如 AAPL、NVDA、MSFT、TSLA。"},"market":{"type":"string","enum":["sp500","nasdaq100"],"description":"可选：强制指定大盘基准；不传则自动选择。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_peer_group_save",
			Description: "保存同行分组（标准工作流：AI 自动分组 → 人工确认 → 固定分组 → 量化分析）。AI 用 web_search 核实业务后，把平台候选分成五类并先以 status=ai_proposed 保存（提案，不参与统计）；用户在对话里明确确认后，再以 status=approved 且 user_confirmed=true 保存为固定分组。五类：core_symbols 核心同行（业务高度重合）、related_symbols 相关同行（部分重合或同产业链）、special_symbols 特殊场景同行（仅特定场景可参照）、excluded_symbols 不可比、pending_symbols 待核实（证据不足）；同一家公司只能在一个类别里，且至少要有 1 个核心同行才能 approved。evidence 用 {代码: 一句话依据} 记录分类理由。未经用户明确确认，绝不能传 approved 或 user_confirmed=true。这是写入操作，一次对话只在需要时调用。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"被分析的目标公司代码（例如 MSFT），永远不是被分类的同行；每个目标公司只保存一次，同行放进各类别名单，名单里不能包含目标公司自身。"},"status":{"type":"string","enum":["ai_proposed","approved"],"description":"ai_proposed=AI 提案（默认）；approved=用户已确认的固定分组。"},"core_symbols":{"type":"string","description":"核心同行，英文逗号分隔，最多 3 家（超过会被平台拒绝；只保留业务重合度最高的 3 家，其余放 related_symbols）。"},"related_symbols":{"type":"string","description":"相关同行，英文逗号分隔。"},"special_symbols":{"type":"string","description":"特殊场景同行，英文逗号分隔。"},"excluded_symbols":{"type":"string","description":"不可比，英文逗号分隔。"},"pending_symbols":{"type":"string","description":"待核实，英文逗号分隔。"},"evidence":{"type":"object","additionalProperties":{"type":"string"},"description":"可选：{代码: 分类依据}。"},"note":{"type":"string","description":"可选：备注。"},"user_confirmed":{"type":"boolean","description":"仅当用户在对话里明确确认了这份分组时才为 true；status=approved 必须为 true。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_peer_quant",
			Description: "【调用前必须先用 read_skill 读取 us-stock-analysis 的 SOP，并按其中 Step 6.9 执行。】同业量化比较（经营质量、估值、归因）。只在该股票的同行分组已经人工确认并固定后才返回量化结果；分组未固定时只返回第一层并说明原因，此时不得用记忆或网页数字代替，应告诉用户先完成分组确认。返回已确认分组下的核心同行/扩展同行中位数、目标公司相对位置、归因结论、数据限制和 render 文本。只描述相对位置，不排名，不给买卖建议；所有数值和结论只能引用本工具返回的内容，不得自行补算或改写口径。首次调用需要现算每家同行的估值，可能较慢（最长约 3–5 分钟）。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"目标股票代码，例如 V、NVDA。"},"peer_symbols":{"type":"string","description":"可选：用户在本次请求里明确点名的同行代码，英文逗号分隔（例如 MA,AXP）。只在用户自己点名了同行时传；传入后平台直接按这些同行做量化比较，不使用存档分组，也不需要分组确认。symbol 永远是被分析的目标公司，不要把目标公司放进 peer_symbols。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_peer_compare",
			Description: "【调用本工具前，必须先用 read_skill 读取名为 us-stock-analysis 的 SOP（同一对话已读过则不必重复），并严格按其中 Step 6.8 执行：先调用本工具，再用 web_search 核实业务，最后按模板输出；不得只列出平台返回的名单。】同业比较（当前只提供第一层：业务可比性）。以一只股票为中心，返回平台筛选的同类股票（来自 Finnhub，已剔除非美股和市值悬殊的公司）、每家的板块/行业、平台的可比分级和业务描述原文。收入结构、商业模式、产业链位置平台不提供，需要你按 SOP 用 web_search 核实并判定每家同行可比/部分可比/不可比。用户明确给出同行时放进 peer_symbols；不传则由平台自动筛选。返回的 workflow 说明分组是否已经人工确认；已确认的固定分组会自动采用，你不需要也不应该用 core_symbols 改名单。当前版本不返回、也不得推测估值倍数、增速、利润率、同类中位数、溢价/折价或排名；不得给出买卖建议。平台名单缺少可作核心的同行，或最接近的同业被市值比规则误排时，可用 extra_symbols 补充候选重新调用（同一对话最多 1 次），补充的每家必须写明理由，校验未通过的见 group.ai_supplement.rejected。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"目标股票代码，例如 V、AAPL。"},"peer_symbols":{"type":"string","description":"可选：用户明确给出的同行代码，英文逗号分隔，例如 MA,PYPL。不传则自动筛选。"},"core_symbols":{"type":"string","description":"可选：你经 web_search 核实后判定为“可比”的同行代码，英文逗号分隔；用于覆盖平台的行业分级。"},"extra_symbols":{"type":"string","description":"可选：AI 补充候选，英文逗号分隔，最多 5 个。仅当平台名单里没有任何可作核心同行的公司，或业务最接近的同业只因市值比规则被排除（group.excluded 里 kind=size_gap）时使用；平台会校验美股与市值后并入，来源标注 ai_supplement。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_warmup_status",
			Description: "查询平台对某只股票的预热（缓存重建）状态：排队中、进行中（含进度和已用时间）、已完成、失败或无记录。只读、秒级返回、不会触发预热、也不会等待。用于：①做综合研究或同业量化比较前先查一次，把进度告诉用户；②用户问“预热好了吗”。返回的 message_zh 是给用户看的中文说明，转述其中的进度和用时，不要自己推算完成时间。",
			InputSchema: `{"type":"object","properties":{"symbol":{"type":"string","description":"目标股票代码，例如 GOOG、V。"}},"required":["symbol"],"additionalProperties":false}`,
			IsEnabled:   true,
		},
		{
			ID:          uuid.New().String(),
			Name:        "finance_market_news",
			Description: "获取市场层新闻（不针对个股）：货币政策、通胀与就业数据、贸易与地缘、大宗商品、利率汇率、大盘综述、AI/芯片板块、加密、中国/亚洲市场，来自 Finnhub 与 Google News 多源去重聚合。返回 data（按重要性排序的新闻簇，含 themes、scope、publisher_count、content_level、url）和 theme_digest（各主题热度与代表新闻）。只能作为市场背景线索，不是事实：themes 只表示话题，不表示利好利空；theme_digest 条数只反映话题热度，不反映多空方向；content_level=headline_only 时只能复述标题含义，不得补充细节；publisher_count 表示不同发布方数量，同一通讯社稿件被多家转载不等于独立证实。不得据此给出买卖建议或修改任何模型评分。无数据或来源失败时写“暂无市场新闻数据”，不得用记忆补写行情。同一对话只调用一次。",
			InputSchema: `{"type":"object","properties":{"days":{"type":"integer","minimum":1,"maximum":7,"description":"回看天数，默认 2。"},"limit":{"type":"integer","minimum":1,"maximum":40,"description":"最多返回条数，默认 15。"},"theme":{"type":"string","enum":["monetary_policy","inflation_data","growth_jobs","trade_geopolitics","commodities","rates_fx","market_wrap","ai_tech","earnings_season","crypto","china_asia"],"description":"可选：只看某个主题。"}},"additionalProperties":false}`,
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
		Symbol          string            `json:"symbol"`
		Peers           []string          `json:"peers"`
		Market          string            `json:"market"`
		Days            int               `json:"days"`
		Limit           int               `json:"limit"`
		Theme           string            `json:"theme"`
		PeerSymbols     string            `json:"peer_symbols"`
		CoreSymbols     string            `json:"core_symbols"`
		ExtraSymbols    string            `json:"extra_symbols"`
		RelatedSymbols  string            `json:"related_symbols"`
		SpecialSymbols  string            `json:"special_symbols"`
		ExcludedSymbols string            `json:"excluded_symbols"`
		PendingSymbols  string            `json:"pending_symbols"`
		Status          string            `json:"status"`
		UserConfirmed   bool              `json:"user_confirmed"`
		Note            string            `json:"note"`
		Evidence        map[string]string `json:"evidence"`
	}
	if strings.TrimSpace(args) != "" {
		if err := json.Unmarshal([]byte(args), &p); err != nil {
			return financeError("invalid arguments: %v", err)
		}
	}

	var path string
	timeout := 60 * time.Second
	prefix := ""
	method := http.MethodGet
	var reqBody io.Reader

	switch name {
	case "finance_stock", "finance_technical", "finance_valuation", "finance_decision", "finance_peer_compare", "finance_peer_group_save", "finance_peer_quant":
		sym, ok := normalizeSymbol(p.Symbol)
		if !ok {
			return financeError("invalid stock symbol: %q", p.Symbol)
		}
		if name == "finance_peer_group_save" {
			financeWarmReset(sym)
		} else {
			financeWarmEnsure(ctx, base, key, sym)
		}
		switch name {
		case "finance_stock":
			path = "/api/v1/openclaw/stock/" + url.PathEscape(sym)
		case "finance_peer_group_save":
			status := strings.TrimSpace(p.Status)
			if status == "" {
				status = "ai_proposed"
			}
			if status != "ai_proposed" && status != "approved" {
				return financeError("invalid status %q (use ai_proposed or approved)", p.Status)
			}
			if status == "approved" && !p.UserConfirmed {
				return financeError("status=approved requires user_confirmed=true, which is allowed only after the user explicitly confirmed this grouping in the chat")
			}
			groupBody := map[string]any{"status": status, "note": p.Note, "evidence": p.Evidence}
			groupLists := map[string]string{"core": p.CoreSymbols, "related": p.RelatedSymbols, "special": p.SpecialSymbols,
				"excluded": p.ExcludedSymbols, "pending": p.PendingSymbols}
			for cls, raw := range groupLists {
				cleaned := []string{}
				for _, tok := range strings.Split(raw, ",") {
					if strings.TrimSpace(tok) == "" {
						continue
					}
					s2, ok2 := normalizeSymbol(strings.TrimSpace(tok))
					if !ok2 {
						return financeError("invalid symbol %q in %s", tok, cls)
					}
					cleaned = append(cleaned, s2)
				}
				groupBody[cls] = cleaned
			}
			groupJSON, merr := json.Marshal(groupBody)
			if merr != nil {
				return financeError("cannot encode grouping: %v", merr)
			}
			method = http.MethodPut
			reqBody = strings.NewReader(string(groupJSON))
			path = "/api/v1/peer-groups/" + url.PathEscape(sym)
			timeout = 30 * time.Second
		case "finance_peer_quant":
			path = "/api/v1/peer-compare/" + url.PathEscape(sym) + "?layers=all&view=ai&require_review=true"
			if strings.TrimSpace(p.PeerSymbols) != "" {
				var cleanedPeers []string
				for _, tok := range strings.Split(p.PeerSymbols, ",") {
					s2, ok2 := normalizeSymbol(strings.TrimSpace(tok))
					if !ok2 {
						return financeError("invalid symbol %q in peer_symbols", tok)
					}
					cleanedPeers = append(cleanedPeers, s2)
				}
				path += "&peers=" + url.QueryEscape(strings.Join(cleanedPeers, ","))
			}
			timeout = 480 * time.Second
		case "finance_peer_compare":
			path = "/api/v1/peer-compare/" + url.PathEscape(sym)
			timeout = 240 * time.Second
			pq := url.Values{}
			pq.Set("layers", "1")
			for key, raw := range map[string]string{"peers": p.PeerSymbols, "core": p.CoreSymbols, "extra_symbols": p.ExtraSymbols} {
				if strings.TrimSpace(raw) == "" {
					continue
				}
				var cleaned []string
				for _, tok := range strings.Split(raw, ",") {
					s2, ok2 := normalizeSymbol(strings.TrimSpace(tok))
					if !ok2 {
						return financeError("invalid symbol %q in %s", tok, key)
					}
					cleaned = append(cleaned, s2)
				}
				pq.Set(key, strings.Join(cleaned, ","))
			}
			path += "?" + pq.Encode()
		case "finance_decision":
			path = "/api/v1/decision/" + url.PathEscape(sym)
			timeout = 240 * time.Second
			if p.Market == "sp500" || p.Market == "nasdaq100" {
				path += "?market=" + p.Market
			}
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
	case "finance_warmup_status":
		sym, ok := normalizeSymbol(p.Symbol)
		if !ok {
			return financeError("invalid stock symbol: %q", p.Symbol)
		}
		path, timeout = "/api/v1/peer-warmup-status/"+url.PathEscape(sym), 30*time.Second
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
	case "finance_market_news":
		days, limit := p.Days, p.Limit
		if days < 1 || days > 7 {
			days = 2
		}
		if limit < 1 || limit > 40 {
			limit = 15
		}
		path, timeout = fmt.Sprintf("/api/v1/market-news?days=%d&limit=%d", days, limit), 60*time.Second
		if p.Theme != "" {
			if !financeThemeRe.MatchString(p.Theme) {
				return financeError("invalid theme %q", p.Theme)
			}
			path += "&theme=" + url.QueryEscape(p.Theme)
		}
	case "finance_quote":
		sym, ok := normalizeSymbol(p.Symbol)
		if !ok {
			return financeError("invalid stock symbol: %q", p.Symbol)
		}
		path, timeout = "/api/v1/quote/"+url.PathEscape(sym), 15*time.Second
	case "finance_global_market":
		path, timeout = "/api/v1/market", 30*time.Second
	default:
		return financeError("unknown tool %s", name)
	}

	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, method, base+path, reqBody)
	if err != nil {
		return financeError("%v", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	start := time.Now()
	resp, err := financeHTTPClient.Do(req)
	if err != nil {
		log.Error("Finance Platform request failed", "tool", name, "path", path, "err", err)
		if name == "finance_warmup_status" {
			return providers.ToolOutput{Content: warmupBusyJSON}
		}
		return financeError("request failed: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, financeMaxBody))
	log.Info("Finance Platform request", "tool", name, "path", path, "status", resp.StatusCode,
		"bytes", len(body), "duration", time.Since(start))

	if name == "finance_warmup_status" && resp.StatusCode >= 500 {
		return providers.ToolOutput{Content: warmupBusyJSON}
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return financeError("HTTP %d: %s", resp.StatusCode, truncateRunes(string(body), 500))
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, body); err != nil {
		return financeError("invalid JSON: %s", truncateRunes(string(body), 500))
	}
	if name == "finance_peer_quant" {
		stashPeerTables(compact.Bytes())
	}

	switch name {
	case "finance_quote":
		return providers.ToolOutput{Content: formatFinanceQuote(compact.Bytes())}
	case "finance_global_market":
		return providers.ToolOutput{Content: formatGlobalMarket(compact.Bytes())}
	}
	return providers.ToolOutput{Content: prefix + compact.String()}
}
