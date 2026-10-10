package gatewayhealth

// Free-model gateway health page for ai-ui.
//
//   GET /api/gateway-health/       HTML page (login required)
//   GET /api/gateway-health/json   raw summary as JSON
//
// Reads the files written by /opt/litellm/daily_quota.py:
//   MODEL_HEALTH_FILE  (default /opt/litellm/model_health.json)
//   DAILY_QUOTA_STATE  (default /opt/litellm/daily_quota_state.json)
// Thresholds: HEALTH_FAIL_DAYS (default 7), HEALTH_TZ (default Asia/Tokyo).

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/auth"
)

const warnDays = 3

type dayRec struct {
	OK        int    `json:"ok"`
	Fail      int    `json:"fail"`
	LastError string `json:"last_error,omitempty"`
}

type DayCell struct {
	Date  string `json:"date"`
	OK    int    `json:"ok"`
	Fail  int    `json:"fail"`
	Class string `json:"class"` // ok | mixed | fail | none
}

type ModelRow struct {
	Model     string    `json:"model"`
	OK        int       `json:"ok"`
	Fail      int       `json:"fail"`
	Rate      string    `json:"rate"`
	Streak    int       `json:"fail_streak_days"`
	Level     string    `json:"level"` // bad | warn | ok | idle
	Status    string    `json:"status"`
	LastError string    `json:"last_error,omitempty"`
	Days      []DayCell `json:"days"`
	BlockedTo string    `json:"blocked_until,omitempty"`
	Removed   bool      `json:"removed,omitempty"`
}

type Summary struct {
	Generated string     `json:"generated"`
	TZ        string     `json:"tz"`
	Days      int        `json:"days"`
	Models    []ModelRow `json:"models"`
	Alerts    int        `json:"alerts"`
	Warns     int        `json:"warns"`
	Blocked   []ModelRow `json:"-"`
	Error     string     `json:"error,omitempty"`
}

func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", page)
	mux.HandleFunc("GET /json", jsonSummary)
	return http.StripPrefix("/api/gateway-health", auth.Authenticated(mux))
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

var cfgModelRe = regexp.MustCompile(`(?m)^\s*-?\s*(?:model|model_name):\s*["']?([^"'#\s]+)`)

// configuredModels returns model names / litellm model strings present in the
// gateway config, or nil if the config can't be read (then nothing is marked removed).
func configuredModels() map[string]bool {
	b, err := os.ReadFile(env("LITELLM_CONFIG", "/opt/litellm/config.yaml"))
	if err != nil {
		return nil
	}
	set := map[string]bool{}
	for _, m := range cfgModelRe.FindAllStringSubmatch(string(b), -1) {
		set[m[1]] = true
	}
	return set
}

