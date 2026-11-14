/**
 * 回测列表：首页右侧栏、/backtest 页共用。有排队 / 运行中的每 6 秒刷新一次，否则 30 秒（AI 刚提交的很快能看到）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { fetchBacktests, fmtPct, fmtTime, isActive, marketOf, type BacktestItem } from "./api";
import { MARKET, label } from "./labels";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const UP = "text-[#F92855]";
const DOWN = "text-[#2DC08E]";

export function signClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? UP : DOWN;
}

export function useBacktests(enabled = true) {
  const [items, setItems] = useState<BacktestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    let next = 30000;
    try {
      const list = await fetchBacktests(50);
      setItems(list);
      setError(null);
      if (list.some((b) => isActive(b.status))) next = 6000;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      next = 60000;
    }
    timer.current = setTimeout(() => void load(), next);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, load]);
  return { items, error, reload: load };
}

export function StatusBadge({ b }: { b: Pick<BacktestItem, "status" | "progress"> }) {
  const { t } = useI18n();
  const cls =
    b.status === "done"
      ? "bg-muted text-muted-foreground"
      : b.status === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-primary/10 text-foreground";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px]", cls)}>
      {isActive(b.status) && <Loader2Icon className="size-3 animate-spin" />}
      {t(`bt.status.${b.status}` as "bt.status.done")}
      {b.status === "running" && typeof b.progress === "number" ? ` ${Math.round(b.progress * 100)}%` : ""}
    </span>
  );
}

export function MarketTag({ market }: { market: string }) {
  const { lang } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center rounded border px-1 text-[10px] leading-4 text-muted-foreground">
      {label(MARKET, market, lang)}
    </span>
  );
}

export function BacktestList({ items, error, activeId, onPick }: {
  items: BacktestItem[] | null;
  error: string | null;
  activeId?: string;
  onPick?: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (items === null && !error)
    return <div className="px-3 py-4 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (error && !items?.length)
    return <div className="px-3 py-4 text-sm text-muted-foreground">{t("bt.loadError")}</div>;
  if (!items?.length)
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
        <FlaskConicalIcon className="size-6 opacity-60" />
        <p>{t("bt.empty")}</p>
      </div>
    );
  return (
    <ul className="flex flex-col gap-1 p-2">
      {items.map((b) => {
        const s = b.summary;
        return (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => {
                onPick?.();
                navigate(`/backtest/${b.id}`);
              }}
              className={cn(
                "w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted",
                activeId === b.id && "bg-muted",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={b.name}>
                  {b.name}
                </span>
                <StatusBadge b={b} />
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                <MarketTag market={marketOf(b)} />
                <span>{fmtTime(b.created_at)}</span>
                {b.attempt && b.attempt > 1 ? <span>{t("bt.attempt", { n: b.attempt })}</span> : null}
              </div>
              {b.status === "done" && s && (
                <div className="mt-1 grid grid-cols-3 gap-1 text-xs tabular-nums">
                  <span>
                    <span className="text-muted-foreground">{t("bt.cagr")} </span>
                    <span className={signClass(s.cagr)}>{fmtPct(s.cagr)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">{t("bt.excess")} </span>
                    <span className={signClass(s.annual_excess)}>{fmtPct(s.annual_excess, 1, true)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">{t("bt.mdd")} </span>
                    {fmtPct(s.max_drawdown)}
                  </span>
                </div>
              )}
              {b.status === "failed" && b.error && (
                <div className="mt-1 line-clamp-2 text-xs text-destructive">{b.error}</div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
