import { describe, expect, it } from "vitest";
import { drawdown, fmtPct, platformSymbol, fetchBacktest, marketOf } from "./api";
import { filterText, fmtAmount, rankText } from "./labels";

describe("backtest helpers", () => {
  it("formats", () => {
    expect(fmtPct(12.345)).toBe("12.3%");
    expect(fmtPct(3, 1, true)).toBe("+3.0%");
    expect(fmtPct(null)).toBe("—");
    expect(platformSymbol("sh.600519")).toBe("600519.SH");
    expect(platformSymbol("sz.000001")).toBe("000001.SZ");
    expect(fmtAmount(5e7, "zh")).toBe("5000 万元");
    expect(fmtAmount(3e8, "zh")).toBe("3 亿元");
    expect(fmtAmount(2e7, "zh", "US")).toBe("2000 万美元");
    expect(platformSymbol("hk.00700")).toBe("00700.HK");
    expect(platformSymbol("us.BRK.B")).toBe("BRK.B");
    expect(marketOf({})).toBe("A");
    expect(marketOf({ spec: { market: "HK" } })).toBe("HK");
  });
  it("drawdown", () => {
    expect(drawdown([["a", 1], ["b", 1.2], ["c", 0.9], ["d", 1.3]]).map((x) => +x[1].toFixed(1))).toEqual([0, 0, -25, 0]);
  });
  it("spec text", () => {
    expect(filterText({ factor: "pe_ttm", op: "between", value: [0, 30] }, "PE", "zh")).toBe("PE 介于 0 ~ 30");
    expect(filterText({ factor: "mom_6m", op: "top_pct", value: 30 }, "6M", "zh")).toBe("6M 前 30%");
    expect(rankText({ factor: "vol_60d", weight: 0.2, order: "asc" }, "波动", "zh")).toBe("波动 × 0.2（越小越好）");
    expect(filterText({ factor: "ma_bull_20_60", op: "==", value: 1 }, "20 日均线在 60 日均线上方（1 是 / 0 否）", "zh")).toBe(
      "20 日均线在 60 日均线上方：是",
    );
    expect(filterText({ factor: "macd_gold", op: "==", value: 0 }, "近 5 日内 MACD 金叉（DIF 上穿 DEA，1 / 0）", "zh")).toMatch(/：否$/);
    expect(filterText({ factor: "rsi_14", op: "==", value: 30 }, "RSI", "zh")).toBe("RSI = 30");
  });
  it("fetch error", async () => {
    const f = (async () => new Response(JSON.stringify({ status: "error", error: "没有这个回测" }), { status: 404 })) as typeof fetch;
    await expect(fetchBacktest("abcdef012345", true, f)).rejects.toThrow("没有这个回测");
  });
});

import { changeLegends } from "@/components/ai-elements/kline-chart";

describe("kline legend change", () => {
  it("shows amount and percent vs previous close", () => {
    const up = changeLegends({ close: 100 }, { close: 101.5 }).find((x) => x.title === "change")!.value as { text: string; color: string };
    expect(up.text).toBe("+1.50（+1.50%）");
    expect(up.color).toBe("#F92855");
    const dn = changeLegends({ close: 386.6 }, { close: 380 }).find((x) => x.title === "change")!.value as { text: string; color: string };
    expect(dn.text).toBe("-6.60（-1.71%）");
    expect(dn.color).toBe("#2DC08E");
    expect(changeLegends(null, { close: 5 }).some((x) => x.title === "change")).toBe(false);
  });
});

import { startLivePolling, type LiveQuote } from "@/components/ai-elements/kline-chart";
import { vi } from "vitest";

describe("live polling", () => {
  const fakeDoc = () => {
    const ls: (() => void)[] = [];
    return {
      hidden: false,
      addEventListener: (_: string, f: () => void) => void ls.push(f),
      removeEventListener: (_: string, f: () => void) => void ls.splice(ls.indexOf(f), 1),
      fire: () => ls.forEach((f) => f()),
      count: () => ls.length,
    };
  };
  it("polls every 60s while trading, pauses when hidden, slows down when closed and resumes at open", async () => {
    vi.useFakeTimers();
    const doc = fakeDoc();
    let trading = true;
    const fetchQuote = vi.fn(async (): Promise<LiveQuote | null> => ({ trading }));
    const got: LiveQuote[] = [];
    const stop = startLivePolling(fetchQuote, (q) => got.push(q), 60_000, doc as unknown as Document, 300_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    doc.hidden = true; // 切到后台：不再取
    doc.fire();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    doc.hidden = false; // 切回来：马上取一次，继续每 60 秒
    doc.fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQuote).toHaveBeenCalledTimes(3);
    trading = false; // 午休 / 收盘：改成每 5 分钟看一次
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchQuote).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(299_000);
    expect(fetchQuote).toHaveBeenCalledTimes(4);
    trading = true; // 开盘：下一次检查发现在交易，回到每 60 秒
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchQuote).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchQuote).toHaveBeenCalledTimes(6);
    expect(got.length).toBe(6);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchQuote).toHaveBeenCalledTimes(6);
    expect(doc.count()).toBe(0);
    vi.useRealTimers();
  });
  it("keeps checking slowly when the quote can't be fetched", async () => {
    vi.useFakeTimers();
    const fetchQuote = vi.fn(async () => null);
    const stop = startLivePolling(fetchQuote, () => {}, 1000, fakeDoc() as unknown as Document, 5000);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(fetchQuote).toHaveBeenCalledTimes(3); // 0s、5s、10s：按慢的间隔
    stop();
    vi.useRealTimers();
  });
});
