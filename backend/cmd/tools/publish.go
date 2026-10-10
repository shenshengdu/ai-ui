package tools

// publish_report: publish a finished research report to the SSD AI Research
// Hugo site (GitHub repo -> Vercel) in Chinese, English and Japanese.
//
// The tool requires the user's approval before it runs. It writes
// content/reports/<ticker>-<data_date>/index.{zh,en,ja}.md in ONE commit.
//
// Env (set in /etc/ssd-ai-ui-backend.env):
//   REPORT_GITHUB_TOKEN    fine-grained token, Contents: read & write on the site repo only
//   REPORT_GITHUB_REPO     e.g. shenshengdu/ssd-research
//   REPORT_GITHUB_BRANCH   default main
//   REPORT_SITE_URL        default https://blog.ssd-ai.com
//   Optional translation (used when the model did not supply en / ja itself):
//   REPORT_TRANSLATE_BASE_URL  OpenAI-compatible base, e.g. https://api.openai.com/v1
//   REPORT_TRANSLATE_API_KEY
//   REPORT_TRANSLATE_MODEL     e.g. gpt-6.0-luna

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/google/uuid"
)

func isPublishTool(name string) bool { return name == "publish_report" }

func publishBuiltInTools() []*Tool {
	return []*Tool{{
		ID:   uuid.New().String(),
		Name: "publish_report",
		Description: "把已经完成、并经用户明确确认要公开的研究报告发布到 SSD AI Research 网站（blog.ssd-ai.com），生成中文、English、日本語三个版本。" +
			"只有在用户明确说“发布”时才调用；调用前用户会再审批一次。" +
			"zh.body 是中文报告正文，从“## 一、核心结论”开始，用 ## 作章节标题，不要包含 # 一级标题、数据日期、分析类型这些行（网页顶部会自动显示）。" +
			"tier 与 scores 必须与报告第十节（finance_decision 的结果）完全一致，非综合研究不填 tier。" +
			"en / ja 可省略，省略时由服务器翻译；如果提供，必须是 zh 的忠实翻译，所有数字、日期、代码、表格保持不变。" +
			"summary 是首页卡片上的 2–3 句摘要，不含买卖建议。",
		InputSchema: `{"type":"object","properties":{` +
			`"ticker":{"type":"string","description":"股票代码，如 NVDA；大盘观察用 SPX 或 NDX"},` +
			`"company":{"type":"string","description":"公司英文全称，如 NVIDIA Corporation"},` +
			`"exchange":{"type":"string","description":"交易所，如 NASDAQ、NYSE"},` +
			`"report_type":{"type":"string","enum":["comprehensive","valuation","technical","market","news"]},` +
			`"data_date":{"type":"string","description":"数据日期 YYYY-MM-DD"},` +
			`"tier":{"type":"string","enum":["","positive","mod_positive","neutral","mod_cautious","cautious"],"description":"决策参考档位，仅综合研究填写"},` +
			`"score_sum":{"type":"integer"},` +
			`"scores":{"type":"object","properties":{"fundamental":{"type":["integer","null"]},"technical":{"type":["integer","null"]},"valuation":{"type":["integer","null"]},"market":{"type":["integer","null"]}},"description":"四维分值 1/0/-1，缺失为 null"},` +
			`"aliases_search":{"type":"array","items":{"type":"string"},"description":"搜索别名，如 [\"英伟达\",\"NVIDIA\",\"エヌビディア\"]"},` +
			`"zh":{"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"body":{"type":"string"}},"required":["title","summary","body"]},` +
			`"en":{"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"body":{"type":"string"}}},` +
			`"ja":{"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"body":{"type":"string"}}}` +
			`},"required":["ticker","company","report_type","data_date","zh"]}`,
		RequireApproval: true,
		IsEnabled:       true,
	}}
}

type reportLang struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Body    string `json:"body"`
}