func build() Summary {
	n, err := strconv.Atoi(env("HEALTH_FAIL_DAYS", "7"))
	if err != nil || n <= 0 {
		n = 7
	}
	loc, err := time.LoadLocation(env("HEALTH_TZ", "Asia/Tokyo"))
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	s := Summary{Generated: now.Format("2006-01-02 15:04:05"), TZ: loc.String(), Days: n}

	data := map[string]map[string]dayRec{}
	raw, err := os.ReadFile(env("MODEL_HEALTH_FILE", "/opt/litellm/model_health.json"))
	if err != nil {
		if os.IsNotExist(err) {
			s.Error = "还没有统计数据（网关收到请求后才会生成）"
		} else {
			s.Error = "无法读取统计文件: " + err.Error()
		}
	} else if err := json.Unmarshal(raw, &data); err != nil {
		s.Error = "统计文件格式错误: " + err.Error()
	}

	blocked := map[string]string{}
	if b, err := os.ReadFile(env("DAILY_QUOTA_STATE", "/opt/litellm/daily_quota_state.json")); err == nil {
		_ = json.Unmarshal(b, &blocked)
	}

	configured := configuredModels()

	day := func(i int) string { return now.AddDate(0, 0, -i).Format("2006-01-02") }

	models := make([]string, 0, len(data))
	for m := range data {
		models = append(models, m)
	}
	for m := range blocked {
		if _, ok := data[m]; !ok {
			models = append(models, m)
		}
	}
	sort.Strings(models)

	for _, m := range models {
		days := data[m]
		row := ModelRow{Model: m}
		for i := n - 1; i >= 0; i-- {
			d := day(i)
			r := days[d]
			row.OK += r.OK
			row.Fail += r.Fail
			c := DayCell{Date: d, OK: r.OK, Fail: r.Fail, Class: "none"}
			switch {
			case r.OK > 0 && r.Fail == 0:
				c.Class = "ok"
			case r.OK > 0:
				c.Class = "mixed"
			case r.Fail > 0:
				c.Class = "fail"
			}
			row.Days = append(row.Days, c)
		}
		// consecutive all-failed days, ending today (or yesterday if no calls today)
		start := 0
		if r, ok := days[day(0)]; !ok || r.OK+r.Fail == 0 {
			start = 1
		}
		for k := start; k < start+60; k++ {
			r, ok := days[day(k)]
			if !ok || r.Fail == 0 || r.OK > 0 {
				break
			}
			row.Streak++
		}
		latest := ""
		for d, r := range days {
			if r.LastError != "" && d > latest {
				latest, row.LastError = d, r.LastError
			}
		}
		if row.OK+row.Fail > 0 {
			row.Rate = fmt.Sprintf("%.0f%%", float64(row.OK)*100/float64(row.OK+row.Fail))
		} else {
			row.Rate = "-"
		}
		switch {
		case row.Streak >= n:
			row.Level, row.Status = "bad", fmt.Sprintf("❌ 连续 %d 天调用全部失败，请检查 API Key / 账号", row.Streak)
		case row.Streak >= warnDays:
			row.Level, row.Status = "warn", fmt.Sprintf("⚠️ 连续 %d 天调用全部失败", row.Streak)
		case row.OK+row.Fail == 0:
			row.Level, row.Status = "idle", fmt.Sprintf("💤 近 %d 天无调用", n)
		case row.OK == 0:
			row.Level, row.Status = "warn", "⚠️ 近期只有失败"
		default:
			row.Level, row.Status = "ok", "✅ 正常"
		}
		if configured != nil && !configured[m] {
			row.Removed = true
			row.Level, row.Status = "removed", "🗑 已从网关移除"
		}
		if until, ok := blocked[m]; ok {
			if t, err := time.Parse(time.RFC3339, until); err == nil && t.After(time.Now()) {
				row.BlockedTo = t.In(loc).Format("01-02 15:04")
				s.Blocked = append(s.Blocked, row)
			}
		}
		if _, has := data[m]; has {
			switch row.Level {
			case "bad":
				s.Alerts++
			case "warn":
				s.Warns++
			}
		}
		// removed from gateway and no calls in the window -> drop from the page
		if _, has := data[m]; has && !(row.Removed && row.OK+row.Fail == 0) {
			s.Models = append(s.Models, row)
		}
	}
	// problems first
	rank := map[string]int{"bad": 0, "warn": 1, "ok": 2, "idle": 3, "removed": 4}
	sort.SliceStable(s.Models, func(i, j int) bool { return rank[s.Models[i].Level] < rank[s.Models[j].Level] })
	return s
}

func jsonSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(build())
}

