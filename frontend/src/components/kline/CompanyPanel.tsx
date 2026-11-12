/**
 * K 线页下方：公司公告（带原文链接）、主要财务指标。
 * 数据走后端 /api/tools/finance/company?symbol=&kind=announcements|financials
 * A 股巨潮资讯、港股披露易、美股 SEC EDGAR；财务是最近几个报告期。
 */

import { useEffect, useState } from "react";
import { ExternalLinkIcon, FileTextIcon, TableIcon } from "lucide-react";
import { getHeaders } from "@/lib/api/headers";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MARKET_NAME } from "./markets";

export type Announcement = { time?: string | null; title: string; category?: string | null; url?: string | null; source?: string };
export type FinRow = {
  report_date: string;
  period_type?: string | null;
  months?: number | null;
  ann_date?: string | null;
  currency?: string | null;
  revenue?: number | null;
  revenue_yoy?: number | null;
  net_profit?: number | null;
  net_profit_yoy?: number | null;
  eps?: number | null;
  bvps?: number | null;
  roe?: number | null;
  gross_margin?: number | null;
};
type Kind = "announcements" | "financials";
type State = { loading: boolean; error?: string; rows: unknown[]; note?: string | null; source?: string };

const SOURCE_NAME: Record<string, string> = { cninfo: "巨潮资讯", hkex: "HKEXnews", sec: "SEC EDGAR" };

/** 指数、期货、汇率没有公告和财报 */
export function hasCompanyData(symbol: string): boolean {
  // 000xxx.SH 是上证系列指数（000001.SZ 是平安银行，不能排除），399xxx.SZ 是深证系列指数
  return /^([A-Z][A-Z0-9.\-]{0,9}|\d{6}\.(SH|SZ|SS|BJ)|\d{1,5}\.HK)$/.test(symbol) && !/^000\d{3}\.(SH|SS)$|^399\d{3}\.SZ$/.test(symbol) &&
    !/^(HSI|HSCEI|HSTECH)\.HK$/.test(symbol) && !MARKET_NAME[symbol];
}

/** 只放行 http(s) 链接（防 javascript: 之类） */
export function safeUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}

export function fmtMoney(v: number | null | undefined, zh: boolean): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (zh) {
    if (a >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
    if (a >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
    return v.toFixed(0);
  }
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}

const PERIOD_EN: Record<string, string> = { 一季报: "Q1", 中报: "H1", 三季报: "Q3 (9M)", 年报: "Annual", 季报: "Quarterly" };

/** 报告期类型：后端给中文（一季报/中报/三季报/年报，美股「Q1 季报」等）；英文界面翻一下 */
export function periodLabel(p: string | null | undefined, zh: boolean): string {
  if (!p) return "—";
  if (zh) return p;
  const m = /^(Q[1-3]) 季报$/.exec(p);
  if (m) return `${m[1]} (fiscal)`;
  return PERIOD_EN[p] ?? p;
}

export function fmtPct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtNum(v: number | null | undefined, d = 2): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);
}

function useCompany(symbol: string, kind: Kind): State {
  const [st, setSt] = useState<State>({ loading: true, rows: [] });
  useEffect(() => {
    let cancelled = false;
    setSt({ loading: true, rows: [] });
    fetch(`/api/tools/finance/company?symbol=${encodeURIComponent(symbol)}&kind=${kind}`, { headers: getHeaders(), credentials: "include" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || d?.status !== "success") {
          setSt({ loading: false, rows: [], error: d?.error || `HTTP ${r.status}` });
          return;
        }
        const rows = kind === "announcements" ? d.announcements : d.rows;
        setSt({ loading: false, rows: Array.isArray(rows) ? rows : [], note: d.note, source: d.source });
      })
      .catch((e) => !cancelled && setSt({ loading: false, rows: [], error: String(e?.message || e) }));
    return () => {
      cancelled = true;
    };
  }, [symbol, kind]);
  return st;
}