type reportArgs struct {
	Ticker        string          `json:"ticker"`
	Company       string          `json:"company"`
	Exchange      string          `json:"exchange"`
	ReportType    string          `json:"report_type"`
	DataDate      string          `json:"data_date"`
	Tier          string          `json:"tier"`
	ScoreSum      *int            `json:"score_sum"`
	Scores        map[string]*int `json:"scores"`
	AliasesSearch []string        `json:"aliases_search"`
	Zh            *reportLang     `json:"zh"`
	En            *reportLang     `json:"en"`
	Ja            *reportLang     `json:"ja"`
}

var (
	reportTickerRe = regexp.MustCompile(`^[A-Z0-9.\-]{1,15}$`)
	reportDateRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reportNumRe    = regexp.MustCompile(`\d[\d,]*(?:\.\d+)?`)
	reportTypes    = map[string]bool{"comprehensive": true, "valuation": true, "technical": true, "market": true, "news": true}
	reportTiers    = map[string]bool{"": true, "positive": true, "mod_positive": true, "neutral": true, "mod_cautious": true, "cautious": true}
	reportHTTP     = &http.Client{Timeout: 4 * time.Minute}
)

func publishError(format string, a ...any) providers.ToolOutput {
	return providers.ToolOutput{Content: "publish_report error: " + fmt.Sprintf(format, a...)}
}

func publishReportTool(ctx context.Context, args string) providers.ToolOutput {
	token := strings.TrimSpace(os.Getenv("REPORT_GITHUB_TOKEN"))
	repo := strings.TrimSpace(os.Getenv("REPORT_GITHUB_REPO"))
	if token == "" || repo == "" {
		return publishError("REPORT_GITHUB_TOKEN / REPORT_GITHUB_REPO is not configured on the server")
	}
	branch := envOr("REPORT_GITHUB_BRANCH", "main")
	site := strings.TrimRight(envOr("REPORT_SITE_URL", "https://blog.ssd-ai.com"), "/")

	var a reportArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return publishError("invalid arguments: %v", err)
	}
	a.Ticker = strings.ToUpper(strings.TrimSpace(a.Ticker))
	switch {
	case !reportTickerRe.MatchString(a.Ticker):
		return publishError("invalid ticker %q", a.Ticker)
	case !reportTypes[a.ReportType]:
		return publishError("invalid report_type %q", a.ReportType)
	case !reportDateRe.MatchString(a.DataDate):
		return publishError("data_date must be YYYY-MM-DD, got %q", a.DataDate)
	case !reportTiers[a.Tier]:
		return publishError("invalid tier %q", a.Tier)
	case a.Zh == nil || strings.TrimSpace(a.Zh.Title) == "" || strings.TrimSpace(a.Zh.Body) == "":
		return publishError("zh.title and zh.body are required")
	}
	if a.Tier != "" && a.ReportType != "comprehensive" {
		return publishError("tier is only allowed for report_type=comprehensive")
	}
	for k, v := range a.Scores {
		if v != nil && (*v < -1 || *v > 1) {
			return publishError("scores.%s must be -1, 0 or 1", k)
		}
	}
	a.Zh.Body = cleanReportBody(a.Zh.Body)

	var warnings []string
	langs := map[string]*reportLang{"zh": a.Zh}
	type result struct {
		lang     string
		tr       *reportLang
		warnings []string
	}
	results := make(chan result, 2)
	for _, l := range []string{"en", "ja"} {
		var given *reportLang
		if l == "en" {
			given = a.En
		} else {
			given = a.Ja
		}
		go func(l string, given *reportLang) {
			tr, w := prepareTranslation(ctx, a.Zh, l, given)
			results <- result{l, tr, w}
		}(l, given)
	}
	for i := 0; i < 2; i++ {
		r := <-results
		warnings = append(warnings, r.warnings...)
		if r.tr != nil {
			langs[r.lang] = r.tr
		}
	}
	sort.Strings(warnings)

	slug := strings.ToLower(strings.ReplaceAll(a.Ticker, ".", "-")) + "-" + a.DataDate
	now := time.Now().In(tokyo())
	files := map[string]string{}
	for l, r := range langs {
		files[fmt.Sprintf("content/reports/%s/index.%s.md", slug, l)] = renderReport(a, r, now)
	}

	sha, err := githubCommit(ctx, token, repo, branch, files,
		fmt.Sprintf("Publish %s report (%s)", a.Ticker, a.DataDate))
	if err != nil {
		return publishError("GitHub commit failed: %v", err)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "已提交到 %s（%s，commit %s），Vercel 部署约 1–2 分钟后上线：\n", repo, branch, short(sha))
	order := []string{"zh", "en", "ja"}
	for _, l := range order {
		if _, ok := langs[l]; !ok {
			continue
		}
		prefix := ""
		if l != "zh" {
			prefix = "/" + l
		}
		fmt.Fprintf(&b, "- %s: %s%s/reports/%s/\n", l, site, prefix, slug)
	}
	if len(warnings) > 0 {
		b.WriteString("\n需要人工检查：\n")
		for _, w := range warnings {
			b.WriteString("- " + w + "\n")
		}
	}
	return providers.ToolOutput{Content: b.String()}
}

