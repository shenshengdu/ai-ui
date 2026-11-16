/**
 * /themes  A 股主线雷达：行业热度排名（涨幅、成交额占比变化、广度、资金强弱、涨停合成）、前排行业的龙头、最近 10 天前排名单。
 * 数据每个交易日收盘后（回测面板更新后）算一次；页面打开时取一次，可以选日期看历史。
 */
import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, FlameIcon, Loader2Icon } from "lucide-react";
import { fetchThemes, rankMove, streak, type ThemeIndustry, type Themes } from "./api";
import { fmtPct, platformSymbol } from "@/components/backtest/api";
import { signClass } from "@/components/backtest/BacktestList";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function Move({ x }: { x: ThemeIndustry }) {
  const m = rankMove(x);
  if (m === null) return <span className="text-muted-foreground">—</span>;
  if (m === 0) return <span className="text-muted-foreground">0</span>;
  return <span className={signClass(m)}>{m > 0 ? `↑${m}` : `↓${-m}`}</span>;
}

function ScoreBar({ v }: { v: number | null }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
      </div>
      <span className="tabular-nums">{v == null ? "—" : v.toFixed(0)}</span>
    </div>
  );
}

function Dots({ on }: { on: boolean[] }) {
  return (
    <div className="flex gap-0.5">
      {on.map((x, i) => (
        <span key={i} className={cn("size-1.5 rounded-full", x ? "bg-orange-500" : "bg-muted")} />
      ))}
    </div>
  );
}

export function ThemesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [date, setDate] = useState<string>("");
  const [data, setData] = useState<Themes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);

  useEffect(() => {
    document.title = t("th.title");
  }, [t]);
  useEffect(() => {
    let stop = false;
    setLoading(true);
    setError(null);
    fetchThemes(date || undefined)
      .then((d) => !stop && setData(d))
      .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [date]);

  const rows = data ? (all ? data.industries : data.industries.slice(0, data.top)) : [];
  const head = "px-2 py-1.5 text-right font-normal whitespace-nowrap";
  const cell = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"))}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          title={t("bt.back")}
        >
          <ArrowLeftIcon className="size-4" />
          <span className="hidden sm:inline">{t("bt.back")}</span>
        </button>
        <FlameIcon className="size-5 shrink-0 text-orange-500" />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {t("th.title")}
          {data && <span className="ml-2 text-sm font-normal text-muted-foreground">{data.date}</span>}
        </h1>
        {loading && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        <input
          type="date"
          value={date || data?.date || ""}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
          aria-label={t("th.date")}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
          {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
          {data && (
            <>
              <section className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-normal">#</th>
                      <th className="px-2 py-1.5 text-left font-normal">{t("th.industry")}</th>
                      <th className="px-2 py-1.5 text-left font-normal">{t("th.score")}</th>
                      <th className={head}>{t("th.ret5")}</th>
                      <th className={head}>{t("th.ret20")}</th>
                      <th className={cn(head, "hidden md:table-cell")}>{t("th.ret60")}</th>
                      <th className={head} title={t("th.amtChgTip")}>{t("th.amtChg")}</th>
                      <th className={cn(head, "hidden sm:table-cell")} title={t("th.breadthTip")}>{t("th.breadth")}</th>
                      <th className={cn(head, "hidden md:table-cell")} title={t("th.flowTip")}>{t("th.flow")}</th>
                      <th className={head}>{t("th.limitUp")}</th>
                      <th className={cn(head, "hidden sm:table-cell")} title={t("th.daysTip")}>{t("th.days")}</th>
                      <th className={cn(head, "hidden sm:table-cell")}>{t("th.move")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => {
                      const has = !!x.leaders?.length;
                      const isOpen = open[x.industry] ?? x.rank <= 3;
                      return (
                        <Fragment key={x.industry}>
                          <tr
                            className={cn("border-b last:border-0", has && "cursor-pointer hover:bg-muted/40")}
                            onClick={() => has && setOpen((o) => ({ ...o, [x.industry]: !isOpen }))}
                          >
                            <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{x.rank}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                {has ? (
                                  isOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />
                                ) : (
                                  <span className="w-3.5" />
                                )}
                                <span className="font-medium" title={x.sector ? `${x.sector} / ${x.industry}` : undefined}>
                                  {x.industry}
                                </span>
                                {x.sector && <span className="hidden text-xs text-muted-foreground lg:inline">{x.sector}</span>}
                                <span className="text-xs text-muted-foreground">{x.members}</span>
                              </span>
                              {data.history && data.history.length > 1 && (
                                <div className="mt-0.5 pl-[18px]">
                                  <Dots on={streak(data.history, x.industry)} />
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              <ScoreBar v={x.score} />
                            </td>
                            <td className={cn(cell, signClass(x.ret_5))}>{fmtPct(x.ret_5, 1, true)}</td>
                            <td className={cn(cell, signClass(x.ret_20))}>{fmtPct(x.ret_20, 1, true)}</td>
                            <td className={cn(cell, "hidden md:table-cell", signClass(x.ret_60))}>{fmtPct(x.ret_60, 1, true)}</td>
                            <td className={cn(cell, signClass(x.amt_chg))}>{fmtPct(x.amt_chg, 0, true)}</td>
                            <td className={cn(cell, "hidden sm:table-cell")}>{fmtPct(x.breadth_20, 0)}</td>
                            <td className={cn(cell, "hidden md:table-cell", signClass(x.flow_20))}>
                              {x.flow_20 == null ? "—" : x.flow_20.toFixed(2)}
                            </td>
                            <td className={cell}>{x.limit_up_5 || "—"}</td>
                            <td className={cn(cell, "hidden sm:table-cell")}>{x.days_in_top}</td>
                            <td className={cn(cell, "hidden sm:table-cell")}>
                              <Move x={x} />
                            </td>
                          </tr>
                          {has && isOpen && (
                            <tr className="border-b bg-muted/30 last:border-0">
                              <td />
                              <td colSpan={11} className="px-2 py-1.5">
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                  <span className="text-muted-foreground">{t("th.leaders")}</span>
                                  {x.leaders!.map((s) => (
                                    <Link
                                      key={s.code}
                                      to={`/kline?symbol=${encodeURIComponent(platformSymbol(s.code))}`}
                                      className="hover:underline"
                                    >
                                      {s.name || platformSymbol(s.code)}
                                      <span className={cn("ml-1 tabular-nums", signClass(s.ret_20))}>{fmtPct(s.ret_20, 1, true)}</span>
                                      {!!s.limit_up_5 && (
                                        <span className="ml-1 text-muted-foreground">
                                          {t("th.limitUpN", { n: s.limit_up_5 })}
                                        </span>
                                      )}
                                    </Link>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              {data.industries.length > data.top && (
                <button type="button" onClick={() => setAll((v) => !v)} className="text-sm text-muted-foreground hover:underline">
                  {all ? t("th.showTop", { n: data.top }) : t("th.showAll", { n: data.industries.length })}
                </button>
              )}
              {data.history && data.history.length > 1 && (
                <section className="rounded-xl border p-3">
                  <h2 className="mb-2 text-sm font-semibold">{t("th.history")}</h2>
                  <div className="space-y-1 text-xs">
                    {data.history.map((h) => (
                      <div key={h.date} className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setDate(h.date)}
                          className={cn("shrink-0 tabular-nums hover:underline", h.date === data.date ? "font-semibold" : "text-muted-foreground")}
                        >
                          {h.date.slice(5)}
                        </button>
                        <span className="truncate">{h.top.slice(0, 5).map((x) => x.industry).join(" · ")}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {(data.notes ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>{t("th.howto")}</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
