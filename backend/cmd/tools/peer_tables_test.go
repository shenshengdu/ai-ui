package tools

import (
	"strings"
	"testing"
)

const ptT71 = "| 维度 | 排序 | V 位置 | 依据 |\n|---|---|---|---|\n| 增长 | MA > AXP > V > PYPL | 第 3/4，靠后 | x |"
const ptT72 = "| 维度 | 排序 | V 位置 |\n|---|---|---|\n| 基本面 | PYPL > V | 第 2/4 |\n\n| 公司 | 基础档位 |\n|---|---|\n| V | 偏积极 |"

func TestPeerTablesFix(t *testing.T) {
	stashPeerTables([]byte(`{"symbol":"V","section_7_1_table":` + ptJQ(ptT71) + `,"section_7_2_table":` + ptJQ(ptT72) + `}`))
	rep := "# Visa（V）研究报告\n\n七、同业比较\n导语\n\n### 7.1 核心对比总览\n以下描述\n\n| 维度 | 结果 |\n|---|---|\n| 增长 | 高于中位数 |\n\n### 7.2 四维综合对比\n并列展示\n\n| 公司 | 基本面 |\n|---|---|\n| V | 良好 |\n\n| 公司 | 基础档位 |\n|---|---|\n| V | 偏积极 |\n四家公司一致。\n\n### 7.3 经营质量\n| a | b |\n|---|---|\n| 1 | 2 |\n"
	out := FixPeerTables(rep)
	if !strings.Contains(out, "MA > AXP > V > PYPL") || !strings.Contains(out, "PYPL > V") {
		t.Fatalf("tables not replaced:\n%s", out)
	}
	if strings.Contains(out, "高于中位数") || strings.Contains(out, "| V | 良好 |") {
		t.Fatalf("old tables remain:\n%s", out)
	}
	if !strings.Contains(out, "| a | b |") || !strings.Contains(out, "四家公司一致。") || !strings.Contains(out, "以下描述") {
		t.Fatalf("other content damaged:\n%s", out)
	}
	if strings.Count(out, "| 公司 | 基础档位 |") != 1 {
		t.Fatalf("tier table count wrong:\n%s", out)
	}
	// 幂等
	if FixPeerTables(out) != out {
		t.Fatalf("not idempotent")
	}
	// 无表格的 7.1：插入
	rep2 := "# Visa（V）研究报告\n### 7.1 核心对比总览\n只有文字。\n\n### 7.2 四维综合对比\n文字\n### 7.3 x\n"
	out2 := FixPeerTables(rep2)
	if !strings.Contains(out2, "MA > AXP > V > PYPL") || !strings.Contains(out2, "只有文字。") {
		t.Fatalf("insert failed:\n%s", out2)
	}
	// 纯文本标题（无 #）
	rep3 := "Visa（V）研究报告\n7.1 核心对比总览\n文字\n7.2 四维综合对比\n文字\n7.3 经营质量与估值中位数\n"
	if !strings.Contains(FixPeerTables(rep3), "MA > AXP > V > PYPL") {
		t.Fatalf("plain heading failed")
	}
	// 非 V、无暂存、无标题
	if FixPeerTables("# 某公司（ZZZZ）研究报告\n### 7.1 核心对比总览\n") != "# 某公司（ZZZZ）研究报告\n### 7.1 核心对比总览\n" {
		t.Fatalf("should be unchanged")
	}
}

func ptJQ(s string) string {
	b := []byte("\"")
	for _, r := range s {
		switch r {
		case '\n':
			b = append(b, '\\', 'n')
		case '"':
			b = append(b, '\\', '"')
		default:
			b = append(b, []byte(string(r))...)
		}
	}
	return string(append(b, '"'))
}
