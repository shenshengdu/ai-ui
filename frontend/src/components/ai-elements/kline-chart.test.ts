import { describe, expect, it } from "vitest";
import { aggregate, isLiveSymbol, mergeLive, parseSpec, type Bar } from "./kline-chart";

describe("kline spec", () => {
  it("parses and defaults", () => {
    expect(parseSpec('{"symbol":"aapl"}')).toEqual({ symbol: "AAPL", period: "1y", interval: "day", indicators: ["MA", "VOL"] });
    expect(parseSpec('{"symbol":"NVDA","period":"2y","interval":"week","indicators":["macd","boll","x"]}')).toEqual({
      symbol: "NVDA", period: "2y", interval: "week", indicators: ["MACD", "BOLL"],
    });
    expect(parseSpec('{"symbol":"NVDA","period":"10y"}')?.period).toBe("1y");
    expect(parseSpec("not json")).toBeNull();
    expect(parseSpec('{"symbol":"<script>"}')).toBeNull();
  });
});

describe("aggregate", () => {
  const bars = [
    { t: "2026-11-06", o: 9, h: 10, l: 8, c: 9.5, v: 50 },   // 周五
    { t: "2026-11-09", o: 10, h: 12, l: 9, c: 11, v: 100 },  // 周一
    { t: "2026-11-10", o: 11, h: 13, l: 10, c: 12, v: 100 },
    { t: "2026-11-11", o: 12, h: 12.5, l: 7, c: 8, v: 100 },
    { t: "2026-12-01", o: 8, h: 9, l: 7.5, c: 8.5, v: 10 },
  ];
  it("day keeps bars sorted", () => {
    expect(aggregate([...bars].reverse(), "day").map((b) => b.close)).toEqual([9.5, 11, 12, 8, 8.5]);
  });
  it("week groups Monday-start weeks", () => {
    const w = aggregate(bars, "week");
    expect(w).toHaveLength(3);
    expect(w[1]).toMatchObject({ open: 10, high: 13, low: 7, close: 8, volume: 300 });
  });
  it("month groups calendar months", () => {
    const m = aggregate(bars, "month");
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ open: 9, high: 13, low: 7, close: 8, volume: 350 });
  });
});

describe("streaming spec", () => {
  it("partial JSON is not a spec yet, full JSON is", () => {
    const full = '{"symbol":"600519.SH","interval":"week"}';
    expect(parseSpec(full.slice(0, 12))).toBeNull();
    expect(parseSpec(full)?.interval).toBe("week");
  });
});

import { parseParams } from "./kline-chart";

describe("indicator params", () => {
  it("parses and validates", () => {
    expect(parseParams("MA", "5, 10，20 60")).toEqual([5, 10, 20, 60]);
    expect(parseParams("MA", "5,10,20,30,60,120")).toBeNull();          // 最多 5 个
    expect(parseParams("MACD", "12,26")).toBeNull();                     // 要正好 3 个
    expect(parseParams("MACD", "8,17,9")).toEqual([8, 17, 9]);
    expect(parseParams("BOLL", "20, 2.5")).toEqual([20, 2.5]);
    expect(parseParams("RSI", "0")).toBeNull();
    expect(parseParams("RSI", "abc")).toBeNull();
    expect(parseParams("XYZ", "5")).toBeNull();
  });
});

describe("klineCache", () => {
  it("同一范围直接给；有全部历史时截取其他范围；过期不给", async () => {
    const { klineCacheGet, klineCachePut } = await import("./kline-chart");
    const now = Date.parse("2026-11-13T00:00:00Z");
    const bars = ["2020-01-02", "2026-06-01", "2026-11-12"].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }));
    klineCachePut("TEST.SH", "max", bars, "ahdb", now);
    expect(klineCacheGet("TEST.SH", "max", now)?.bars.length).toBe(3);
    expect(klineCacheGet("TEST.SH", "1y", now)?.bars.map((b) => b.t)).toEqual(["2026-06-01", "2026-11-12"]);
    expect(klineCacheGet("TEST.SH", "1y", now + 11 * 60 * 1000)).toBeNull();
    expect(klineCacheGet("OTHER", "1y", now)).toBeNull();
  });
});

describe("aggregate 季 / 年", () => {
  it("按自然季度、自然年合并", () => {
    const b = (t: string, o: number, h: number, l: number, c: number, v: number) => ({ t, o, h, l, c, v });
    const bars = [b("2025-11-03", 10, 12, 9, 11, 100), b("2025-12-31", 11, 15, 10, 14, 200), b("2026-01-02", 14, 16, 13, 15, 50),
      b("2026-03-31", 15, 18, 12, 13, 50), b("2026-04-01", 13, 14, 11, 12, 10)];
    const q = aggregate(bars, "quarter");
    expect(q.map((x) => [x.open, x.high, x.low, x.close, x.volume])).toEqual([[10, 15, 9, 14, 300], [14, 18, 12, 13, 100], [13, 14, 11, 12, 10]]);
    const y = aggregate(bars, "year");
    expect(y.map((x) => [x.open, x.high, x.low, x.close, x.volume])).toEqual([[10, 15, 9, 14, 300], [14, 18, 11, 12, 110]]);
    expect(parseSpec('{"symbol":"AAPL","interval":"quarter"}')?.interval).toBe("quarter");
  });
});

describe("盘中实时这一根", () => {
  const b = (t: string, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 100 });
  const bars = [b("2026-11-11", 10), b("2026-11-12", 11)];
  it("库里还没有今天 → 接上", () => {
    const out = mergeLive(bars, { trading: true, bar: b("2026-11-13", 12) });
    expect(out.map((x) => x.t)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    // 周 K：今天并进本周（11-09 那周）
    const wk = aggregate(out, "week");
    expect(wk).toHaveLength(1);
    expect(wk[0].close).toBe(12);
    expect(wk[0].volume).toBe(300);
  });
  it("库里已经有今天（收盘同步后）或没有实时 → 不变", () => {
    expect(mergeLive(bars, { trading: false, bar: b("2026-11-12", 99) })).toBe(bars);
    expect(mergeLive(bars, null)).toBe(bars);
    expect(mergeLive(bars, { trading: true })).toBe(bars);
  });
  it("A 股、港股、美股、雅虎指数 / 汇率 / 期货都有", () => {
    expect(isLiveSymbol("600519.SH")).toBe(true);
    expect(isLiveSymbol("002594.sz")).toBe(true);
    expect(isLiveSymbol("0700.HK")).toBe(true);
    expect(isLiveSymbol("AAPL")).toBe(true);
    expect(isLiveSymbol("BRK.B")).toBe(true);
    expect(isLiveSymbol("^N225")).toBe(true);
    expect(isLiveSymbol("GC=F")).toBe(true);
    expect(isLiveSymbol("CNY=X")).toBe(true);
    expect(isLiveSymbol("HSI.HK")).toBe(true);
    expect(isLiveSymbol("HSTECH.HK")).toBe(true);
    expect(isLiveSymbol("600519")).toBe(false);
  });
});
