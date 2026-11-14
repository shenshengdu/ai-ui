/** 回测策略里的代码 → 中文 / 英文显示名 */
import type { Spec } from "./api";

type L = { zh: string; en: string };

export const MARKET: Record<string, L> = {
  A: { zh: "A 股", en: "China A" },
  HK: { zh: "港股", en: "Hong Kong" },
  US: { zh: "美股", en: "US" },
};

/** 成交额门槛的货币 */
export const CURRENCY: Record<string, L> = {
  A: { zh: "元", en: "CNY" },
  HK: { zh: "港元", en: "HKD" },
  US: { zh: "美元", en: "USD" },
};

export const POOL: Record<string, L> = {
  all_a: { zh: "全部 A 股", en: "All A-shares" },
  all_hk: { zh: "全部港股", en: "All HK stocks" },
  all_us: { zh: "全部美股（普通股）", en: "All US common stocks" },
  hs300: { zh: "沪深 300", en: "CSI 300" },
  zz500: { zh: "中证 500", en: "CSI 500" },
  zz1000: { zh: "中证 1000", en: "CSI 1000" },
  sz50: { zh: "上证 50", en: "SSE 50" },
};

export const EXCLUDE: Record<string, L> = {
  st: { zh: "ST", en: "ST" },
  new_listed_365d: { zh: "上市不满一年", en: "listed < 1 year" },
  suspended: { zh: "停牌", en: "suspended" },
};

export const REBALANCE: Record<string, L> = {
  weekly: { zh: "每周", en: "Weekly" },
  monthly: { zh: "每月", en: "Monthly" },
  quarterly: { zh: "每季度", en: "Quarterly" },
};

export const BENCHMARK: Record<string, L> = {
  "000300.SH": { zh: "沪深 300", en: "CSI 300" },
  "000905.SH": { zh: "中证 500", en: "CSI 500" },
  "000852.SH": { zh: "中证 1000", en: "CSI 1000" },
  "000016.SH": { zh: "上证 50", en: "SSE 50" },
  "000001.SH": { zh: "上证指数", en: "SSE Composite" },
  "399006.SZ": { zh: "创业板指", en: "ChiNext" },
  "HSI.HK": { zh: "恒生指数", en: "Hang Seng Index" },
  "HSCEI.HK": { zh: "恒生国企指数", en: "HSCEI" },
  "HSTECH.HK": { zh: "恒生科技指数", en: "Hang Seng TECH" },
  SPX: { zh: "标普 500", en: "S&P 500" },
  NDX: { zh: "纳斯达克 100", en: "Nasdaq-100" },
};

const OP: Record<string, L> = {
  ">": { zh: ">", en: ">" },
  ">=": { zh: "≥", en: "≥" },
  "<": { zh: "<", en: "<" },
  "<=": { zh: "≤", en: "≤" },
  between: { zh: "介于", en: "between" },
  top_pct: { zh: "前", en: "top" },
  bottom_pct: { zh: "后", en: "bottom" },
};

export function label(map: Record<string, L>, k: string | undefined, lang: string): string {
  if (!k) return "—";
  const v = map[k];
  return v ? (lang === "zh" ? v.zh : v.en) : k;
}

export function filterText(f: NonNullable<Spec["filters"]>[number], name: string, lang: string): string {
  const op = label(OP, f.op, lang);
  if (f.op === "between" && Array.isArray(f.value)) return `${name} ${op} ${f.value[0]} ~ ${f.value[1]}`;
  if (f.op === "top_pct" || f.op === "bottom_pct") return `${name} ${op} ${f.value}%`;
  return `${name} ${op} ${f.value}`;
}

export function rankText(r: NonNullable<Spec["rank"]>[number], name: string, lang: string): string {
  const w = r.weight !== undefined ? ` × ${r.weight}` : "";
  const dir = r.order === "asc" ? (lang === "zh" ? "（越小越好）" : " (lower is better)") : r.order === "desc" ? (lang === "zh" ? "（越大越好）" : " (higher is better)") : "";
  return `${name}${w}${dir}`;
}

export function fmtAmount(v: number | undefined, lang: string, market = "A"): string {
  if (!v) return "—";
  const cur = label(CURRENCY, market, lang);
  if (lang === "zh") return (v >= 1e8 ? `${+(v / 1e8).toFixed(2)} 亿` : `${+(v / 1e4).toFixed(0)} 万`) + cur;
  return (v >= 1e9 ? `${+(v / 1e9).toFixed(2)}B` : `${+(v / 1e6).toFixed(0)}M`) + " " + cur;
}
