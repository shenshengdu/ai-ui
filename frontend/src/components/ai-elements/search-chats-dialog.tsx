"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Loader2Icon,
  MessageCircleIcon,
  SearchIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientConversation } from "@/lib/clientConversationManager";
import { conversationsAPI } from "@/lib/api/conversations";
import type { ConversationSearchHit } from "@/lib/api/types";
import {
  conversationUpdatedAt,
  groupConversations,
} from "@/lib/conversation-groups";
import { useI18n } from "@/lib/i18n";

type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "new"; key: string }
  | {
      kind: "conversation";
      key: string;
      id: string;
      title: string;
      snippet?: string;
    };

/** Render FTS snippet with [matched] markers from the backend. */
const Snippet = ({ snippet }: { snippet: string }) => {
  const parts = snippet.split(/(\[[^\]]*\])/g);
  return (
    <span className="block truncate text-xs text-muted-foreground">
      {parts.map((part, i) =>
        part.startsWith("[") && part.endsWith("]") && part.length > 2 ? (
          <mark
            key={i}
            className="rounded-sm bg-transparent font-semibold text-foreground"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
};

export interface SearchChatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ClientConversation[];
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  canSearchServer: boolean;
}

/**
 * Command-palette style chat search (ChatGPT "Search chats", ⌘K).
 * Matches titles locally and message bodies through the backend FTS endpoint.
 */
export function SearchChatsDialog({
  open,
  onOpenChange,
  conversations,
  onSelect,
  onNewChat,
  canSearchServer,
}: SearchChatsDialogProps) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [hits, setHits] = useState<ConversationSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useI18n();

  // Reset each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  // Debounced full-text search over message bodies.
  useEffect(() => {
    if (!open || !deferred || !canSearchServer) {
      setHits((prev) => (prev.length ? [] : prev));
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await conversationsAPI.searchConversations(
          deferred,
          controller.signal,
        );
        if (!controller.signal.aborted) setHits(result);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Conversation search failed:", err);
        setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deferred, open, canSearchServer]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (!deferred) {
      out.push({ kind: "new", key: "new" });
      const sorted = [...conversations].sort(
        (a, b) => conversationUpdatedAt(b) - conversationUpdatedAt(a),
      );
      for (const group of groupConversations(sorted.slice(0, 60), t, locale)) {
        out.push({
          kind: "header",
          key: `h-${group.label}`,
          label: group.label,
        });
        for (const c of group.items) {
          out.push({
            kind: "conversation",
            key: c.id,
            id: c.id,
            title: c.title || t("sidebar.untitled"),
          });
        }
      }
      return out;
    }

    const q = deferred.toLowerCase();
    const seen = new Set<string>();
    const snippetById = new Map(hits.map((h) => [h.conversationId, h.snippet]));
    for (const c of conversations) {
      if (!c.title.toLowerCase().includes(q)) continue;
      seen.add(c.id);
      out.push({
        kind: "conversation",
        key: c.id,
        id: c.id,
        title: c.title,
        snippet: snippetById.get(c.id),
      });
    }
    for (const h of hits) {
      if (seen.has(h.conversationId)) continue;
      seen.add(h.conversationId);
      out.push({
        kind: "conversation",
        key: h.conversationId,
        id: h.conversationId,
        title: h.title || t("sidebar.untitled"),
        snippet: h.snippet,
      });
    }
    return out;
  }, [deferred, conversations, hits, t, locale]);

  const selectable = useMemo(
    () =>
      rows
        .map((r, i) => (r.kind === "header" ? -1 : i))
        .filter((i) => i >= 0),
    [rows],
  );

  // Keep the highlighted row valid as results change.
  useEffect(() => {
    setActive(0);
  }, [deferred]);

  const activeRowIndex = selectable[Math.min(active, selectable.length - 1)];

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row="${activeRowIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeRowIndex]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "new") onNewChat();
    else if (row.kind === "conversation") onSelect(row.id);
    else return;
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, selectable.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[activeRowIndex]);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay-animation fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[min(560px,76vh)] w-[calc(100%-2rem)] max-w-[680px] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl animate-slide-up"
        >
          <DialogPrimitive.Title className="sr-only">
            {t("search.title")}
          </DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b px-5 py-4">
            {loading ? (
              <Loader2Icon className="size-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
            )}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <DialogPrimitive.Close className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <XIcon className="size-5" />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-2">
            {rows.length === 0 && !loading && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("search.noResults")}
              </div>
            )}
            {rows.map((row, i) => {
              if (row.kind === "header") {
                return (
                  <div
                    key={row.key}
                    className="px-3 pt-4 pb-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {row.label}
                  </div>
                );
              }
              const isActive = i === activeRowIndex;
              return (
                <button
                  key={row.key}
                  type="button"
                  data-row={i}
                  onMouseMove={() => {
                    const idx = selectable.indexOf(i);
                    if (idx !== active) setActive(idx);
                  }}
                  onClick={() => choose(row)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm",
                    isActive && "bg-accent",
                  )}
                >
                  {row.kind === "new" ? (
                    <>
                      <SquarePenIcon className="size-4 shrink-0" />
                      <span className="font-medium">{t("sidebar.newChat")}</span>
                    </>
                  ) : (
                    <>
                      <MessageCircleIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{row.title}</span>
                        {row.snippet && <Snippet snippet={row.snippet} />}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
