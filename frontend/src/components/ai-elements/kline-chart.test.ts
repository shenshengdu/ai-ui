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
