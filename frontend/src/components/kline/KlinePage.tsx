/**
 * K 线页 /kline?symbol=600519.SH&period=max&interval=day&indicators=MA,VOL
 * 顶部搜索框（代码或名称：美股、A 股、港股），下面整页 K 线图，默认全部历史日 K。
 * 搜索走后端 /api/tools/finance/search，日 K 走 /api/tools/finance/kline（平台 key 只在服务器）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon, CandlestickChartIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { MARKET_GROUPS, MARKET_NAME } from "./markets";
import { KlineChart, RANGES, type Interval, type KlineSpec, type Range } from "@/components/ai-elements/kline-chart";
import { getHeaders } from "@/lib/api/headers";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Hit = { symbol: string; name?: string; market?: string; kind?: string; delisted?: boolean };

const MARKET_LABEL: Record<string, string> = { A: "A", HK: "HK", US: "US" };
const EXAMPLES: Hit[] = [
  { symbol: "600519.SH", name: "贵州茅台", market: "A" },
  { symbol: "00700.HK", name: "腾讯控股", market: "HK" },
  { symbol: "AAPL", name: "Apple", market: "US" },
  { symbol: "000300.SH", name: "沪深300", market: "A" },
];

function useChartHeight() {
  const calc = () => Math.max(380, Math.min(900, (typeof window !== "undefined" ? window.innerHeight : 800) - 260));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

export function KlinePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const symbol = (params.get("symbol") || "").trim().toUpperCase();
  const height = useChartHeight();

  const spec: KlineSpec | null = useMemo(() => {
    if (!/^[\^A-Z0-9.\-=]{1,15}$/.test(symbol)) return null;
    const period = (RANGES as readonly string[]).includes(params.get("period") || "") ? (params.get("period") as Range) : "max";
    const iv = params.get("interval");
    const interval: Interval = iv === "week" || iv === "month" ? iv : "day";
    const ind = (params.get("indicators") || "MA,VOL").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    return { symbol, period, interval, indicators: ind };
  }, [symbol, params]);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 输入停 250ms 再搜
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/tools/finance/search?q=${encodeURIComponent(term)}`, { headers: getHeaders(), credentials: "include" })
        .then((r) => r.json().catch(() => ({})))
        .then((d) => {
          if (!cancelled) {
            setHits(Array.isArray(d?.results) ? d.results : []);
            setActive(0);
          }
        })
        .catch(() => !cancelled && setHits([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  // 点外面收起下拉
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);

  const [picked, setPicked] = useState<Hit | null>(null);
  const pick = (h: Hit) => {
    setPicked(h);
    setParams({ symbol: h.symbol });
    setQ("");
    setOpen(false);
  };

  const current =
    picked?.symbol === symbol
      ? picked
      : hits.find((h) => h.symbol === symbol) ?? (MARKET_NAME[symbol] ? { symbol, name: MARKET_NAME[symbol] } : undefined);
  const [showMarkets, setShowMarkets] = useState(false);
  const marketsOpen = showMarkets || !spec;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          title={t("kline.back")}
        >
          <ArrowLeftIcon className="size-4" />
          <span className="hidden sm:inline">{t("kline.back")}</span>
        </button>
        <CandlestickChartIcon className="size-5 text-muted-foreground" />
        <h1 className="text-base font-semibold">{t("kline.pageTitle")}</h1>
        <div ref={boxRef} className="relative ml-2 w-full max-w-md">
          <div className="flex items-center gap-2 rounded-md border px-2">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
                else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                else if (e.key === "Enter") {
                  if (hits[active]) pick(hits[active]);
                  else if (/^[\^A-Za-z0-9.\-=]{1,15}$/.test(q.trim())) pick({ symbol: q.trim().toUpperCase() });
                } else if (e.key === "Escape") setOpen(false);
              }}
              placeholder={t("kline.searchPlaceholder")}
              className="h-9 w-full bg-transparent text-sm outline-none"
              aria-label={t("kline.searchPlaceholder")}
            />
          </div>
          {open && q.trim() && (
            <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md">
              {hits.length === 0 && !searching && <li className="px-3 py-2 text-muted-foreground">{t("kline.noResult")}</li>}
              {hits.map((h, i) => (
                <li key={h.symbol}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(h)}
                    className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left", i === active && "bg-muted")}
                  >
                    <span className="w-24 shrink-0 font-mono text-xs">{h.symbol}</span>
                    <span className="truncate">{h.name}</span>
                    <span className="ml-auto flex shrink-0 gap-1 text-[11px] text-muted-foreground">
                      {h.delisted && <span>{t("kline.delisted")}</span>}
                      {h.market && <span className="rounded border px-1">{MARKET_LABEL[h.market] ?? h.market}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowMarkets((v) => !v)}
          className={cn("flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted", showMarkets && "bg-muted")}
          title={t("kline.markets")}
        >
          <GlobeIcon className="size-4" />
          <span className="hidden sm:inline">{t("kline.markets")}</span>
        </button>
      </header>
      {marketsOpen && (
        <div className="shrink-0 space-y-1.5 border-b px-3 py-2 text-sm">
          {MARKET_GROUPS.map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-1">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{t(`kline.group.${g.key}` as "kline.group.a")}</span>
              {g.items.map((it) => (
                <button
                  key={it.symbol}
                  type="button"
                  onClick={() => {
                    pick({ symbol: it.symbol, name: it.name });
                    setShowMarkets(false);
                  }}
                  className={cn("rounded border px-2 py-0.5 text-xs hover:bg-muted", it.symbol === symbol && "bg-primary text-primary-foreground")}
                  title={it.symbol}
                >
                  {it.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {spec ? (
          <>
            {current?.name && <div className="px-1 pb-1 text-sm text-muted-foreground">{current.name}</div>}
            <KlineChart key={spec.symbol} spec={spec} height={height} pageMode className="my-0" />
          </>
        ) : (
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
            <p>{t("kline.emptyHint")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((h) => (
                <button key={h.symbol} type="button" onClick={() => pick(h)} className="rounded-md border px-3 py-1.5 hover:bg-muted">
                  {h.name} <span className="font-mono text-xs">{h.symbol}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
