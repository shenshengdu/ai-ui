/**
 * AI 操作左边 K 线图：回答里的 ```chart 代码块 → 动作列表。
 *   {"actions":[{"type":"hline","price":1380,"label":"支撑","kind":"support"}, {"type":"interval","value":"week"}, …]}
 */
import { INTERVALS, type Interval } from "@/components/ai-elements/kline-chart";

export type ChartAction =
  | { type: "hline"; price: number; label?: string; kind?: "support" | "resistance" | "other" }
  | { type: "range"; from: string; to: string; label?: string }
  | { type: "interval"; value: Interval }
  | { type: "indicators"; add?: string[]; remove?: string[] }
  | { type: "symbol"; value: string }
  | { type: "compare"; symbols: string[] }
  | { type: "clear" };

export const CHART_INDICATORS = ["MA", "EMA", "BOLL", "VOL", "MACD", "KDJ", "RSI"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[\^A-Z0-9.\-=]{1,15}$/;

const label = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : undefined);
const inds = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => String(x).toUpperCase()).filter((x) => CHART_INDICATORS.includes(x)) : undefined;

/** 解析并校验（不认识、不合法的动作丢掉；最多 20 个） */
export function parseChartActions(code: string): ChartAction[] {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { actions?: unknown })?.actions) ? (raw as { actions: unknown[] }).actions : [raw];
  const out: ChartAction[] = [];
  for (const a of list.slice(0, 20)) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    switch (o.type) {
      case "hline": {
        const price = Number(o.price);
        if (Number.isFinite(price) && price > 0) {
          const kind = o.kind === "support" || o.kind === "resistance" ? o.kind : "other";
          out.push({ type: "hline", price, label: label(o.label), kind });
        }
        break;
      }
      case "range":
        if (typeof o.from === "string" && typeof o.to === "string" && DATE.test(o.from) && DATE.test(o.to)) {
          const [from, to] = o.from <= o.to ? [o.from, o.to] : [o.to, o.from];
          out.push({ type: "range", from, to, label: label(o.label) });
        }
        break;
      case "interval":
        if ((INTERVALS as string[]).includes(String(o.value))) out.push({ type: "interval", value: o.value as Interval });
        break;
      case "indicators": {
        const add = inds(o.add), remove = inds(o.remove);
        if (add?.length || remove?.length) out.push({ type: "indicators", add, remove });
        break;
      }
      case "symbol": {
        const v = String(o.value ?? "").trim().toUpperCase();
        if (SYMBOL.test(v)) out.push({ type: "symbol", value: v });
        break;
      }
      case "compare": {
        const syms = Array.isArray(o.symbols) ? o.symbols.map((x) => String(x).trim().toUpperCase()).filter((x) => SYMBOL.test(x)) : [];
        if (syms.length) out.push({ type: "compare", symbols: [...new Set(syms)].slice(0, 5) });
        break;
      }
      case "clear":
        out.push({ type: "clear" });
        break;
    }
  }
  return out;
}

/** 回答里所有 ```chart 块的动作（流式输出完再执行） */
export function extractChartActions(markdown: string): ChartAction[] {
  const out: ChartAction[] = [];
  const re = /```chart[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) out.push(...parseChartActions(m[1]));
  return out;
}

const IV_ZH: Record<Interval, string> = { day: "日K", week: "周K", month: "月K", quarter: "季K", year: "年K" };

/** 按钮上的简短说明 */
export function describeActions(actions: ChartAction[]): string {
  return actions
    .map((a) => {
      switch (a.type) {
        case "hline":
          return a.label || `${a.kind === "support" ? "支撑" : a.kind === "resistance" ? "压力" : "价位"} ${a.price}`;
        case "range":
          return a.label || `${a.from}~${a.to}`;
        case "interval":
          return IV_ZH[a.value];
        case "indicators":
          return [...(a.add ?? []).map((x) => `+${x}`), ...(a.remove ?? []).map((x) => `-${x}`)].join(" ");
        case "symbol":
          return `→ ${a.value}`;
        case "compare":
          return `对比 ${a.symbols.join("、")}`;
        case "clear":
          return "清除标注";
      }
      return "";
    })
    .filter(Boolean)
    .join(" · ");
}