func page(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := tpl.Execute(w, build()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

var tpl = template.Must(template.New("p").Parse(`<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>网关模型状态</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--fg:#1f1f1f;--mute:#777;--line:#e5e5e2;--ok:#2e9d5b;--mixed:#d9a400;--fail:#d64545;--none:#dcdcd8}
@media (prefers-color-scheme:dark){:root{--bg:#1b1b1a;--card:#252524;--fg:#ececea;--mute:#999;--line:#363634;--none:#3a3a38}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mute);font-size:12px;margin-bottom:16px}
.banner{padding:10px 14px;border-radius:8px;margin-bottom:14px;font-weight:600}
.banner.bad{background:color-mix(in srgb,var(--fail) 15%,transparent);color:var(--fail)}
.banner.warn{background:color-mix(in srgb,var(--mixed) 16%,transparent);color:color-mix(in srgb,var(--mixed) 70%,var(--fg))}
.banner.good{background:color-mix(in srgb,var(--ok) 13%,transparent);color:var(--ok)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow-x:auto;margin-bottom:16px}
table{border-collapse:collapse;width:100%;min-width:640px}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;color:var(--mute);font-weight:500}tr:last-child td{border-bottom:0}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.m{font-family:ui-monospace,Menlo,monospace;font-size:13px}
.cells{display:flex;gap:3px}.c{width:14px;height:14px;border-radius:3px;background:var(--none)}
.c.ok{background:var(--ok)}.c.mixed{background:var(--mixed)}.c.fail{background:var(--fail)}
.err{color:var(--mute);font-size:12px;margin-top:4px;word-break:break-all}
tr.removed td{opacity:.5}
tr.bad td{background:color-mix(in srgb,var(--fail) 7%,transparent)}
.legend{color:var(--mute);font-size:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.legend span{display:inline-flex;gap:5px;align-items:center}
h2{font-size:15px;margin:18px 0 8px}
a{color:inherit}
</style></head><body><main>
<h1>免费模型网关 · 模型状态</h1>
<div class="sub">近 {{.Days}} 天 · {{.TZ}} · 生成于 {{.Generated}} · <a href="">刷新</a></div>
{{if .Error}}<div class="banner bad">{{.Error}}</div>{{else}}
{{if .Alerts}}<div class="banner bad">有 {{.Alerts}} 个模型连续 {{.Days}} 天以上调用全部失败，请检查 API Key / 账号</div>{{end}}
{{if .Warns}}<div class="banner warn">有 {{.Warns}} 个模型近期只有失败，请查看下方的错误原因</div>{{end}}
{{if not (or .Alerts .Warns)}}<div class="banner good">所有有调用的模型都有成功记录</div>{{end}}{{end}}
<div class="card"><table>
<tr><th>模型</th><th>每日（旧 → 今天）</th><th class="n">成功</th><th class="n">失败</th><th class="n">成功率</th><th>状态</th></tr>
{{range .Models}}<tr class="{{.Level}}"><td class="m">{{.Model}}</td>
<td><div class="cells">{{range .Days}}<div class="c {{.Class}}" title="{{.Date}}  成功 {{.OK}} / 失败 {{.Fail}}"></div>{{end}}</div></td>
<td class="n">{{.OK}}</td><td class="n">{{.Fail}}</td><td class="n">{{.Rate}}</td>
<td>{{.Status}}{{if .BlockedTo}}<br>⏸ 额度用完，屏蔽至 {{.BlockedTo}}{{end}}{{if and .LastError (or (eq .Level "bad") (eq .Level "warn"))}}<div class="err">最近错误：{{.LastError}}</div>{{end}}</td></tr>
{{end}}</table></div>
<div class="legend"><span><i class="c ok"></i>全部成功</span><span><i class="c mixed"></i>有成功有失败</span><span><i class="c fail"></i>全部失败</span><span><i class="c"></i>无调用</span><span>鼠标悬停方块可看当天次数</span></div>
{{if .Blocked}}<h2>⏸ 今日额度已用完（暂停调用）</h2><div class="card"><table>
<tr><th>模型</th><th>恢复时间</th></tr>{{range .Blocked}}<tr><td class="m">{{.Model}}</td><td>{{.BlockedTo}}</td></tr>{{end}}</table></div>{{end}}
</main></body></html>`))
