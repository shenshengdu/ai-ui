/** A 股主线雷达：后端 /api/tools/finance/themes → 金融平台 → 阿里云回测服务每天收盘后算好的。 */
import { getHeaders } from "@/lib/api/headers";

export type Leader = {
  code: string;
  name?: string | null;
  ret_5?: number | null;
  ret_20?: number | null;
  limit_up_5?: number;
  amount_20d?: number | null;
};

export type ThemeIndustry = {
  industry: string;
  rank: number;
  score: number | null;
  members: number;
  ret_5: number | null;
  ret_20: number | null;
  ret_60: number | null;
  amt_chg: number | null;
  breadth_20: number | null;
  new_high_60: number | null;
  limit_up_5: number;
  flow_20: number | null;
  days_in_top: number;
  rank_5d_ago: number | null;
  leaders?: Leader[];
};

export type Themes = {
  market: string;
  date: string;
  top: number;
  industries: ThemeIndustry[];
  notes?: string[];
  history?: { date: string; top: { industry: string; score: number | null }[] }[];
};

export async function fetchThemes(date?: string, fetchImpl: typeof fetch = fetch): Promise<Themes> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const r = await fetchImpl(`/api/tools/finance/themes${q}`, { headers: getHeaders(), credentials: "include" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.status !== "success") throw new Error(d?.error || `HTTP ${r.status}`);
  return d as Themes;
}

/** 排名变化：5 天前第 8 → 现在第 2 = +6（上升）；5 天前没有排名 = null */
export function rankMove(x: Pick<ThemeIndustry, "rank" | "rank_5d_ago">): number | null {
  return x.rank_5d_ago == null ? null : x.rank_5d_ago - x.rank;
}

/** 某个行业在最近几天的前排名单里出现了几次（history 从新到旧） */
export function streak(history: Themes["history"], industry: string): boolean[] {
  return (history ?? []).map((h) => h.top.some((t) => t.industry === industry)).reverse();
}
