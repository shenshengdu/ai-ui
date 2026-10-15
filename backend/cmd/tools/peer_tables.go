package tools

import (
	"encoding/json"
	"regexp"
	"strings"
	"sync"
	"time"
)

// 同业比较 7.1 / 7.2 的表格由平台生成（finance_peer_quant 返回 section_7_1_table / section_7_2_table）。
// 模型有时会把它们改写成文字，这里在助手消息落库前把对应小节里的表格换回平台原表。
// 找不到小节、没有暂存表、或暂存已过期时不做任何修改。

type peerTables struct {
	t71, t72 string
	at       time.Time
}

var (
	peerTablesMu    sync.Mutex
	peerTablesStore = map[string]peerTables{}
	peerTablesTTL   = 60 * time.Minute
)

func stashPeerTables(body []byte) {
	var r struct {
		Symbol string `json:"symbol"`
		T71    string `json:"section_7_1_table"`
		T72    string `json:"section_7_2_table"`
	}
	if err := json.Unmarshal(body, &r); err != nil || r.Symbol == "" {
		return
	}
	if strings.TrimSpace(r.T71) == "" && strings.TrimSpace(r.T72) == "" {
		return
	}
	peerTablesMu.Lock()
	peerTablesStore[strings.ToUpper(strings.TrimSpace(r.Symbol))] = peerTables{t71: r.T71, t72: r.T72, at: time.Now()}
	peerTablesMu.Unlock()
}

var (
	peerTitleRe = regexp.MustCompile(`[（(]([A-Za-z][A-Za-z0-9.\-]{0,9})[）)]\s*研究报告`)
	peerH71Re   = regexp.MustCompile(`^\s*(?:#{1,6}\s*)?(?:\*\*)?7\.1[\s、.．]*核心对比总览`)
	peerH72Re   = regexp.MustCompile(`^\s*(?:#{1,6}\s*)?(?:\*\*)?7\.2[\s、.．]*四维综合对比`)
	peerH73Re   = regexp.MustCompile(`^\s*(?:#{1,6}\s*)?(?:\*\*)?7\.3[\s、.．]*`)
)

func isTableLine(l string) bool { return strings.HasPrefix(strings.TrimSpace(l), "|") }

// replaceTablesInSpan 把 lines[from:to] 里的第一个表格块换成 table，其余表格块删除（平台表已包含它们）。
// span 内没有表格时，把 table 插在小节标题行之后的第一段文字之后。
func replaceTablesInSpan(lines []string, from, to int, table string) []string {
	out := make([]string, 0, len(lines)+8)
	out = append(out, lines[:from+1]...) // 含标题行
	add := func(l string) {
		blank := strings.TrimSpace(l) == ""
		if n := len(out); n > 0 {
			lastBlank := strings.TrimSpace(out[n-1]) == ""
			if blank && lastBlank {
				return // 不叠加空行
			}
			if !blank && isTableLine(out[n-1]) && !isTableLine(l) {
				out = append(out, "") // 表格后接正文必须隔一个空行
			}
		}
		out = append(out, l)
	}
	placed := false
	i := from + 1
	for i < to {
		if isTableLine(lines[i]) {
			j := i
			for j < to && isTableLine(lines[j]) {
				j++
			}
			if !placed {
				if n := len(out); n > 0 && strings.TrimSpace(out[n-1]) != "" {
					out = append(out, "")
				}
				out = append(out, strings.Split(table, "\n")...)
				placed = true
			}
			i = j
			continue
		}
		add(lines[i])
		i++
	}
	if !placed {
		// 没有任何表格：插在标题后第一个非空行之后
		res := make([]string, 0, len(out)+8)
		res = append(res, out[:from+1]...)
		k := from + 1
		for k < len(out) && strings.TrimSpace(out[k]) == "" {
			res = append(res, out[k])
			k++
		}
		if k < len(out) {
			res = append(res, out[k])
			k++
		}
		res = append(res, "")
		res = append(res, strings.Split(table, "\n")...)
		res = append(res, "")
		res = append(res, out[k:]...)
		out = res
	}
	out = append(out, lines[to:]...)
	return out
}

func findLine(lines []string, re *regexp.Regexp, start int) int {
	for i := start; i < len(lines); i++ {
		if re.MatchString(lines[i]) {
			return i
		}
	}
	return -1
}

// FixPeerTables 返回修复后的报告全文；不满足条件时原样返回。
func FixPeerTables(content string) string {
	m := peerTitleRe.FindStringSubmatch(content)
	if m == nil {
		return content
	}
	sym := strings.ToUpper(m[1])
	peerTablesMu.Lock()
	t, ok := peerTablesStore[sym]
	peerTablesMu.Unlock()
	if !ok || time.Since(t.at) > peerTablesTTL {
		return content
	}
	lines := strings.Split(content, "\n")
	// 先处理 7.2（位于 7.1 之后），避免改动行号影响 7.1
	if strings.TrimSpace(t.t72) != "" {
		h72 := findLine(lines, peerH72Re, 0)
		if h72 >= 0 {
			end := findLine(lines, peerH73Re, h72+1)
			if end < 0 {
				end = len(lines)
			}
			lines = replaceTablesInSpan(lines, h72, end, t.t72)
		}
	}
	if strings.TrimSpace(t.t71) != "" {
		h71 := findLine(lines, peerH71Re, 0)
		if h71 >= 0 {
			end := findLine(lines, peerH72Re, h71+1)
			if end < 0 {
				end = findLine(lines, peerH73Re, h71+1)
			}
			if end < 0 {
				end = len(lines)
			}
			lines = replaceTablesInSpan(lines, h71, end, t.t71)
		}
	}
	return strings.Join(lines, "\n")
}
