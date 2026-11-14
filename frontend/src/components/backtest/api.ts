/**
 * 回测（A 股因子选股）：后端 /api/tools/finance/backtests、/api/tools/finance/backtest?id=
 * → 金融平台 → 阿里云 ah-stock-db 的回测队列。回测只能在对话里让 AI 提交（先确认策略）。
 */
import { getHeaders } from "@/lib/api/headers";

export type BacktestStatus = "queued" | "running" | "done" | "failed";

export type BacktestSummary = {
  cagr?: number | null;
  max_drawdown?: number | null;
  sharpe?: number | null;
  benchmark_cagr?: number | null;
  annual_excess?: number | null;
  random_percentile?: number | null;
  start?: string;
  end?: string;
  picks?: number;
};

export type BacktestItem = {
  id: string;
  created_at?: string;
  name: string;
  attempt?: number;
  status: BacktestStatus;
  stage?: string | null;
  progress?: number | null;
  summary?: BacktestSummary | null;
  error?: string | null;
  finished_at?: string | null;
};

export type Metrics = {
  total_return?: number;
  cagr?: number | null;
  volatility?: number;
  sharpe?: number | null;
  max_drawdown?: number;
  mdd_peak?: string;
  mdd_trough?: string;
  calmar?: number | null;
  start?: string;
  end?: string;
};

export type Spec = {
  name?: string;
  universe?: { pool?: string; exclude?: string[]; min_avg_amount?: number; industries?: string[] };
  filters?: { factor: string; op: string; value: number | [number, number] }[];
  rank?: { factor: string; weight?: number; order?: string }[];
  hold?: number;
  rebalance?: string;
  weighting?: string;
  period?: [string, string | null];
  benchmark?: string;
  costs?: { commission?: number; stamp_tax_sell?: number; slippage?: number };
};

export type BacktestResult = {
  as_of?: string;
  metrics?: {
    strategy?: Metrics;
    benchmark?: Metrics;
    annual_excess?: number;
    tracking_error?: number;
    info_ratio?: number | null;
    avg_turnover?: number | null;
    rebalances?: number;
  };
  yearly?: { strategy?: Record<string, number>; benchmark?: Record<string, number> };
  nav?: [string, number][];
  benchmark_nav?: [string, number][];
  random?: { runs?: number; cagr?: number[]; strategy_percentile?: number | null };
  oos?: { start?: string; strategy?: Metrics; benchmark?: Metrics };
  holdings?: { signal: string; exec: string; codes: [string, string | null][] }[];
  picks?: { code: string; name?: string | null; score: number; factors: Record<string, number | null> }[];
  diagnostics?: Record<string, number>;
  factor_info?: Record<string, string>;
};

export type Backtest = BacktestItem & {
  spec?: Spec;
  result?: BacktestResult;
  ahead?: number;
  started_at?: string | null;
};

async function getJSON(url: string, fetchImpl: typeof fetch) {
  const r = await fetchImpl(url, { headers: getHeaders(), credentials: "include" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.status !== "success") throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

export async function fetchBacktests(limit = 50, fetchImpl: typeof fetch = fetch): Promise<BacktestItem[]> {
  const d = await getJSON(`/api/tools/finance/backtests?limit=${limit}`, fetchImpl);
  return Array.isArray(d.backtests) ? d.backtests : [];
}

export async function fetchBacktest(id: string, full = true, fetchImpl: typeof fetch = fetch): Promise<Backtest> {
  const d = await getJSON(`/api/tools/finance/backtest?id=${encodeURIComponent(id)}&full=${full ? 1 : 0}`, fetchImpl);
  return d.backtest as Backtest;
}

export async function renameBacktest(id: string, name: string, fetchImpl: typeof fetch = fetch): Promise<{ name: string; attempt?: number }> {
  const headers = getHeaders({ "Content-Type": "application/json" });
  const r = await fetchImpl("/api/tools/finance/backtest/rename", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ id, name }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.status !== "success") throw new Error(d?.error || `HTTP ${r.status}`);
  return d.backtest;
}

export const isActive = (s?: string) => s === "queued" || s === "running";

export function fmtPct(v: number | null | undefined, digits = 1, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return `${sign && v > 0 ? "+" : ""}${s}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

/** 600519 / sh.600519 → 600519.SH（K 线页的代码格式） */
export function platformSymbol(code: string): string {
  const m = /^(sh|sz|bj)\.(\d{6})$/.exec(code);
  return m ? `${m[2]}.${m[1].toUpperCase()}` : code;
}

/** 回撤曲线：每个点相对之前最高点的跌幅（%） */
export function drawdown(nav: [string, number][]): [string, number][] {
  let peak = -Infinity;
  return nav.map(([d, v]) => {
    peak = Math.max(peak, v);
    return [d, peak > 0 ? (v / peak - 1) * 100 : 0];
  });
}

/** 2026-11-14T02:00:00+00:00（UTC）→ 本地时间 11-14 10:00 */
export function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
