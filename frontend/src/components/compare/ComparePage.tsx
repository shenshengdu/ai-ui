/**
 * 同行对比页 /compare?symbols=600519.SH,000858.SZ&view=kline|trend|fin&period=1y&interval=day
 * - K 线走势：每只一张小 K 线，同一段时间、同一周期，十字线同步（看形态）
 * - 涨跌对比：同一起点的累计涨跌幅叠在一张图上 + 区间涨跌 / 最大回撤 / 年化波动率（看强弱）
 * - 财务指标：优先最近一个大家都有的报告期（同期可比），营收、利润、毛利率、ROE、EPS
 * 最多 6 只；从 K 线页「同行对比」按钮或 AI 的 compare 动作进来。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Chart, ActionType } from "klinecharts";
import { ArrowLeftIcon, GitCompareIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { INTERVALS, KlineChart, fetchKlineBars, type Interval } from "@/components/ai-elements/kline-chart";
import { fmtMoney, fmtPct, loadCompany, periodLabel, type FinRow } from "@/components/kline/CompanyPanel";
import { MARKET_NAME } from "@/components/kline/markets";
import { getHeaders } from "@/lib/api/headers";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  COMPARE_RANGES,
  MAX_COMPARE,
  closesOf,
  normalize,
  parseSymbols,
  pickComparable,
  stats,
  type CompareRange,
  type Normalized,
} from "./compare";

type View = "kline" | "trend" | "fin";
type Hit = { symbol: string; name?: string; market?: string };
const COLORS = ["#2563EB", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#0EA5E9"];
const RANGE_LABEL: Record<CompareRange, string> = { "3mo": "3M", "6mo": "6M", "1y": "1Y", "2y": "2Y", "5y": "5Y" };

/** 名称：先看已知的，再用搜索接口补 */
function useNames(symbols: string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const s of symbols) {
      if (names[s] || MARKET_NAME[s]) continue;
      const q = s.replace(/\.(SH|SZ|SS|BJ|HK)$/, "");
      fetch(`/api/tools/finance/search?q=${encodeURIComponent(q)}`, { headers: getHeaders(), credentials: "include" })
        .then((r) => r.json().catch(() => ({})))
        .then((d) => {
          const hit = (Array.isArray(d?.results) ? (d.results as Hit[]) : []).find((h) => h.symbol.toUpperCase() === s || h.symbol.replace(/^0+/, "") === s.replace(/^0+/, ""));
          if (hit?.name) setNames((cur) => ({ ...cur, [s]: hit.name as string }));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);
  return (s: string) => names[s] || MARKET_NAME[s] || "";
}

function AddSymbol({ onAdd, disabled }: { onAdd: (h: Hit) => void; disabled: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = q.trim();
    if (!term) return setHits([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/tools/finance/search?q=${encodeURIComponent(term)}`, { headers: getHeaders(), credentials: "include" })
        .then((r) => r.json().catch(() => ({})))
        .then((d) => !cancelled && setHits(Array.isArray(d?.results) ? d.results : []))
        .catch(() => !cancelled && setHits([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);
  useEffect(() => {
    const on = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  const add = (h: Hit) => {
    onAdd(h);
    setQ("");
    setOpen(false);
  };
  return (
    <div ref={box} className="relative w-full max-w-xs">
      <div className={cn("flex items-center gap-2 rounded-md border px-2", disabled && "opacity-50")}>
        <SearchIcon className="size-4 text-muted-foreground" />
        <input
          value={q}
          disabled={disabled}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (hits[0]) add(hits[0]);
              else if (/^[\^A-Za-z0-9.\-=]{1,15}$/.test(q.trim())) add({ symbol: q.trim().toUpperCase() });
            }
          }}
          placeholder={disabled ? t("compare.full") : t("compare.add")}
          className="h-8 w-full bg-transparent text-sm outline-none"
          aria-label={t("compare.add")}
        />
      </div>
      {open && q.trim() && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md">
          {hits.map((h) => (
            <li key={h.symbol}>
              <button type="button" onClick={() => add(h)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted">
                <span className="w-24 shrink-0 font-mono text-xs">{h.symbol}</span>
                <span className="truncate">{h.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 并排小 K 线，十字线同步 */
function KlineGrid({ symbols, period, interval, nameOf }: { symbols: string[]; period: CompareRange; interval: Interval; nameOf: (s: string) => string }) {
  const charts = useRef(new Map<string, Chart>());
  const ON = "onCrosshairChange" as ActionType;
  const sync = useCallback((src: string, data: unknown) => {
    const ts = (data as { kLineData?: { timestamp?: number } } | undefined)?.kLineData?.timestamp;
    charts.current.forEach((c, sym) => {
      if (sym === src) return;
      if (!ts) {
        c.executeAction(ON, {});
        return;
      }
      const list = c.getDataList();
      let i = list.length - 1;
      while (i >= 0 && list[i].timestamp > ts) i--;
      if (i < 0) return c.executeAction(ON, {});
      const p = c.convertToPixel({ timestamp: list[i].timestamp, value: list[i].close }, { paneId: "candle_pane" }) as { x?: number; y?: number };
      if (p?.x != null) c.executeAction(ON, { x: p.x, y: p.y, paneId: "candle_pane" });
    });
  }, [ON]);
  const onChart = (sym: string) => (c: Chart | null) => {
    if (c) {
      charts.current.set(sym, c);
      c.subscribeAction(ON, (d) => sync(sym, d));
    } else charts.current.delete(sym);
  };
  const n = symbols.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const h = Math.max(220, Math.floor(((typeof window !== "undefined" ? window.innerHeight : 800) - 170) / rows) - 70);
  return (
    <div className={cn("grid gap-2", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3")}>
      {symbols.map((s) => (
        <KlineChart
          key={`${s}|${period}`}
          spec={{ symbol: s, period, interval, indicators: ["MA", "VOL"] }}
          height={h}
          bare
          title={nameOf(s) || s}
          onChart={onChart(s)}
          className="my-0"
        />
      ))}
    </div>
  );
}

/** 累计涨跌幅叠加图（SVG） */
function TrendChart({ data, nameOf }: { data: Normalized; nameOf: (s: string) => string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = () => setW(el.clientWidth);
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 360, L = 48, R = 12, T = 12, B = 24;
  const all = data.lines.flatMap((l) => l.pct.filter((x): x is number => x != null));
  if (!data.dates.length || !all.length) return <div ref={box} className="h-40" />;
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.06 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const X = (i: number) => L + (i / Math.max(1, data.dates.length - 1)) * (w - L - R);
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = 5;
  const step = (y1 - y0) / ticks;
  return (
    <div ref={box} className="relative w-full">
      <svg
        width={w}
        height={H}
        className="block"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - L) / (w - L - R)) * (data.dates.length - 1));
          setHover(i >= 0 && i < data.dates.length ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: ticks + 1 }, (_, k) => y0 + k * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} className="stroke-border" strokeWidth={0.5} />
            <text x={L - 4} y={Y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{`${v.toFixed(0)}%`}</text>
          </g>
        ))}
        <line x1={L} x2={w - R} y1={Y(0)} y2={Y(0)} className="stroke-muted-foreground" strokeWidth={0.8} strokeDasharray="4 3" />
        {[0, Math.floor((data.dates.length - 1) / 2), data.dates.length - 1].map((i) => (
          <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.dates.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
            {data.dates[i]}
          </text>
        ))}
        {data.lines.map((l, k) => (
          <polyline
            key={l.symbol}
            fill="none"
            stroke={COLORS[k % COLORS.length]}
            strokeWidth={k === 0 ? 2 : 1.4}
            points={l.pct.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(" ")}
          />
        ))}
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} className="stroke-muted-foreground" strokeWidth={0.6} />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-2 rounded border bg-popover px-2 py-1 text-xs shadow" style={{ left: Math.min(X(hover) + 8, w - 190) }}>
          <div className="mb-0.5 font-mono text-muted-foreground">{data.dates[hover]}</div>
          {data.lines.map((l, k) => (
            <div key={l.symbol} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: COLORS[k % COLORS.length] }} />
              <span className="w-24 truncate">{nameOf(l.symbol) || l.symbol}</span>
              <span className="ml-auto font-mono tabular-nums">{fmtPct(l.pct[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendView({ symbols, period, interval, nameOf }: { symbols: string[]; period: CompareRange; interval: Interval; nameOf: (s: string) => string }) {
  const { t } = useI18n();
  const [data, setData] = useState<Normalized | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    Promise.allSettled(symbols.map((s) => fetchKlineBars(s, period))).then((res) => {
      if (cancelled) return;
      const ok = res.flatMap((r, i) => (r.status === "fulfilled" ? [closesOf(symbols[i], r.value.bars, interval)] : []));
      const bad = symbols.filter((_, i) => res[i].status === "rejected");
      if (bad.length) setErr(`${t("compare.loadFailed")}：${bad.join("、")}`);
      setData(normalize(ok));
    });
    return () => {
      cancelled = true;
    };
  }, [symbols, period, interval, t]);
  const st = useMemo(() => (data ? stats(data, interval) : []), [data, interval]);
  if (!data) return <p className="py-6 text-sm text-muted-foreground">{t("kline.loading")}</p>;
  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="rounded-md border p-2">
        <TrendChart data={data} nameOf={nameOf} />
        <p className="px-1 pt-1 text-[11px] text-muted-foreground">{t("compare.trendNote", { start: data.start ?? "-" })}</p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-1.5 text-left font-normal">{t("compare.stock")}</th>
              <th className="px-3 py-1.5 text-right font-normal">{t("compare.return")}</th>
              <th className="px-3 py-1.5 text-right font-normal">{t("compare.mdd")}</th>
              <th className="px-3 py-1.5 text-right font-normal">{t("compare.vol")}</th>
            </tr>
          </thead>
          <tbody>
            {st.map((s, k) => (
              <tr key={s.symbol} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: COLORS[k % COLORS.length] }} />
                  {nameOf(s.symbol) || s.symbol} <span className="font-mono text-xs text-muted-foreground">{s.symbol}</span>
                </td>
                <td className={cn("px-3 py-1.5 text-right", (s.returnPct ?? 0) > 0 ? "text-red-600 dark:text-red-400" : (s.returnPct ?? 0) < 0 ? "text-green-600 dark:text-green-400" : "")}>
                  {fmtPct(s.returnPct)}
                </td>
                <td className="px-3 py-1.5 text-right">{fmtPct(s.maxDrawdownPct)}</td>
                <td className="px-3 py-1.5 text-right">{s.volPct == null ? "—" : `${s.volPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FinView({ symbols, nameOf }: { symbols: string[]; nameOf: (s: string) => string }) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [rows, setRows] = useState<Record<string, FinRow[]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    Promise.allSettled(symbols.map((s) => loadCompany(s, "financials"))).then((res) => {
      if (cancelled) return;
      setRows(Object.fromEntries(symbols.map((s, i) => [s, res[i].status === "fulfilled" ? ((res[i] as PromiseFulfilledResult<{ rows: unknown[] }>).value.rows as FinRow[]) : []])));
    });
    return () => {
      cancelled = true;
    };
  }, [symbols]);
  if (!rows) return <p className="py-6 text-sm text-muted-foreground">{t("kline.loading")}</p>;
  const pick = pickComparable(rows);
  const metrics: { key: string; label: string; fmt: (r: FinRow) => string; color?: (r: FinRow) => number | null | undefined }[] = [
    { key: "period", label: t("kline.fin.period"), fmt: (r) => `${r.report_date} ${periodLabel(r.period_type, zh)}` },
    { key: "rev", label: t("kline.fin.revenue"), fmt: (r) => `${fmtMoney(r.revenue, zh)}${r.currency ? ` ${r.currency}` : ""}` },
    { key: "revy", label: `${t("kline.fin.revenue")} ${t("kline.fin.yoy")}`, fmt: (r) => fmtPct(r.revenue_yoy), color: (r) => r.revenue_yoy },
    { key: "np", label: t("kline.fin.netProfit"), fmt: (r) => fmtMoney(r.net_profit, zh) },
    { key: "npy", label: `${t("kline.fin.netProfit")} ${t("kline.fin.yoy")}`, fmt: (r) => fmtPct(r.net_profit_yoy), color: (r) => r.net_profit_yoy },
    { key: "gm", label: t("kline.fin.grossMargin"), fmt: (r) => (r.gross_margin == null ? "—" : `${r.gross_margin.toFixed(2)}%`) },
    { key: "roe", label: t("kline.fin.roe"), fmt: (r) => (r.roe == null ? "—" : `${r.roe.toFixed(2)}%`) },
    { key: "eps", label: t("kline.fin.eps"), fmt: (r) => (r.eps == null ? "—" : r.eps.toFixed(3)) },
    { key: "bvps", label: t("kline.fin.bvps"), fmt: (r) => (r.bvps == null ? "—" : r.bvps.toFixed(2)) },
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {pick.same ? t("compare.finSame", { date: pick.date ?? "" }) : t("compare.finLatest")} {t("kline.fin.cumulative")}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[560px] text-sm tabular-nums">
          <thead>
            <tr className="border-b text-xs">
              <th className="px-3 py-1.5 text-left font-normal text-muted-foreground" />
              {symbols.map((s, k) => (
                <th key={s} className="px-3 py-1.5 text-right font-medium">
                  <span className="mr-1 inline-block size-2 rounded-full" style={{ background: COLORS[k % COLORS.length] }} />
                  {nameOf(s) || s}
                  <div className="font-mono text-[11px] font-normal text-muted-foreground">{s}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.key} className="border-b last:border-0">
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{m.label}</td>
                {symbols.map((s) => {
                  const r = pick.rows[s];
                  const c = r && m.color ? m.color(r) : null;
                  return (
                    <td key={s} className={cn("px-3 py-1.5 text-right", c != null && c > 0 && "text-red-600 dark:text-red-400", c != null && c < 0 && "text-green-600 dark:text-green-400")}>
                      {r ? m.fmt(r) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ComparePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const symbols = useMemo(() => parseSymbols(params.get("symbols")), [params]);
  const view: View = (["kline", "trend", "fin"] as const).find((v) => v === params.get("view")) ?? "kline";
  const period: CompareRange = (COMPARE_RANGES as readonly string[]).includes(params.get("period") || "") ? (params.get("period") as CompareRange) : "1y";
  const iv = params.get("interval") as Interval | null;
  const interval: Interval = iv && INTERVALS.includes(iv) && iv !== "quarter" && iv !== "year" ? iv : "day";
  const nameOf = useNames(symbols);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };
  const setSymbols = (list: string[]) => set({ symbols: list.join(",") });

  const tab = (v: View, label: string) => (
    <button
      key={v}
      type="button"
      onClick={() => set({ view: v })}
      className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm", view === v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );
  const toggle = (active: boolean, onClick: () => void, label: string) => (
    <button key={label} type="button" onClick={onClick} className={cn("rounded px-2 py-0.5 text-xs", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
      {label}
    </button>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => navigate(symbols[0] ? `/kline?symbol=${encodeURIComponent(symbols[0])}` : "/kline")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeftIcon className="size-4" />
          <span className="hidden sm:inline">{t("compare.back")}</span>
        </button>
        <GitCompareIcon className="size-5 text-muted-foreground" />
        <h1 className="text-base font-semibold">{t("compare.title")}</h1>
        <AddSymbol
          disabled={symbols.length >= MAX_COMPARE}
          onAdd={(h) => {
            const s = h.symbol.toUpperCase();
            if (!symbols.includes(s) && symbols.length < MAX_COMPARE) setSymbols([...symbols, s]);
          }}
        />
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        {symbols.map((s, k) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <span className="inline-block size-2 rounded-full" style={{ background: COLORS[k % COLORS.length] }} />
            {nameOf(s) || s}
            <span className="font-mono text-muted-foreground">{s}</span>
            <button type="button" onClick={() => setSymbols(symbols.filter((x) => x !== s))} className="rounded-full p-0.5 hover:bg-muted" aria-label={t("compare.remove")}>
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {symbols.length < 2 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <PlusIcon className="size-3" />
            {t("compare.hint")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b px-3">
        <div className="flex">{[tab("kline", t("compare.view.kline")), tab("trend", t("compare.view.trend")), tab("fin", t("compare.view.fin"))]}</div>
        {view !== "fin" && (
          <>
            <div className="flex gap-0.5">{COMPARE_RANGES.map((r) => toggle(period === r, () => set({ period: r }), RANGE_LABEL[r]))}</div>
            <div className="flex gap-0.5">
              {(["day", "week", "month"] as Interval[]).map((x) => toggle(interval === x, () => set({ interval: x }), t(`kline.${x}` as "kline.day")))}
            </div>
          </>
        )}
      </div>
      <main className="flex-1 px-3 py-2">
        {symbols.length === 0 ? (
          <p className="mt-16 text-center text-sm text-muted-foreground">{t("compare.empty")}</p>
        ) : view === "kline" ? (
          <KlineGrid symbols={symbols} period={period} interval={interval} nameOf={nameOf} />
        ) : view === "trend" ? (
          <TrendView symbols={symbols} period={period} interval={interval} nameOf={nameOf} />
        ) : (
          <FinView symbols={symbols} nameOf={nameOf} />
        )}
      </main>
    </div>
  );
}
