/** 首页右侧「回测」栏（宽屏才有；窄屏从左侧栏的「回测」进 /backtest）。可收起，记住在本机。 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConicalIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { BacktestList, useBacktests } from "./BacktestList";
import { useI18n } from "@/lib/i18n";

const KEY = "ai-ui-backtest-panel-collapsed";

export function BacktestSidebar({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const { items, error } = useBacktests(enabled && !collapsed);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* 无痕模式等 */
      }
      return !c;
    });
  };
  if (!enabled) return null;
  if (collapsed)
    return (
      <aside className="hidden w-11 shrink-0 flex-col items-center gap-2 border-l py-2 xl:flex">
        <button
          type="button"
          onClick={toggle}
          title={t("bt.expand")}
          aria-label={t("bt.expand")}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted"
        >
          <PanelRightOpenIcon className="size-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => navigate("/backtest")}
          title={t("bt.viewAll")}
          aria-label={t("bt.viewAll")}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted"
        >
          <FlaskConicalIcon className="size-[18px]" />
        </button>
      </aside>
    );
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l xl:flex">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
        <FlaskConicalIcon className="size-4 text-muted-foreground" />
        <button type="button" onClick={() => navigate("/backtest")} className="text-sm font-semibold hover:underline">
          {t("bt.title")}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggle}
          title={t("bt.collapse")}
          aria-label={t("bt.collapse")}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        >
          <PanelRightCloseIcon className="size-[18px]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BacktestList items={items} error={error} />
      </div>
    </aside>
  );
}
