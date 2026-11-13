import { describe, expect, it } from "vitest";
import { describeActions, extractChartActions, parseChartActions } from "./chart-actions";

describe("chart actions", () => {
  it("解析、校验、丢掉不合法的", () => {
    const a = parseChartActions(JSON.stringify({ actions: [
      { type: "hline", price: "1380", label: "支撑 1380", kind: "support" },
      { type: "hline", price: -1 },
      { type: "range", from: "2026-04-15", to: "2026-03-01", label: "箱体" },
      { type: "range", from: "昨天", to: "今天" },
      { type: "interval", value: "week" },
      { type: "interval", value: "hour" },
      { type: "indicators", add: ["macd", "foo"], remove: ["BOLL"] },
      { type: "symbol", value: "0700.hk" },
      { type: "symbol", value: "../x" },
      { type: "clear" },
      { type: "rm -rf" },
    ] }));
    expect(a).toEqual([
      { type: "hline", price: 1380, label: "支撑 1380", kind: "support" },
      { type: "range", from: "2026-03-01", to: "2026-04-15", label: "箱体" },
      { type: "interval", value: "week" },
      { type: "indicators", add: ["MACD"], remove: ["BOLL"] },
      { type: "symbol", value: "0700.HK" },
      { type: "clear" },
    ]);
    expect(parseChartActions("不是 JSON")).toEqual([]);
    expect(parseChartActions('{"type":"hline","price":10}')).toEqual([{ type: "hline", price: 10, label: undefined, kind: "other" }]);
  });
  it("从回答里取 ```chart 块；说明文字", () => {
    const md = '分析……\n\n```chart\n{"actions":[{"type":"hline","price":1460,"kind":"resistance"},{"type":"interval","value":"week"}]}\n```\n';
    const a = extractChartActions(md);
    expect(a.length).toBe(2);
    expect(describeActions(a)).toBe("压力 1460 · 周K");
    expect(extractChartActions("```chart\n{半截")).toEqual([]);
  });
});
