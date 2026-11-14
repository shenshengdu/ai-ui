import { describe, expect, it } from "vitest";
import { drawdown, fmtPct, platformSymbol, fetchBacktest } from "./api";
import { filterText, fmtAmount, rankText } from "./labels";

describe("backtest helpers", () => {
  it("formats", () => {
    expect(fmtPct(12.345)).toBe("12.3%");
    expect(fmtPct(3, 1, true)).toBe("+3.0%");
    expect(fmtPct(null)).toBe("—");
    expect(platformSymbol("sh.600519")).toBe("600519.SH");
    expect(platformSymbol("sz.000001")).toBe("000001.SZ");
    expect(fmtAmount(5e7, "zh")).toBe("5000 万");
    expect(fmtAmount(3e8, "zh")).toBe("3 亿");
  });
  it("drawdown", () => {
    expect(drawdown([["a", 1], ["b", 1.2], ["c", 0.9], ["d", 1.3]]).map((x) => +x[1].toFixed(1))).toEqual([0, 0, -25, 0]);
  });
  it("spec text", () => {
    expect(filterText({ factor: "pe_ttm", op: "between", value: [0, 30] }, "PE", "zh")).toBe("PE 介于 0 ~ 30");
    expect(filterText({ factor: "mom_6m", op: "top_pct", value: 30 }, "6M", "zh")).toBe("6M 前 30%");
    expect(rankText({ factor: "vol_60d", weight: 0.2, order: "asc" }, "波动", "zh")).toBe("波动 × 0.2（越小越好）");
  });
  it("fetch error", async () => {
    const f = (async () => new Response(JSON.stringify({ status: "error", error: "没有这个回测" }), { status: 404 })) as typeof fetch;
    await expect(fetchBacktest("abcdef012345", true, f)).rejects.toThrow("没有这个回测");
  });
});
