/** 同行对比：对齐日期、换算成同一起点的累计涨跌幅、区间统计 */
import { aggregate, type Bar, type Interval } from "@/components/ai-elements/kline-chart";

export const MAX_COMPARE = 6;
export const COMPARE_RANGES = ["3mo", "6mo", "1y", "2y", "5y"] as const;
export type CompareRange = (typeof COMPARE_RANGES)[number];

export type Series = { symbol: string; closes: Map<string, number> };
export type Normalized = { dates: string[]; lines: { symbol: string; pct: (number | null)[] }[]; start: string | null };

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** 日 K → 收盘序列（按周期合并：周 / 月取最后一天收盘，日期记为该周期第一个交易日） */
export function closesOf(symbol: string, bars: Bar[], interval: Interval): Series {
  const m = new Map<string, number>();
  for (const k of aggregate(bars, interval)) m.set(day(k.timestamp), k.close);
  return { symbol, closes: m };
}

/** 共同起点 = 各只第一天里最晚的（新股、数据短的不会被拉低）；之后的日期取并集，缺的沿用前一天 */
export function normalize(series: Series[]): Normalized {
  const firsts = series.map((s) => [...s.closes.keys()].sort()[0]).filter(Boolean) as string[];
  if (!series.length || firsts.length < series.length) return { dates: [], lines: [], start: null };
  const start = firsts.sort()[firsts.length - 1];
  const dates = [...new Set(series.flatMap((s) => [...s.closes.keys()]))].filter((d) => d >= start).sort();
  const lines = series.map((s) => {
    let last: number | null = null;
    let base: number | null = null;
    const pct = dates.map((d) => {
      const c = s.closes.get(d);
      if (c != null) last = c;
      if (base == null && last != null) base = last;
      return last != null && base ? (last / base - 1) * 100 : null;
    });
    return { symbol: s.symbol, pct };
  });
  return { dates, lines, start };
}

export type Stats = { symbol: string; returnPct: number | null; maxDrawdownPct: number | null; volPct: number | null };

/** 区间涨跌、最大回撤、年化波动率（按周期换算：日 252、周 52、月 12、季 4、年 1） */
export function stats(n: Normalized, interval: Interval): Stats[] {
  const per = { day: 252, week: 52, month: 12, quarter: 4, year: 1 }[interval];
  return n.lines.map(({ symbol, pct }) => {
    const v = pct.filter((x): x is number => x != null).map((x) => 1 + x / 100);
    if (v.length < 2) return { symbol, returnPct: null, maxDrawdownPct: null, volPct: null };
    let peak = v[0];
    let mdd = 0;
    const rets: number[] = [];
    for (let i = 0; i < v.length; i++) {
      peak = Math.max(peak, v[i]);
      mdd = Math.min(mdd, v[i] / peak - 1);
      if (i > 0 && v[i - 1] > 0) rets.push(Math.log(v[i] / v[i - 1]));
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    return { symbol, returnPct: (v[v.length - 1] / v[0] - 1) * 100, maxDrawdownPct: mdd * 100, volPct: sd * Math.sqrt(per) * 100 };
  });
}

/** URL 里的代码列表：大写、去重、校验、最多 6 只 */
export function parseSymbols(raw: string | null): string[] {
  const out: string[] = [];
  for (const s of (raw || "").split(",")) {
    const v = s.trim().toUpperCase();
    if (v && /^[\^A-Z0-9.\-=]{1,15}$/.test(v) && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_COMPARE);
}

export type FinLike = { report_date: string; period_type?: string | null };

/** 财务对比用哪一期：优先最近一个大家都有的报告期（同期可比）；没有共同的就各取最新一期 */
export function pickComparable<T extends FinLike>(rowsBySymbol: Record<string, T[]>): { same: boolean; date: string | null; rows: Record<string, T | null> } {
  const syms = Object.keys(rowsBySymbol);
  const sets = syms.map((s) => new Set((rowsBySymbol[s] ?? []).map((r) => r.report_date)));
  const common = [...(sets[0] ?? new Set<string>())].filter((d) => sets.every((x) => x.has(d))).sort().reverse();
  if (syms.length && common.length) {
    const d = common[0];
    return { same: true, date: d, rows: Object.fromEntries(syms.map((s) => [s, rowsBySymbol[s].find((r) => r.report_date === d) ?? null])) };
  }
  const rows = Object.fromEntries(
    syms.map((s) => [s, [...(rowsBySymbol[s] ?? [])].sort((a, b) => b.report_date.localeCompare(a.report_date))[0] ?? null]),
  );
  return { same: false, date: null, rows };
}
