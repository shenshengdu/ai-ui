/**
 * /backtest        回测列表（窄屏用；宽屏首页右侧也有）
 * /backtest/:id    回测详情：净值 vs 基准、回撤、指标、逐年、随机选股对照、样本外、策略说明、最新选股、历史持仓、诊断。
 * 排队 / 运行中每 4 秒查一次进度（不带结果），完成后取完整结果。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon, CheckIcon, FlaskConicalIcon, Loader2Icon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteBacktest, drawdown, fetchBacktest, fmtNum, fmtPct, isActive, platformSymbol, renameBacktest, type Backtest, type Metrics } from "./api";
import { BacktestList, StatusBadge, signClass, useBacktests } from "./BacktestList";
import { LineChart } from "./LineChart";
import { BENCHMARK, EXCLUDE, POOL, REBALANCE, filterText, fmtAmount, label, rankText } from "./labels";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const C_STRAT = "#3b82f6";
const C_BENCH = "#9ca3af";
const C_DD = "#F92855";

function Header({ title, right }: { title: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
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
      <FlaskConicalIcon className="size-5 shrink-0 text-muted-foreground" />
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
      {right}
    </header>
  );
}

function Card({ title, children, className, right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border p-3 sm:p-4", className)}>
      {title && (
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex-1" />
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function Stat({ k, v, cls, sub }: { k: string; v: string; cls?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className={cn("text-lg font-semibold tabular-nums", cls)}>{v}</div>
      {sub && <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

export function BacktestListPage() {
  const { t } = useI18n();
  const { items, error } = useBacktests(true);
  useEffect(() => {
    document.title = t("bt.title");
  }, [t]);
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Header title={t("bt.title")} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl">
          <BacktestList items={items} error={error} />
        </div>
      </div>
    </div>
  );
}

export function BacktestPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [bt, setBt] = useState<Backtest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setBt(null);
    setError(null);
    const tick = async (full: boolean) => {
      try {
        const b = await fetchBacktest(id, full);
        if (stop) return;
        if (isActive(b.status)) {
          setBt(b);
          timer = setTimeout(() => void tick(false), 4000);
        } else if (!full) {
          void tick(true); // 刚跑完：取完整结果
        } else {
          setBt(b);
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick(true);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    document.title = bt?.name ? `${bt.name} · ${t("bt.title")}` : t("bt.title");
  }, [bt?.name, t]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Header
        title={
          bt ? (
            <NameEditor
              bt={bt}
              onRenamed={(name, attempt) => setBt((b) => (b ? { ...b, name, attempt: attempt ?? b.attempt, spec: b.spec ? { ...b.spec, name } : b.spec } : b))}
            />
          ) : (
            t("bt.title")
          )
        }
        right={
          bt ? (
            <>
              <StatusBadge b={bt} />
              {bt.status !== "running" && (
                <button
                  type="button"
                  onClick={() => {
                    setDelError(null);
                    setConfirmDel(true);
                  }}
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2Icon className="size-4" />
                </button>
              )}
            </>
          ) : null
        }
      />
      {delError && <div className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">{delError}</div>}
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={t("bt.deleteTitle")}
        description={t("bt.deleteDesc", { name: bt?.name ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => {
          if (!bt) return;
          deleteBacktest(bt.id)
            .then(() => navigate("/backtest", { replace: true }))
            .catch((e) => setDelError(e instanceof Error ? e.message : String(e)));
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 p-3 sm:p-4">
          {error && <div className="py-10 text-center text-sm text-muted-foreground">{error || t("bt.notFound")}</div>}
          {!error && !bt && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          )}
          {bt && isActive(bt.status) && <Progress bt={bt} />}
          {bt && bt.status === "failed" && (
            <Card>
              <p className="text-sm text-destructive">{bt.error || t("bt.status.failed")}</p>
            </Card>
          )}
          {bt && bt.status === "done" && bt.result && <Result bt={bt} />}
          {bt && <SpecCard bt={bt} />}
          {bt && bt.status === "done" && <p className="px-1 pb-4 text-xs text-muted-foreground">{t("bt.disclaimer")}</p>}
        </div>
      </div>
    </div>
  );
}

function NameEditor({ bt, onRenamed }: { bt: Backtest; onRenamed: (name: string, attempt?: number) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bt.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const name = value.trim();
    if (!name || name === bt.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await renameBacktest(bt.id, name);
      onRenamed(r.name, r.attempt);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  if (!editing)
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{bt.name}</span>
        {bt.attempt && bt.attempt > 1 ? (
          <span className="shrink-0 text-xs font-normal text-muted-foreground">{t("bt.attempt", { n: bt.attempt })}</span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setValue(bt.name);
            setErr(null);
            setEditing(true);
          }}
          title={t("bt.rename")}
          aria-label={t("bt.rename")}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <PencilIcon className="size-3.5" />
        </button>
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1">
      <input
        autoFocus
        value={value}
        maxLength={40}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-0.5 text-sm font-normal"
      />
      <button type="button" onClick={() => void save()} disabled={saving} aria-label={t("common.save")} className="shrink-0 rounded-md p-1 hover:bg-muted">
        {saving ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={saving} aria-label={t("common.cancel")} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted">
        <XIcon className="size-4" />
      </button>
      {err && <span className="shrink-0 text-xs font-normal text-destructive">{err}</span>}
    </span>
  );
}

function Progress({ bt }: { bt: Backtest }) {
  const { t } = useI18n();
  const p = Math.round((bt.progress ?? 0) * 100);
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        <span>{t(`bt.status.${bt.status}` as "bt.status.queued")}</span>
        {bt.status === "queued" && typeof bt.ahead === "number" && bt.ahead > 0 && (
          <span className="text-muted-foreground">{t("bt.ahead", { n: bt.ahead })}</span>
        )}
        {bt.stage && <span className="text-muted-foreground">{t("bt.stage", { s: bt.stage })}</span>}
        <span className="ml-auto tabular-nums text-muted-foreground">{bt.status === "running" ? `${p}%` : ""}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${bt.status === "running" ? p : 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("bt.quietWindow")}</p>
    </Card>
  );
}

function Result({ bt }: { bt: Backtest }) {
  const { t, lang } = useI18n();
  const r = bt.result!;
  const m = r.metrics || {};
  const s: Metrics = m.strategy || {};
  const b: Metrics = m.benchmark || {};
  const [log, setLog] = useState(true);
  const benchName = label(BENCHMARK, bt.spec?.benchmark, lang);
  const nav = r.nav || [];
  const bnav = r.benchmark_nav || [];
  const dd = useMemo(() => drawdown(nav), [nav]);
  const bdd = useMemo(() => drawdown(bnav), [bnav]);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat k={t("bt.cagr")} v={fmtPct(s.cagr)} cls={signClass(s.cagr)} sub={`${t("bt.total")} ${fmtPct(s.total_return, 0)}`} />
        <Stat k={t("bt.excess")} v={fmtPct(m.annual_excess, 1, true)} cls={signClass(m.annual_excess)} sub={`${benchName} ${fmtPct(b.cagr)}`} />
        <Stat k={t("bt.mdd")} v={fmtPct(s.max_drawdown)} sub={s.mdd_peak ? `${s.mdd_peak} → ${s.mdd_trough}` : undefined} />
        <Stat k={t("bt.sharpe")} v={fmtNum(s.sharpe)} sub={`${t("bt.vol")} ${fmtPct(s.volatility)}`} />
      </div>

      <Card
        title={t("bt.nav")}
        right={
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} />
            {t("bt.logScale")}
          </label>
        }
      >
        <LineChart
          series={[
            { name: t("bt.strategy"), color: C_STRAT, points: nav },
            { name: benchName, color: C_BENCH, points: bnav },
          ]}
          log={log}
          baseline={1}
          fmt={(v) => v.toFixed(v >= 10 ? 1 : 2)}
        />
        <div className="mt-3 text-xs text-muted-foreground">{t("bt.drawdown")}</div>
        <LineChart
          height={130}
          series={[
            { name: t("bt.strategy"), color: C_DD, points: dd, area: true },
            { name: benchName, color: C_BENCH, points: bdd, dashed: true },
          ]}
          baseline={0}
          fmt={(v) => `${v.toFixed(0)}%`}
        />
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title={t("bt.yearly")}>
          <Yearly strat={r.yearly?.strategy || {}} bench={r.yearly?.benchmark || {}} benchName={benchName} />
        </Card>
        <div className="flex flex-col gap-3">
          <Card title={t("bt.random")}>
            <RandomTest bt={bt} />
          </Card>
          <Card title={t("bt.oos")}>
            {r.oos?.strategy && r.oos.start ? (
              <>
                <p className="mb-2 text-xs text-muted-foreground">{t("bt.oosDesc", { start: r.oos.start })}</p>
                <MetricTable rows={[[t("bt.strategy"), r.oos.strategy], [benchName, r.oos.benchmark || {}]]} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("bt.oosNone")}</p>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {(
            [
              [t("bt.benchCagr"), fmtPct(b.cagr)],
              [t("bt.calmar"), fmtNum(s.calmar)],
              [t("bt.ir"), fmtNum(m.info_ratio)],
              [t("bt.te"), fmtPct(m.tracking_error)],
              [t("bt.turnover"), fmtPct(m.avg_turnover, 0)],
              [t("bt.rebalances"), String(m.rebalances ?? "—")],
              [t("bt.period"), s.start ? `${s.start} ~ ${s.end}` : "—"],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col py-1">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {!!r.picks?.length && (
        <Card title={t("bt.picks")} right={r.as_of ? <span className="text-xs text-muted-foreground">{t("bt.picksAsOf", { d: r.as_of })}</span> : null}>
          <Picks bt={bt} />
        </Card>
      )}

      {!!r.holdings?.length && (
        <Card title={t("bt.holdings")}>
          <Holdings bt={bt} />
        </Card>
      )}

      {r.diagnostics && (
        <Card title={t("bt.diag")}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {Object.entries(r.diagnostics).map(([k, v]) => (
              <div key={k} className="flex flex-col py-1">
                <span className="text-xs text-muted-foreground">{t(`bt.diag.${k}` as "bt.diag.avg_eligible")}</span>
                <span className="tabular-nums">{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(1)) : String(v)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function MetricTable({ rows }: { rows: [string, Metrics][] }) {
  const { t } = useI18n();
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1 text-left font-normal" />
          <th className="py-1 text-right font-normal">{t("bt.cagr")}</th>
          <th className="py-1 text-right font-normal">{t("bt.mdd")}</th>
          <th className="py-1 text-right font-normal">{t("bt.sharpe")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, x]) => (
          <tr key={name} className="border-t">
            <td className="py-1">{name}</td>
            <td className={cn("py-1 text-right", signClass(x.cagr))}>{fmtPct(x.cagr)}</td>
            <td className="py-1 text-right">{fmtPct(x.max_drawdown)}</td>
            <td className="py-1 text-right">{fmtNum(x.sharpe)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Yearly({ strat, bench, benchName }: { strat: Record<string, number>; bench: Record<string, number>; benchName: string }) {
  const { t } = useI18n();
  const years = Object.keys(strat).sort().reverse();
  const max = Math.max(1, ...years.map((y) => Math.abs(strat[y] ?? 0)));
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1 text-left font-normal">{t("bt.year")}</th>
          <th className="py-1 text-right font-normal">{t("bt.strategy")}</th>
          <th className="w-1/3 py-1" />
          <th className="py-1 text-right font-normal">{benchName}</th>
          <th className="py-1 text-right font-normal">{t("bt.yearExcess")}</th>
        </tr>
      </thead>
      <tbody>
        {years.map((y) => {
          const v = strat[y];
          const bv = bench[y];
          const ex = bv === undefined ? undefined : v - bv;
          return (
            <tr key={y} className="border-t">
              <td className="py-1">{y}</td>
              <td className={cn("py-1 text-right", signClass(v))}>{fmtPct(v)}</td>
              <td className="px-2 py-1">
                <div className="relative h-2">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                  <div
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                      background: v >= 0 ? "#F92855" : "#2DC08E",
                      width: `${(Math.abs(v) / max) * 50}%`,
                      left: v >= 0 ? "50%" : `${50 - (Math.abs(v) / max) * 50}%`,
                    }}
                  />
                </div>
              </td>
              <td className="py-1 text-right text-muted-foreground">{fmtPct(bv)}</td>
              <td className={cn("py-1 text-right", signClass(ex))}>{fmtPct(ex, 1, true)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RandomTest({ bt }: { bt: Backtest }) {
  const { t } = useI18n();
  const r = bt.result?.random;
  const xs = r?.cagr || [];
  const sc = bt.result?.metrics?.strategy?.cagr;
  if (!xs.length) return <p className="text-sm text-muted-foreground">—</p>;
  const lo = Math.min(xs[0], sc ?? xs[0]);
  const hi = Math.max(xs[xs.length - 1], sc ?? xs[xs.length - 1]);
  const span = Math.max(1e-9, hi - lo);
  const bins = 20;
  const counts = Array(bins).fill(0);
  for (const x of xs) counts[Math.min(bins - 1, Math.floor(((x - lo) / span) * bins))]++;
  const cmax = Math.max(...counts);
  const pos = sc === null || sc === undefined ? null : ((sc - lo) / span) * 100;
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {t("bt.randomDesc", { runs: r?.runs ?? xs.length, p: fmtPct(r?.strategy_percentile, 0) })}
      </p>
      <div className="relative flex h-16 items-end gap-px">
        {counts.map((c, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-muted-foreground/30" style={{ height: `${(c / cmax) * 100}%` }} />
        ))}
        {pos !== null && (
          <div className="absolute inset-y-0 w-0.5" style={{ left: `calc(${pos}% - 1px)`, background: C_STRAT }} title={`${t("bt.strategy")} ${fmtPct(sc)}`} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{fmtPct(lo)}</span>
        <span style={{ color: C_STRAT }}>
          {t("bt.strategy")} {fmtPct(sc)}
        </span>
        <span>{fmtPct(hi)}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        {t("bt.randomRange", { min: fmtPct(xs[0]), med: fmtPct(xs[Math.floor(xs.length / 2)]), max: fmtPct(xs[xs.length - 1]) })}
      </p>
    </div>
  );
}

function Picks({ bt }: { bt: Backtest }) {
  const { t } = useI18n();
  const r = bt.result!;
  const picks = r.picks || [];
  const cols = Object.keys(picks[0]?.factors || {});
  const info = r.factor_info || {};
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 pr-3 text-left font-normal">#</th>
            <th className="py-1 pr-3 text-left font-normal" />
            <th className="py-1 pr-3 text-right font-normal">{t("bt.score")}</th>
            {cols.map((c) => (
              <th key={c} className="py-1 pr-3 text-right font-normal" title={info[c] || c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {picks.map((p, i) => (
            <tr key={p.code} className="border-t">
              <td className="py-1 pr-3 text-muted-foreground">{i + 1}</td>
              <td className="py-1 pr-3">
                <Link to={`/kline?symbol=${encodeURIComponent(platformSymbol(p.code))}`} className="hover:underline">
                  {p.name || p.code}
                </Link>
                <span className="ml-1 text-xs text-muted-foreground">{platformSymbol(p.code)}</span>
              </td>
              <td className="py-1 pr-3 text-right">{p.score.toFixed(3)}</td>
              {cols.map((c) => (
                <td key={c} className="py-1 pr-3 text-right">
                  {p.factors[c] === null || p.factors[c] === undefined ? "—" : fmtFactor(c, p.factors[c] as number)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtFactor(name: string, v: number): string {
  if (name === "amount_20d" || name === "float_mcap") return v >= 1e8 ? `${(v / 1e8).toFixed(1)}亿` : `${(v / 1e4).toFixed(0)}万`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function Holdings({ bt }: { bt: Backtest }) {
  const { t } = useI18n();
  const hs = bt.result?.holdings || [];
  const [i, setI] = useState(hs.length - 1);
  const h = hs[Math.min(Math.max(0, i), hs.length - 1)];
  if (!h) return null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={i}
          onChange={(e) => setI(Number(e.target.value))}
          className="rounded-md border bg-background px-2 py-1 text-sm tabular-nums"
        >
          {hs.map((x, k) => (
            <option key={k} value={k}>
              {x.exec}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">{t("bt.holdingsPeriod", { s: h.signal, e: h.exec })}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {h.codes.map(([c, n]) => (
          <Link
            key={c}
            to={`/kline?symbol=${encodeURIComponent(platformSymbol(c))}`}
            className="rounded-md bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
            title={platformSymbol(c)}
          >
            {n || platformSymbol(c)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function SpecCard({ bt }: { bt: Backtest }) {
  const { t, lang } = useI18n();
  const s = bt.spec;
  if (!s) return null;
  const info = bt.result?.factor_info || {};
  const fname = (f: string) => (info[f] ? `${info[f]}（${f}）` : f);
  const u = s.universe || {};
  const uni = [
    label(POOL, u.pool, lang),
    ...(u.exclude?.length ? [(lang === "zh" ? "排除 " : "excl. ") + u.exclude.map((x) => label(EXCLUDE, x, lang)).join(lang === "zh" ? "、" : ", ")] : []),
    ...(u.min_avg_amount ? [t("bt.minAmount", { v: fmtAmount(u.min_avg_amount, lang) })] : []),
    ...(u.industries?.length ? [t("bt.industries", { v: u.industries.join(lang === "zh" ? "、" : ", ") })] : []),
  ].join(" · ");
  const c = s.costs || {};
  const pct = (v?: number) => (v === undefined ? "—" : `${+(v * 100).toFixed(3)}%`);
  const rows: [string, ReactNode][] = [
    [t("bt.universe"), uni],
    [t("bt.filters"), s.filters?.length ? s.filters.map((f, i) => <div key={i}>{filterText(f, fname(f.factor), lang)}</div>) : "—"],
    [t("bt.rank"), s.rank?.length ? s.rank.map((r, i) => <div key={i}>{rankText(r, fname(r.factor), lang)}</div>) : "—"],
    [t("bt.hold"), s.hold ? t("bt.holdN", { n: s.hold }) : "—"],
    [t("bt.rebalance"), label(REBALANCE, s.rebalance, lang)],
    [t("bt.period"), s.period ? `${s.period[0]} ~ ${s.period[1] || (lang === "zh" ? "最新" : "latest")}` : "—"],
    [t("bt.benchmark"), label(BENCHMARK, s.benchmark, lang)],
    [t("bt.costs"), t("bt.costsText", { c: pct(c.commission), s: pct(c.stamp_tax_sell), sl: pct(c.slippage) })],
  ];
  return (
    <Card title={t("bt.spec")}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
