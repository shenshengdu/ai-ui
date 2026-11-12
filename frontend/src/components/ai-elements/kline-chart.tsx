"use client";

/**
 * ```kline``` 代码块：模型只写规格 {"symbol":"AAPL","period":"1y","interval":"day","indicators":["MA","VOL"]}，
 * 这里向后端 /api/tools/finance/kline 取日 K（平台 key 只在服务器），用 KLineChart 画出来。
 * 工具栏：周期（日 / 周 / 月，周、月由日 K 在浏览器里合成）、范围（3M–5Y）、主图指标、副图指标。
 */

import { cn } from "@/lib/utils";
import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import type { Chart, KLineData } from "klinecharts";
import { useI18n } from "@/lib/i18n";
import { getHeaders } from "@/lib/api/headers";

type KlineChartProps = HTMLAttributes<HTMLDivElement> & { code: unknown };

export type Interval = "day" | "week" | "month";
export const RANGES = ["3mo", "6mo", "1y", "2y", "5y"] as const;
export type Range = (typeof RANGES)[number];
export const MAIN_INDICATORS = ["MA", "EMA", "BOLL"] as const;
export const SUB_INDICATORS = ["VOL", "MACD", "KDJ", "RSI"] as const;
const ALL_INDICATORS: readonly string[] = [...MAIN_INDICATORS, ...SUB_INDICATORS];
const RANGE_LABEL: Record<Range, string> = { "3mo": "3M", "6mo": "6M", "1y": "1Y", "2y": "2Y", "5y": "5Y" };

// 涨红跌绿（A 股、港股习惯）
const UP = "#F92855";
const DOWN = "#2DC08E";

export type KlineSpec = { symbol: string; period: Range; interval: Interval; indicators: string[] };

function normalizeCode(code: unknown): string {
  if (typeof code === "string") return code.trim();
  if (Array.isArray(code)) return code.map((p) => (typeof p === "string" ? p : "")).join("").trim();
  return "";
}

/** 解析代码块；不合法的字段用默认值 */
export function parseSpec(code: unknown): KlineSpec | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(normalizeCode(code));
  } catch {
    return null;
  }
  const symbol = String(raw?.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return null;
  const period = (RANGES as readonly string[]).includes(String(raw.period)) ? (raw.period as Range) : "1y";
  const interval = ["day", "week", "month"].includes(String(raw.interval)) ? (raw.interval as Interval) : "day";
  const ind = Array.isArray(raw.indicators)
    ? raw.indicators.map((x) => String(x).toUpperCase()).filter((x) => ALL_INDICATORS.includes(x))
    : [];
  return { symbol, period, interval, indicators: ind.length ? Array.from(new Set(ind)) : ["MA", "VOL"] };
}

type Bar = { t: string; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null };

