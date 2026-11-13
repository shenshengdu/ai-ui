import { describe, expect, it } from "vitest";
import { aggregate, parseSpec } from "./kline-chart";

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
