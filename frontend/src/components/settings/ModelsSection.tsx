import React, { useMemo, useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  CheckSquare,
  Eye,
  EyeOff,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import { locallyApplyEnableFlags } from "@/lib/api/models";
import { formatProviderSelectLabel } from "@/lib/api/providers";
import { Model } from "@/lib/api/types";
import { useSettingsData } from "@/hooks/useSettingsData";

type ModelTag = {
  label: string;
  className: string;
};

const getModelTags = (model: Model): ModelTag[] => {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();

  const tags: ModelTag[] = [];

  // 免费 / 收费
  if (id === "openrouter/free" || id.endsWith(":free")) {
    tags.push({
      label: "免费",
      className:
        "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
    });
  } else {
    tags.push({
      label: "收费",
      className:
        "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    });
  }

  // GPT-5.6 Luna
  if (id.includes("gpt-5.6-luna") || name.includes("gpt-5.6 luna")) {
    tags.push(
      {
        label: "日常",
        className:
          "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
      },
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
    );
  }

  // GPT-6 Astra
  else if (id.includes("gpt-6-astra") || name.includes("gpt-6 astra")) {
    tags.push(
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
      {
        label: "多模态",
        className:
          "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400",
      },
    );
  }

  // Claude Opus 5
  else if (
    id.includes("claude-opus-5") ||
    name.includes("claude opus 5")
  ) {
    tags.push(
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
    );
  }

  // DeepSeek V4 Pro
  else if (
    id.includes("deepseek-v4-pro") ||
    name.includes("deepseek v4 pro")
  ) {
    tags.push(
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
    );
  }

  // DeepSeek V4 Flash
  else if (
    id.includes("deepseek-v4-flash") ||
    name.includes("deepseek v4 flash")
  ) {
    tags.push(
      {
        label: "高速",
        className:
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
      },
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
    );
  }

  // Gemini Flash
  else if (
    id.includes("gemini") &&
    (id.includes("flash") || name.includes("flash"))
  ) {
    tags.push(
      {
        label: "高速",
        className:
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
      },
      {
        label: "多模态",
        className:
          "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400",
      },
    );
  }

  // Codex / 编程模型
  else if (id.includes("codex") || name.includes("codex")) {
    tags.push({
      label: "编程",
      className:
        "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    });
  }

  return tags;
};


/**

 * ModelsSection (refined styles)

 *

 * - Uniform control heights
 * - Minimal toggle (On/Off pill) replacing switch
 * - No transient spinners for quick actions
 * - Scroll confined only to models list (section header static)
 * - Transparent checkboxes (no colored background)
 */

export const ModelsSection: React.FC = () => {
  const { models, updateModelsLocal, saveModels } = useSettingsData();
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return models;

    const q = search.toLowerCase();

    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, search]);

  const enabledInFiltered = filtered.filter((m) => m.is_enabled).length;

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 5,
  });

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selection.has(m.id));

  const anySelected = selection.size > 0;

  const toggleSelect = (id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const selectAllVisible = () =>
    setSelection(new Set(filtered.map((m) => m.id)));

  const clearSelection = () => setSelection(new Set());

  const applyFlagUpdatesOptimistic = (
    updates: { id: string; is_enabled: boolean }[],
  ) => {
    if (!updates.length) return;

    const updated = locallyApplyEnableFlags(models, updates);
    updateModelsLocal(updated);
  };

  const commitFlagUpdates = async (ids: string[], enabled: boolean) => {
    if (ids.length === 0) return;

    applyFlagUpdatesOptimistic(ids.map((id) => ({ id, is_enabled: enabled })));

    setPendingIds((prev) => {
      const next = new Set(prev);

      ids.forEach((id) => next.add(id));

      return next;
    });

    try {
      const changedModels = models
        .filter((m) => ids.includes(m.id))
        .map((m) => ({ ...m, is_enabled: enabled }));
      await saveModels(changedModels);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);

        ids.forEach((id) => next.delete(id));

        return next;
      });
    }
  };

  const handleSingleToggle = (model: Model) => {
    void commitFlagUpdates([model.id], !model.is_enabled);
  };

  const handleBulk = async (enable: boolean) => {
    if (!anySelected) return;

    setBulkBusy(true);

    await commitFlagUpdates(Array.from(selection), enable);

    setBulkBusy(false);

    clearSelection();
  };

  const enabledSelectedCount = Array.from(selection).filter(
    (id) => models.find((m) => m.id === id)?.is_enabled,
  ).length;

  const disabledSelectedCount = selection.size - enabledSelectedCount;

  return (
    <div className="flex flex-col h-full gap-5">
      {/* Header & Actions (non-scrollable) */}
      <div className="flex-shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Models
          </h3>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

            <Input
              placeholder="Search models or providers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm focus-visible:ring-0 focus-visible:outline-none focus-visible:border-border border-border/70"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                allVisibleSelected ? clearSelection() : selectAllVisible()
              }
              disabled={filtered.length === 0}
              className="gap-1 h-8"
            >
              {allVisibleSelected ? (
                <>
                  <CheckSquare className="h-4 w-4" />
                  Deselect
                </>
              ) : (
                <>
                  <Square className="h-4 w-4" />
                  Select All
                </>
              )}
            </Button>

            <Button
              size="sm"
              onClick={() => handleBulk(true)}
              disabled={!anySelected || bulkBusy}
              className="gap-1 h-8"
            >
              <Eye className="h-4 w-4" />
              Enable
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulk(false)}
              disabled={!anySelected || bulkBusy}
              className="gap-1 h-8"
            >
              <EyeOff className="h-4 w-4" />
              Disable
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>
            {filtered.length} model{filtered.length !== 1 && "s"} shown
          </span>

          <span>{enabledInFiltered} enabled in view</span>

          {selection.size > 0 && (
            <span>
              Selected: {selection.size} (E:{enabledSelectedCount} / D:
              {disabledSelectedCount})
            </span>
          )}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 min-h-0">
        {filtered.length === 0 && (
          <Card className="p-8 text-center bg-transparent border-dashed h-full">
            <p className="text-sm text-muted-foreground">
              {search ? "No models match your search." : "No models available."}
            </p>
          </Card>
        )}

        {filtered.length > 0 && (
          <div ref={parentRef} className="h-full overflow-y-auto pr-1">
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const model = filtered[virtualRow.index];
                const selected = selection.has(model.id);
                const pending = pendingIds.has(model.id);

                return (
                  <div
                    key={model.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${Math.round(virtualRow.start)}px)`,
                      paddingBottom: "8px",
                    }}
                  >
                    <div
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "bg-primary/5 border-primary/40"
                          : "border-border/50 hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(model.id)}
                        className="h-4 w-4 cursor-pointer rounded-md bg-transparent border border-border checked:bg-primary checked:border-primary transition-colors flex-shrink-0"
                      />

                      <div className="flex-1 min-h-0 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="truncate max-w-[200px] sm:max-w-[300px]"
                            title={model.name}
                          >
                            {model.name}
                          </span>

                          <div className="flex items-center gap-1 flex-wrap flex-shrink-0">
                            {getModelTags(model).map((tag) => (
                              <span
                                key={tag.label}
                                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${tag.className}`}
                              >
                                {tag.label}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div
                          className="text-[11px] text-muted-foreground truncate max-w-[200px] sm:max-w-[300px]"
                          title={model.id}
                        >
                          {formatProviderSelectLabel(model.provider)}
                        </div>
                      </div>

                      <Switch
                        checked={model.is_enabled}
                        onCheckedChange={() => handleSingleToggle(model)}
                        disabled={pending || bulkBusy}
                        title={
                          model.is_enabled ? "Disable model" : "Enable model"
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