// prepareTranslation returns a checked translation, or nil (with the reason)
// when the language must not be published. A translation whose 亿 amounts do
// not convert correctly is retried once with the problems listed, then dropped.
func prepareTranslation(ctx context.Context, zh *reportLang, lang string, given *reportLang) (*reportLang, []string) {
	var w []string
	tr := given
	feedback := ""
	for attempt := 0; attempt < 2; attempt++ {
		if tr == nil || strings.TrimSpace(tr.Body) == "" {
			t, err := translateReport(ctx, zh, lang, feedback)
			if err != nil {
				return nil, []string{fmt.Sprintf("%s 版未发布：%v", lang, err)}
			}
			tr = t
		}
		tr.Body = cleanReportBody(tr.Body)
		if strings.TrimSpace(tr.Title) == "" {
			tr.Title = zh.Title
		}
		problems := checkUnits(lang, zh.Body+"\n"+zh.Summary, tr.Body+"\n"+tr.Summary)
		if len(problems) == 0 {
			return tr, append(w, checkTranslation(lang, zh.Body, tr.Body)...)
		}
		feedback = "Your previous translation converted these amounts incorrectly. Fix them:\n- " + strings.Join(problems, "\n- ")
		tr = nil // retranslate
		if attempt == 1 {
			list := problems
			if len(list) > 6 {
				list = append(list[:6], "…")
			}
			return nil, []string{fmt.Sprintf("%s 版未发布：金额单位换算两次都不正确（%s）", lang, strings.Join(list, "；"))}
		}
	}
	return nil, nil
}

var reportYiRe = regexp.MustCompile(`(\d[\d,]*(?:\.\d+)?)\s*亿`)

func fmtNum(v float64) string {
	return strconv.FormatFloat(math.Round(v*1e6)/1e6, 'f', -1, 64)
}

// containsAmount reports whether text has num as a standalone number directly
// followed by unit (e.g. "302.969 billion"); commas must already be removed.
func containsAmount(text, num, unit string) bool {
	re := regexp.MustCompile(`(?i)(^|[^\d.])` + regexp.QuoteMeta(num) + `\s*` + unit)
	return re.MatchString(text)
}

// checkUnits verifies every "X亿" amount in the Chinese text: English must show
// X/10 billion, X*100 million or X hundred million; Japanese must keep X億.
func checkUnits(lang, zh, tr string) []string {
	plain := strings.ReplaceAll(tr, ",", "")
	seen := map[string]bool{}
	var bad []string
	for _, m := range reportYiRe.FindAllStringSubmatch(zh, -1) {
		raw := strings.ReplaceAll(m[1], ",", "")
		if seen[raw] {
			continue
		}
		seen[raw] = true
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			continue
		}
		switch lang {
		case "ja":
			if !strings.Contains(plain, raw+"億") {
				bad = append(bad, fmt.Sprintf("%s亿 应写作 %s億", m[1], m[1]))
			}
		default:
			b, mi := fmtNum(v/10), fmtNum(v*100)
			if !containsAmount(plain, b, "(billion|bn)") && !containsAmount(plain, mi, "(million|mn)") && !containsAmount(plain, raw, "hundred[ -]million") {
				bad = append(bad, fmt.Sprintf("%s亿 = %s billion (= %s million)", m[1], b, mi))
			}
		}
	}
	return bad
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func tokyo() *time.Location {
	if l, err := time.LoadLocation("Asia/Tokyo"); err == nil {
		return l
	}
	return time.FixedZone("JST", 9*3600)
}

