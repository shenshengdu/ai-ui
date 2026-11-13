"use client";

/**
 * ```kline``` 代码块：模型只写规格 {"symbol":"AAPL","period":"1y","interval":"day","indicators":["MA","VOL"]}，
 * 这里向后端 /api/tools/finance/kline 取日 K（平台 key 只在服务器），用 KLineChart 画出来。
 * 工具栏：周期（日 / 周 / 月，周、月由日 K 在浏览器里合成）、范围（3M–5Y）、主图指标、副图指标。
 */

import { cn } from "@/lib/utils";
import { ExternalLinkIcon, RotateCcwIcon, Settings2Icon, TriangleAlertIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import type { Chart, KLineData, YAxisPosition } from "klinecharts";
import { useI18n } from "@/lib/i18n";
import { getHeaders } from "@/lib/api/headers";

type KlineChartProps = HTMLAttributes<HTMLDivElement> & {
  code?: unknown;
  /** K 线页：直接给规格（不解析代码块） */
  spec?: KlineSpec;
  /** 主图高度（像素），默认 320；每个副图再加 80 */
  height?: number;
  /** K 线页：不显示「在 K 线页打开」按钮 */
  pageMode?: boolean;
  /** height 是图表总高度（含副图），副图多了主图变矮；K 线页上下分栏时用 */
  fitHeight?: boolean;
};

export type Interval = "day" | "week" | "month" | "quarter" | "year";
export const INTERVALS: Interval[] = ["day", "week", "month", "quarter", "year"];
export const RANGES = ["3mo", "6mo", "1y", "2y", "5y", "max"] as const;
export type Range = (typeof RANGES)[number];
export const MAIN_INDICATORS = ["MA", "EMA", "BOLL"] as const;
export const SUB_INDICATORS = ["VOL", "MACD", "KDJ", "RSI"] as const;
const ALL_INDICATORS: readonly string[] = [...MAIN_INDICATORS, ...SUB_INDICATORS];
const RANGE_LABEL: Record<Range, string> = { "3mo": "3M", "6mo": "6M", "1y": "1Y", "2y": "2Y", "5y": "5Y", max: "MAX" };

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
  if (!/^[\^A-Z0-9.\-=]{1,15}$/.test(symbol)) return null;
  const period = (RANGES as readonly string[]).includes(String(raw.period)) ? (raw.period as Range) : "1y";
  const interval = (INTERVALS as string[]).includes(String(raw.interval)) ? (raw.interval as Interval) : "day";
  const ind = Array.isArray(raw.indicators)
    ? raw.indicators.map((x) => String(x).toUpperCase()).filter((x) => ALL_INDICATORS.includes(x))
    : [];
  return { symbol, period, interval, indicators: ind.length ? Array.from(new Set(ind)) : ["MA", "VOL"] };
}

/** 指标参数：默认值（KLineChart 自带的）、最多几个数、每个数的范围 */
export const PARAM_RULES: Record<string, { def: number[]; max: number; min: number; hi: number; float?: boolean }> = {
  MA: { def: [5, 10, 30, 60], max: 5, min: 1, hi: 500 },
  EMA: { def: [6, 12, 20], max: 5, min: 1, hi: 500 },
  BOLL: { def: [20, 2], max: 2, min: 0.1, hi: 500, float: true },
  VOL: { def: [5, 10, 20], max: 3, min: 1, hi: 500 },
  MACD: { def: [12, 26, 9], max: 3, min: 1, hi: 500 },
  KDJ: { def: [9, 3, 3], max: 3, min: 1, hi: 500 },
  RSI: { def: [6, 12, 24], max: 3, min: 1, hi: 500 },
};
const PARAMS_KEY = "kline.indicatorParams";

/** "5, 10,20 60" → [5, 10, 20, 60]；不合法 → null（MACD、KDJ、BOLL 要正好那么多个数） */
export function parseParams(name: string, text: string): number[] | null {
  const rule = PARAM_RULES[name];
  if (!rule) return null;
  const nums = text.split(/[\s,，、]+/).filter(Boolean).map(Number);
  if (!nums.length || nums.length > rule.max || nums.some((n) => !Number.isFinite(n) || n < rule.min || n > rule.hi)) return null;
  if (["MACD", "KDJ", "BOLL"].includes(name) && nums.length !== rule.def.length) return null;
  return rule.float ? nums.map((n, i) => (i === 0 ? Math.round(n) : n)) : nums.map((n) => Math.round(n));
}

function loadParams(): Record<string, number[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(PARAMS_KEY) || "{}");
    const out: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      const ok = Array.isArray(v) ? parseParams(k, (v as unknown[]).join(",")) : null;
      if (ok) out[k] = ok;
    }
    return out;
  } catch {
    return {};
  }
}