/** 日 K → 日 / 周（周一开始）/ 月 K */
export function aggregate(bars: Bar[], interval: Interval): KLineData[] {
  const day: KLineData[] = bars
    .filter((b) => b.c != null)
    .map((b) => {
      const c = b.c as number;
      return {
        timestamp: Date.parse(b.t + "T00:00:00Z"),
        open: b.o ?? c,
        high: b.h ?? c,
        low: b.l ?? c,
        close: c,
        volume: b.v ?? 0,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  if (interval === "day") return day;
  const key = (ts: number) => {
    const d = new Date(ts);
    if (interval === "month") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const monday = ts - ((d.getUTCDay() + 6) % 7) * 86400000;
    return String(monday);
  };
  const out: KLineData[] = [];
  let cur: KLineData | null = null;
  let curKey = "";
  for (const b of day) {
    const k = key(b.timestamp);
    if (!cur || k !== curKey) {
      if (cur) out.push(cur);
      cur = { ...b };
      curKey = k;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = (cur.volume ?? 0) + (b.volume ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function useIsDark() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const sync = () => {
      const root = document.documentElement;
      if (root.classList.contains("dark")) return setIsDark(true);
      if (root.classList.contains("light")) return setIsDark(false);
      setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, []);
  return isDark;
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-xs transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export function KlineChart({ code, className, ...props }: KlineChartProps) {
  const { t } = useI18n();
  const spec = useMemo(() => parseSpec(code), [code]);
  const [range, setRange] = useState<Range>(spec?.period ?? "1y");
  const [interval, setIntervalKind] = useState<Interval>(spec?.interval ?? "day");
  const [indicators, setIndicators] = useState<string[]>(spec?.indicators ?? ["MA", "VOL"]);
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isDark = useIsDark();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const libRef = useRef<typeof import("klinecharts") | null>(null);
  const subPanes = useRef<Map<string, string>>(new Map());
  const [version, setVersion] = useState(0);
  // 规格（流式输出时晚一步才完整）一出来就套用它的范围、周期、指标；之后用户点工具栏不受影响
  const specKey = spec ? `${spec.symbol}|${spec.period}|${spec.interval}|${spec.indicators.join(",")}` : "";
  useEffect(() => {
    if (!spec) return;
    setRange(spec.period);
    setIntervalKind(spec.interval);
    setIndicators(spec.indicators);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);        // 图建好后 +1，触发样式、数据、指标的 effect

  // 取数据（范围变了才重新取）
  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tools/finance/kline?symbol=${encodeURIComponent(spec.symbol)}&period=${range}`, {
      headers: getHeaders(),
      credentials: "include",
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || d.status !== "success") throw new Error(d.error || `HTTP ${r.status}`);
        setBars(d.data as Bar[]);
        setSource(d.source || "");
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [spec, range]);

  // 建图：等图表区域真的出现了再建。流式输出时代码块里的 JSON 先是半截（spec 为空、没有图表区域），
  // 写完才出现区域——只在第一次渲染时建会永远建不起来（空白，刷新后才有）
  const hasSpec = spec !== null;
  useEffect(() => {
    if (!hasSpec) return;
    let disposed = false;
    import("klinecharts").then((lib) => {
      if (disposed || !boxRef.current) return;
      libRef.current = lib;
      const chart = lib.init(boxRef.current, { timezone: "UTC", locale: "zh-CN" });
      chartRef.current = chart;
      chart?.setPriceVolumePrecision(2, 0);
      setVersion((v) => v + 1);
    });
    // 跟着图表区域本身的大小重画：流式输出时组件建好那一刻宽度可能还是 0，之后才变宽（只听窗口大小会一直是空白）
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver !== "undefined" && boxRef.current ? new ResizeObserver(onResize) : null;
    if (ro && boxRef.current) ro.observe(boxRef.current);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      if (boxRef.current && libRef.current) libRef.current.dispose(boxRef.current);
      chartRef.current = null;
      subPanes.current.clear();
    };
  }, [hasSpec]);

  // 主题、涨跌颜色
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setStyles(isDark ? "dark" : "light");
    chart.setStyles({
      candle: { bar: { upColor: UP, downColor: DOWN, noChangeColor: "#888888", upBorderColor: UP, downBorderColor: DOWN,
        upWickColor: UP, downWickColor: DOWN } },
      indicator: { bars: [{ upColor: UP + "B3", downColor: DOWN + "B3", noChangeColor: "#888888" }] },
    });
  }, [isDark, version]);

  // 数据、周期
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars) return;
    chart.resize();
    chart.applyNewData(aggregate(bars, interval));
  }, [bars, interval, version]);

  // 指标
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const name of MAIN_INDICATORS) {
      chart.removeIndicator("candle_pane", name);
      if (indicators.includes(name)) chart.createIndicator(name, true, { id: "candle_pane" });
    }
    for (const name of SUB_INDICATORS) {
      const pane = subPanes.current.get(name);
      if (pane && !indicators.includes(name)) {
        chart.removeIndicator(pane, name);
        subPanes.current.delete(name);
      } else if (!pane && indicators.includes(name)) {
        const id = chart.createIndicator(name, false, { height: 80 });
        if (id) subPanes.current.set(name, id);
      }
    }
  }, [indicators, version]);

  if (!spec) {
    return (
      <div className={cn("my-2 flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground", className)}>
        <TriangleAlertIcon className="size-4" /> {t("kline.badSpec")}
      </div>
    );
  }

  const toggle = (name: string) =>
    setIndicators((cur) => (cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]));
  const subCount = indicators.filter((x) => (SUB_INDICATORS as readonly string[]).includes(x)).length;

  return (
    <div className={cn("my-2 w-full rounded-md border", className)} {...props}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-1.5">
        <span className="text-sm font-medium">{spec.symbol}</span>
        <div className="flex gap-0.5">
          {(["day", "week", "month"] as Interval[]).map((iv) => (
            <Toggle key={iv} active={interval === iv} onClick={() => setIntervalKind(iv)}>
              {t(`kline.${iv}` as "kline.day")}
            </Toggle>
          ))}
        </div>
        <div className="flex gap-0.5">
          {RANGES.map((r) => (
            <Toggle key={r} active={range === r} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </Toggle>
          ))}
        </div>
        <div className="flex gap-0.5">
          {MAIN_INDICATORS.map((n) => (
            <Toggle key={n} active={indicators.includes(n)} onClick={() => toggle(n)}>
              {n}
            </Toggle>
          ))}
        </div>
        <div className="flex gap-0.5">
          {SUB_INDICATORS.map((n) => (
            <Toggle key={n} active={indicators.includes(n)} onClick={() => toggle(n)}>
              {n}
            </Toggle>
          ))}
        </div>
        {loading && <span className="text-xs text-muted-foreground">{t("kline.loading")}</span>}
      </div>
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon className="size-4" /> {t("kline.error")}：{error}
        </div>
      )}
      <div ref={boxRef} style={{ height: 320 + subCount * 80 }} className="w-full" />
      {source && <div className="px-2 pb-1 text-right text-[11px] text-muted-foreground">{t("kline.source")}：{source}</div>}
    </div>
  );
}