func short(s string) string {
	if len(s) > 7 {
		return s[:7]
	}
	return s
}

// cleanReportBody drops what the page header already shows: a leading "# title"
// and the 数据日期 / 分析类型 lines before the first "## " heading.
func cleanReportBody(body string) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	lines := strings.Split(body, "\n")
	out := make([]string, 0, len(lines))
	seenH2 := false
	for _, ln := range lines {
		t := strings.TrimSpace(ln)
		if !seenH2 {
			if strings.HasPrefix(t, "## ") {
				seenH2 = true
			} else if strings.HasPrefix(t, "# ") ||
				strings.HasPrefix(t, "数据日期") || strings.HasPrefix(t, "分析类型") ||
				strings.HasPrefix(t, "Data as of") || strings.HasPrefix(t, "Analysis type") ||
				strings.HasPrefix(t, "データ基準日") || strings.HasPrefix(t, "分析タイプ") ||
				strings.HasPrefix(t, "（之后直接进入") ||
				strings.HasPrefix(t, "**数据日期") || strings.HasPrefix(t, "**分析类型") ||
				strings.HasPrefix(t, "决策引用") || strings.HasPrefix(t, "**决策引用") {
				continue
			}
		}
		out = append(out, ln)
	}
	// drop the closing disclaimer line(s); the page adds its own
	for len(out) > 0 {
		t := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(out[len(out)-1]), ">"))
		if t == "" || strings.HasPrefix(t, "本报告基于") || strings.HasPrefix(t, "This report is based on") || strings.HasPrefix(t, "本レポートは") {
			out = out[:len(out)-1]
			continue
		}
		break
	}
	return strings.TrimSpace(strings.Join(out, "\n")) + "\n"
}

func yamlStr(s string) string {
	b, _ := json.Marshal(strings.TrimSpace(s))
	return string(b)
}

func renderReport(a reportArgs, r *reportLang, now time.Time) string {
	var b strings.Builder
	b.WriteString("---\n")
	fmt.Fprintf(&b, "title: %s\n", yamlStr(r.Title))
	fmt.Fprintf(&b, "date: %s\n", now.Format(time.RFC3339))
	fmt.Fprintf(&b, "ticker: %s\n", yamlStr(a.Ticker))
	fmt.Fprintf(&b, "tickers: [%s]\n", yamlStr(a.Ticker))
	fmt.Fprintf(&b, "company: %s\n", yamlStr(a.Company))
	if a.Exchange != "" {
		fmt.Fprintf(&b, "exchange: %s\n", yamlStr(a.Exchange))
	}
	if len(a.AliasesSearch) > 0 {
		q := make([]string, 0, len(a.AliasesSearch))
		for _, s := range a.AliasesSearch {
			q = append(q, yamlStr(s))
		}
		fmt.Fprintf(&b, "aliases_search: [%s]\n", strings.Join(q, ", "))
	}
	fmt.Fprintf(&b, "report_type: %s\n", a.ReportType)
	fmt.Fprintf(&b, "data_date: %s\n", yamlStr(a.DataDate))
	if a.Tier != "" {
		fmt.Fprintf(&b, "tier: %s\n", a.Tier)
	}
	if a.ScoreSum != nil {
		fmt.Fprintf(&b, "score_sum: %d\n", *a.ScoreSum)
	}
	if len(a.Scores) > 0 {
		parts := []string{}
		for _, k := range []string{"fundamental", "technical", "valuation", "market"} {
			if v, ok := a.Scores[k]; ok && v != nil {
				parts = append(parts, fmt.Sprintf("%s: %d", k, *v))
			} else {
				parts = append(parts, k+": null")
			}
		}
		fmt.Fprintf(&b, "scores: {%s}\n", strings.Join(parts, ", "))
	}
	if strings.TrimSpace(r.Summary) != "" {
		fmt.Fprintf(&b, "summary: %s\n", yamlStr(r.Summary))
	}
	b.WriteString("---\n\n")
	b.WriteString(r.Body)
	return b.String()
}