function saveParams(p: Record<string, number[]>) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式等存不了：只在这次页面里生效 */
  }
}

type Bar = { t: string; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null };

/** 日 K → 日 / 周（周一开始）/ 月 / 季 / 年 K */
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
    if (interval === "year") return String(d.getUTCFullYear());
    if (interval === "quarter") return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3)}`;
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

// 浏览器里的 K 线缓存（10 分钟）：同一只切换范围、来回打开不再请求。
// 拿过「全部历史」的，其他范围直接从里面截取最近一段。
const KLINE_TTL = 10 * 60 * 1000;
const RANGE_DAYS: Record<string, number> = { "3mo": 93, "6mo": 186, "1y": 365, "2y": 730, "5y": 1825 };
const klineCache = new Map<string, { bars: Bar[]; source: string; at: number }>();

export function klineCachePut(symbol: string, range: Range, bars: Bar[], source: string, now = Date.now()) {
  klineCache.set(`${symbol}|${range}`, { bars, source, at: now });
  if (klineCache.size > 40) klineCache.delete(klineCache.keys().next().value as string);
}

export function klineCacheGet(symbol: string, range: Range, now = Date.now()): { bars: Bar[]; source: string } | null {
  const fresh = (k: string) => {
    const c = klineCache.get(k);
    return c && now - c.at < KLINE_TTL ? c : null;
  };
  const hit = fresh(`${symbol}|${range}`);
  if (hit) return hit;
  const all = range !== "max" ? fresh(`${symbol}|max`) : null;
  if (all && RANGE_DAYS[range]) {
    const cut = new Date(now - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10);
    return { bars: all.bars.filter((b) => b.t >= cut), source: all.source };
  }
  return null;
}

export function KlineChart({ code, spec: specProp, height = 320, pageMode = false, fitHeight = false, className, ...props }: KlineChartProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const specPropKey = specProp ? JSON.stringify(specProp) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spec = useMemo(() => specProp ?? parseSpec(code), [specPropKey, code]);
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
  const [params, setParams] = useState<Record<string, number[]>>(loadParams);
  const [showParams, setShowParams] = useState(false);
  // 没有成交量的（汇率、部分指数）：不画成交量副图
  const hasVolume = useMemo(() => !!bars && bars.some((b) => (b.v ?? 0) > 0), [bars]);
  const shown = useMemo(() => (hasVolume || !bars ? indicators : indicators.filter((x) => x !== "VOL")), [indicators, hasVolume, bars]);
  const paramsKey = JSON.stringify(params);
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
    const cached = klineCacheGet(spec.symbol, range);
    if (cached) {
      setBars(cached.bars);
      setSource(cached.source);
      setLoading(false);
      return;
    }
    fetch(`/api/tools/finance/kline?symbol=${encodeURIComponent(spec.symbol)}&period=${range}`, {
      headers: getHeaders(),
      credentials: "include",
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || d.status !== "success") throw new Error(d.error || `HTTP ${r.status}`);
        klineCachePut(spec.symbol, range, d.data as Bar[], d.source || "");
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
      yAxis: { position: "left" as YAxisPosition }, // 价格刻度放左边（K 线页右边是聊天框）
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
    const data = aggregate(bars, interval);
    // 小数位：汇率（EUR/USD 1.08）这类价格小的要 4 位
    const last = data.length ? data[data.length - 1].close : 0;
    chart.setPriceVolumePrecision(last > 0 && last < 10 ? 4 : 2, 0);
    chart.applyNewData(data);
    // 整段范围一屏放下（默认每根 K 线固定宽度，1 年、全部历史都只看得到最近几个月）；拖动平移、滚轮缩放
    const w = boxRef.current?.clientWidth ?? 0;
    if (w > 0 && data.length > 0) {
      chart.setOffsetRightDistance(8);
      chart.setBarSpace(Math.max(1, Math.min(12, (w - 70) / data.length)));
      chart.scrollToRealTime();
    }
  }, [bars, interval, version]);

  // 指标
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const spec = (name: string) => (params[name] ? { name, calcParams: params[name] } : name);
    for (const name of MAIN_INDICATORS) {
      chart.removeIndicator("candle_pane", name);
      if (shown.includes(name)) chart.createIndicator(spec(name), true, { id: "candle_pane" });
    }
    for (const name of SUB_INDICATORS) {
      const pane = subPanes.current.get(name);
      if (pane && !shown.includes(name)) {
        chart.removeIndicator(pane, name);
        subPanes.current.delete(name);
      } else if (!pane && shown.includes(name)) {
        const id = chart.createIndicator(spec(name), false, { height: 80 });
        if (id) subPanes.current.set(name, id);
      } else if (pane) {
        chart.overrideIndicator({ name, calcParams: params[name] ?? PARAM_RULES[name].def }, pane);   // 参数改了：原地更新
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, version, paramsKey]);

  if (!spec) {
    return (
      <div className={cn("my-2 flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground", className)}>
        <TriangleAlertIcon className="size-4" /> {t("kline.badSpec")}
      </div>
    );
  }

  const toggle = (name: string) =>
    setIndicators((cur) => (cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]));
  const subCount = shown.filter((x) => (SUB_INDICATORS as readonly string[]).includes(x)).length;

  return (
    <div className={cn("my-2 w-full rounded-md border", className)} {...props}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-1.5">
        <span className="text-sm font-medium">{spec.symbol}</span>
        <div className="flex gap-0.5">
          {INTERVALS.map((iv) => (
            <Toggle key={iv} active={interval === iv} onClick={() => setIntervalKind(iv)}>
              {t(`kline.${iv}` as "kline.day")}
            </Toggle>
          ))}
        </div>
        {/* K 线页一律显示全部历史（不选范围）；对话里的小图保留范围按钮 */}
        {!pageMode && (
          <div className="flex gap-0.5">
            {RANGES.map((r) => (
              <Toggle key={r} active={range === r} onClick={() => setRange(r)}>
                {RANGE_LABEL[r]}
              </Toggle>
            ))}
          </div>
        )}
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
        <button
          type="button"
          title={t("kline.params")}
          aria-label={t("kline.params")}
          onClick={() => setShowParams((v) => !v)}
          className={cn("rounded p-1 text-muted-foreground hover:bg-muted", showParams && "bg-muted", pageMode && "ml-auto")}
        >
          <Settings2Icon className="size-3.5" />
        </button>
        {!pageMode && (
          <button
            type="button"
            title={t("kline.openPage")}
            aria-label={t("kline.openPage")}
            onClick={() =>
              navigate(`/kline?symbol=${encodeURIComponent(spec.symbol)}&period=${range}&interval=${interval}&indicators=${indicators.join(",")}`)
            }
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <ExternalLinkIcon className="size-3.5" />
          </button>
        )}
      </div>
      {showParams && (
        <ParamsPanel
          params={params}
          onChange={(name, v) => {
            setParams((cur) => {
              const next = { ...cur };
              if (v) next[name] = v;
              else delete next[name];
              saveParams(next);
              return next;
            });
          }}
          onReset={() => {
            setParams({});
            saveParams({});
          }}
        />
      )}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon className="size-4" /> {t("kline.error")}：{error}
        </div>
      )}
      <div ref={boxRef} style={{ height: fitHeight ? Math.max(height, 140 + subCount * 80) : height + subCount * 80 }} className="w-full" />
      {source && <div className="px-2 pb-1 text-right text-[11px] text-muted-foreground">{t("kline.source")}：{source}</div>}
    </div>
  );
}

function ParamsPanel({
  params,
  onChange,
  onReset,
}: {
  params: Record<string, number[]>;
  onChange: (name: string, v: number[] | null) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const commit = (name: string) => {
    const text = draft[name];
    if (text === undefined) return;
    if (!text.trim()) {
      onChange(name, null);                         // 清空 = 恢复默认
      setBad((b) => ({ ...b, [name]: false }));
      return;
    }
    const v = parseParams(name, text);
    setBad((b) => ({ ...b, [name]: !v }));
    if (v) onChange(name, v);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-muted/30 px-2 py-2 text-xs">
      {Object.keys(PARAM_RULES).map((name) => (
        <label key={name} className="flex items-center gap-1.5">
          <span className="w-10 font-medium">{name}</span>
          <input
            value={draft[name] ?? (params[name] ?? PARAM_RULES[name].def).join(", ")}
            onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
            onBlur={() => commit(name)}
            onKeyDown={(e) => e.key === "Enter" && commit(name)}
            className={cn(
              "h-6 w-28 rounded border bg-background px-1.5 font-mono outline-none",
              bad[name] && "border-destructive",
              params[name] && "text-primary",
            )}
            aria-label={`${name} ${t("kline.params")}`}
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() => {
          setDraft({});
          setBad({});
          onReset();
        }}
        className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted"
      >
        <RotateCcwIcon className="size-3" /> {t("kline.paramsReset")}
      </button>
      <span className="basis-full text-[11px] text-muted-foreground">{t("kline.paramsHint")}</span>
    </div>
  );
}