function AnnouncementList({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const st = useCompany(symbol, "announcements");
  if (st.loading) return <p className="py-4 text-sm text-muted-foreground">{t("kline.loadingAnn")}</p>;
  if (st.error) return <p className="py-4 text-sm text-destructive">{t("kline.loadFailed")}：{st.error}</p>;
  const rows = st.rows as Announcement[];
  return (
    <div>
      {st.note && <p className="pb-1 text-xs text-muted-foreground">{st.note}</p>}
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t("kline.noAnn")}</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((a, i) => {
            const href = safeUrl(a.url);
            return (
              <li key={`${a.time}-${i}`} className="flex items-baseline gap-3 py-1.5">
                <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">{a.time ?? ""}</span>
                {a.category && <span className="hidden shrink-0 rounded border px-1 text-[11px] text-muted-foreground sm:inline">{a.category}</span>}
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 hover:underline">
                    {a.title}
                    <ExternalLinkIcon className="ml-1 inline size-3 text-muted-foreground" />
                  </a>
                ) : (
                  <span className="min-w-0 flex-1">{a.title}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {st.source && (
        <p className="pt-2 text-xs text-muted-foreground">
          {t("kline.source")}：{SOURCE_NAME[st.source] ?? st.source}
        </p>
      )}
    </div>
  );
}

function FinTable({ symbol }: { symbol: string }) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const st = useCompany(symbol, "financials");
  if (st.loading) return <p className="py-4 text-sm text-muted-foreground">{t("kline.loading")}</p>;
  if (st.error) return <p className="py-4 text-sm text-destructive">{t("kline.loadFailed")}：{st.error}</p>;
  const rows = st.rows as FinRow[];
  if (rows.length === 0) return <p className="py-4 text-sm text-muted-foreground">{t("kline.noFin")}</p>;
  const cur = rows.find((r) => r.currency)?.currency;
  const yoyCls = (v?: number | null) => (v == null ? "" : v > 0 ? "text-red-600 dark:text-red-400" : v < 0 ? "text-green-600 dark:text-green-400" : "");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-right text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 text-left font-normal">{t("kline.fin.period")}</th>
            <th className="py-1.5 text-left font-normal">{t("kline.fin.type")}</th>
            <th className="py-1.5 text-left font-normal">{t("kline.fin.annDate")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.revenue")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.yoy")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.netProfit")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.yoy")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.eps")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.roe")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.grossMargin")}</th>
            <th className="py-1.5 font-normal">{t("kline.fin.bvps")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.report_date} className="border-b last:border-0">
              <td className="py-1.5 text-left font-mono text-xs">{r.report_date}</td>
              <td className="py-1.5 text-left text-xs" title={r.months ? t("kline.fin.months", { n: r.months }) : undefined}>
                {periodLabel(r.period_type, zh)}
              </td>
              <td className="py-1.5 text-left font-mono text-xs text-muted-foreground">{r.ann_date ?? "—"}</td>
              <td className="py-1.5">{fmtMoney(r.revenue, zh)}</td>
              <td className={cn("py-1.5", yoyCls(r.revenue_yoy))}>{fmtPct(r.revenue_yoy)}</td>
              <td className="py-1.5">{fmtMoney(r.net_profit, zh)}</td>
              <td className={cn("py-1.5", yoyCls(r.net_profit_yoy))}>{fmtPct(r.net_profit_yoy)}</td>
              <td className="py-1.5">{fmtNum(r.eps, 3)}</td>
              <td className="py-1.5">{r.roe == null ? "—" : `${fmtNum(r.roe)}%`}</td>
              <td className="py-1.5">{r.gross_margin == null ? "—" : `${fmtNum(r.gross_margin)}%`}</td>
              <td className="py-1.5">{fmtNum(r.bvps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-2 text-xs text-muted-foreground">
        {cur ? `${cur} · ` : ""}
        {t("kline.fin.cumulative")}
      </p>
    </div>
  );
}

export function CompanyPanel({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Kind>("announcements");
  const tabs: { key: Kind; label: string; icon: typeof FileTextIcon }[] = [
    { key: "announcements", label: t("kline.tab.announcements"), icon: FileTextIcon },
    { key: "financials", label: t("kline.tab.financials"), icon: TableIcon },
  ];
  return (
    <section className="mt-3 rounded-md border">
      <div role="tablist" className="flex gap-1 border-b px-2 pt-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-1 border-b-2 px-3 py-1.5 text-sm",
              tab === key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="px-3 py-2">{tab === "announcements" ? <AnnouncementList symbol={symbol} /> : <FinTable symbol={symbol} />}</div>
    </section>
  );
}