// checkTranslation flags obvious problems: different table row counts and
// numbers from the Chinese text that do not appear in the translation.
func checkTranslation(lang, zh, tr string) []string {
	var w []string
	count := func(s string) int {
		n := 0
		for _, ln := range strings.Split(s, "\n") {
			if strings.HasPrefix(strings.TrimSpace(ln), "|") {
				n++
			}
		}
		return n
	}
	if cz, ct := count(zh), count(tr); cz != ct {
		w = append(w, fmt.Sprintf("%s 版表格行数与中文不同（中文 %d 行，%s %d 行）", lang, cz, lang, ct))
	}
	have := map[string]bool{}
	for _, n := range reportNumRe.FindAllString(tr, -1) {
		have[strings.TrimRight(strings.ReplaceAll(n, ",", ""), ".")] = true
	}
	// 亿 amounts are checked separately by checkUnits (their numbers change in English)
	zhNoYi := reportYiRe.ReplaceAllString(zh, "")
	missing := map[string]bool{}
	for _, n := range reportNumRe.FindAllString(zhNoYi, -1) {
		n = strings.TrimRight(strings.ReplaceAll(n, ",", ""), ".")
		if !have[n] {
			missing[n] = true
		}
	}
	if len(missing) > 0 {
		list := make([]string, 0, len(missing))
		for n := range missing {
			list = append(list, n)
		}
		sort.Strings(list)
		if len(list) > 12 {
			list = append(list[:12], "…")
		}
		w = append(w, fmt.Sprintf("%s 版缺少中文里的这些数字（请核对是否漏译或改动）：%s", lang, strings.Join(list, ", ")))
	}
	return w
}

const enUnitRule = "Chinese 亿 = 100 million. Convert every 亿 amount exactly: X亿美元 = US$(X/10) billion. Examples: 3,029.69亿美元 = US$302.969 billion; 1,080亿美元 = US$108 billion; 890亿美元 = US$89 billion; 9.68亿美元 = US$968 million. Never write X亿 as X billion. A table whose header says 亿美元 may keep its numbers if the header says USD 100 million."

const jaUnitRule = "Japanese 億 equals Chinese 亿: keep every amount number unchanged, e.g. 3,029.69亿美元 = 3,029.69億ドル, 1,080亿 = 1,080億. Never convert to 兆 or 10億 units."

const translateSystem = `You translate Chinese US-equity research reports for a public website.
Rules:
- Translate faithfully. Do not add, remove, summarize or soften anything.
- Keep every number, date, ticker, percentage and table cell value exactly as in the source. Keep Markdown structure, table layout and heading levels unchanged.
- %s
- Fixed terms (tier names): 积极=%s, 偏积极=%s, 中性=%s, 偏谨慎=%s, 谨慎=%s; 决策参考=%s; 综合研究=%s.
- Section headings: translate "一、核心结论" style headings as numbered headings in the target language, keeping the numbering (1., 2., … 10.1 …).
- Model field names and states (e.g. bullish, fair_value, finance_technical.divergence) stay in English as written.
Output exactly this format and nothing else:
<<<TITLE>>>
(translated title)
<<<SUMMARY>>>
(translated summary)
<<<BODY>>>
(translated Markdown body)`

