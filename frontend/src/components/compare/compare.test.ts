import { describe, expect, it } from "vitest";
import { closesOf, normalize, parseSymbols, pickComparable, stats } from "./compare";

const bar = (t: string, c: number) => ({ t, o: c, h: c, l: c, c, v: 1 });

describe("compare", () => {
  it("共同起点、缺的沿用前一天", () => {
    const a = closesOf("A", [bar("2026-01-02", 10), bar("2026-01-05", 11), bar("2026-01-06", 12)], "day");
    const b = closesOf("B", [bar("2026-01-05", 100), bar("2026-01-07", 90)], "day");     // 晚一天才有
    const n = normalize([a, b]);
    expect(n.start).toBe("2026-01-05");
    expect(n.dates).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
    expect(n.lines[0].pct.map((x) => Math.round((x ?? NaN) * 100) / 100)).toEqual([0, 9.09, 9.09]);
    expect(n.lines[1].pct.map((x) => Math.round((x ?? NaN) * 100) / 100)).toEqual([0, 0, -10]);
  });
  it("统计：涨跌、最大回撤、波动率", () => {
    const a = closesOf("A", [bar("2026-01-02", 100), bar("2026-01-05", 120), bar("2026-01-06", 90), bar("2026-01-07", 110)], "day");
    const [s] = stats(normalize([a]), "day");
    expect(s.returnPct).toBeCloseTo(10);
    expect(s.maxDrawdownPct).toBeCloseTo(-25);
    expect(s.volPct).toBeGreaterThan(0);
  });
  it("代码列表", () => {
    expect(parseSymbols("600519.sh, 000858.SZ,600519.SH,../x,A,B,C,D,E")).toEqual(["600519.SH", "000858.SZ", "A", "B", "C", "D"]);
    expect(parseSymbols(null)).toEqual([]);
  });
});

describe("pickComparable", () => {
  it("优先共同的最近一期；没有就各取最新", () => {
    const r = pickComparable({ A: [{ report_date: "2026-09-30" }, { report_date: "2026-06-30" }], B: [{ report_date: "2026-06-30" }] });
    expect(r.same).toBe(true);
    expect(r.date).toBe("2026-06-30");
    const r2 = pickComparable({ A: [{ report_date: "2026-09-30" }], B: [{ report_date: "2026-03-31" }] });
    expect(r2.same).toBe(false);
    expect(r2.rows.B?.report_date).toBe("2026-03-31");
  });
});