func translateReport(ctx context.Context, src *reportLang, lang, feedback string) (*reportLang, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("REPORT_TRANSLATE_BASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("REPORT_TRANSLATE_API_KEY"))
	model := strings.TrimSpace(os.Getenv("REPORT_TRANSLATE_MODEL"))
	if base == "" || key == "" || model == "" {
		return nil, fmt.Errorf("未配置翻译模型（REPORT_TRANSLATE_*），且调用时没有提供该语言版本")
	}
	var sys, target string
	if lang == "en" {
		target = "English"
		sys = fmt.Sprintf(translateSystem, enUnitRule, "Positive", "Moderately Positive", "Neutral", "Moderately Cautious", "Cautious", "Decision reference", "Comprehensive research")
	} else {
		target = "Japanese"
		sys = fmt.Sprintf(translateSystem, jaUnitRule, "積極", "やや積極", "中立", "やや慎重", "慎重", "判断参考", "総合リサーチ")
	}
	user := fmt.Sprintf("Target language: %s\n\n<<<TITLE>>>\n%s\n<<<SUMMARY>>>\n%s\n<<<BODY>>>\n%s", target, src.Title, src.Summary, src.Body)
	if feedback != "" {
		user += "\n\n" + feedback
	}
	body := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": sys},
			{"role": "user", "content": user},
		},
	}
	if e := strings.TrimSpace(os.Getenv("REPORT_TRANSLATE_EFFORT")); e != "" {
		body["reasoning_effort"] = e
	}
	reqBody, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := reportHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("翻译请求失败: %v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("翻译模型返回 HTTP %d: %s", resp.StatusCode, truncateStr(string(data), 300))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &out); err != nil || len(out.Choices) == 0 {
		return nil, fmt.Errorf("翻译结果无法解析")
	}
	return parseTranslation(out.Choices[0].Message.Content)
}

func parseTranslation(s string) (*reportLang, error) {
	ti := strings.Index(s, "<<<TITLE>>>")
	si := strings.Index(s, "<<<SUMMARY>>>")
	bi := strings.Index(s, "<<<BODY>>>")
	if ti < 0 || si < ti || bi < si {
		return nil, fmt.Errorf("翻译结果格式不对")
	}
	r := &reportLang{
		Title:   strings.TrimSpace(s[ti+len("<<<TITLE>>>") : si]),
		Summary: strings.TrimSpace(s[si+len("<<<SUMMARY>>>") : bi]),
		Body:    strings.TrimSpace(s[bi+len("<<<BODY>>>"):]),
	}
	if r.Body == "" {
		return nil, fmt.Errorf("翻译结果正文为空")
	}
	return r, nil
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// githubCommit writes all files in a single commit via the Git Data API.
func githubCommit(ctx context.Context, token, repo, branch string, files map[string]string, message string) (string, error) {
	api := strings.TrimRight(envOr("REPORT_GITHUB_API", "https://api.github.com"), "/") + "/repos/" + repo
	call := func(method, url string, body any, out any) error {
		var rd io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		}
		req, err := http.NewRequestWithContext(ctx, method, url, rd)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := reportHTTP.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode/100 != 2 {
			return fmt.Errorf("%s %s: HTTP %d %s", method, strings.TrimPrefix(url, api), resp.StatusCode, truncateStr(string(data), 200))
		}
		if out != nil {
			return json.Unmarshal(data, out)
		}
		return nil
	}

	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := call("GET", api+"/git/ref/heads/"+branch, nil, &ref); err != nil {
		return "", err
	}
	var parent struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if err := call("GET", api+"/git/commits/"+ref.Object.SHA, nil, &parent); err != nil {
		return "", err
	}
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	entries := make([]map[string]string, 0, len(files))
	for _, p := range paths {
		entries = append(entries, map[string]string{"path": p, "mode": "100644", "type": "blob", "content": files[p]})
	}
	var tree struct {
		SHA string `json:"sha"`
	}
	if err := call("POST", api+"/git/trees", map[string]any{"base_tree": parent.Tree.SHA, "tree": entries}, &tree); err != nil {
		return "", err
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := call("POST", api+"/git/commits", map[string]any{"message": message, "tree": tree.SHA, "parents": []string{ref.Object.SHA}}, &commit); err != nil {
		return "", err
	}
	if err := call("PATCH", api+"/git/refs/heads/"+branch, map[string]any{"sha": commit.SHA}, nil); err != nil {
		return "", err
	}
	return commit.SHA, nil
}
