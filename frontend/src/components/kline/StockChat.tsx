/**
 * K 线页右侧的 AI 聊天框：分析当前这只股票。
 * - 每只股票一个固定对话（标题「📈 600519.SH 贵州茅台」），下次打开接着聊，也出现在首页的对话列表里
 * - 每轮把「在看哪只股票」作为 pageContext 发给后端（只进这次的系统提示，不存库）；数据让 AI 用金融工具查
 * - 这里不画 K 线（左边就是图）：代码块换成按钮，点了在左边大图上看
 * - 模型只给 DeepSeek V4 Flash 和 GPT Luna
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, Loader2Icon, SquareIcon, WrenchIcon, XIcon } from "lucide-react";
import { chatAPI } from "@/lib/api/chat";
import { conversationsAPI } from "@/lib/api/conversations";
import type { Message, Model, ToolCall } from "@/lib/api/types";
import { Response, KlineInlineContext } from "@/components/ai-elements/response";
import { useModelsContext } from "@/hooks/useModelsContext";
import { useI18n } from "@/lib/i18n";

type ChatMsg = { key: string; role: "user" | "assistant"; content: string; tools: ToolCall[]; pending?: boolean; error?: string };

const MODEL_KEY = "kline.chatModel";

/** 聊天框能用的模型：DeepSeek V4 Flash、GPT Luna（模型列表里有哪个给哪个），DeepSeek 排前面 */
export function chatModels(models: Model[]): Model[] {
  const is = (m: Model, k: string) => m.id.toLowerCase().includes(k) || (m.name || "").toLowerCase().includes(k);
  const flash = models.filter((m) => is(m, "deepseek-v4-flash") || is(m, "deepseek v4 flash"));
  const luna = models.filter((m) => is(m, "luna"));
  return [...flash, ...luna.filter((m) => !flash.includes(m))];
}

export function convTitle(symbol: string, name?: string): string {
  return `📈 ${symbol}${name ? ` ${name}` : ""}`;
}

/** 这只股票的对话：标题「📈 代码」开头（后面可能跟名称） */
export function findStockConversation<T extends { id: string; title?: string }>(convs: T[], symbol: string): T | undefined {
  const p = `📈 ${symbol}`;
  return convs.find((c) => c.title === p || (c.title ?? "").startsWith(p + " "));
}

/** 消息树 → 当前分支（从根沿最后一个孩子走到底），只要用户和助手的 */
export function activePath(messages: Record<number, Message>): Message[] {
  const all = Object.values(messages);
  const byId = new Map(all.map((m) => [m.id, m]));
  let cur = all.filter((m) => !m.parentId || !byId.has(m.parentId)).sort((a, b) => a.id - b.id).pop();
  const out: Message[] = [];
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.role === "user" || cur.role === "assistant") out.push(cur);
    const kids: number[] = (cur.children ?? []).filter((k: number) => byId.has(k));
    cur = kids.length ? byId.get(kids[kids.length - 1]) : undefined;
  }
  return out;
}

export function pageContext(symbol: string, name?: string): string {
  return [
    `用户正在 K 线页看：${symbol}${name ? `（${name}）` : ""}。用户说「这只」「它」「当前股票」都指它，除非用户换了别的代码。`,
    "这个聊天框在 K 线图右侧，左边已经画好了这只股票的全部历史 K 线：不要输出 ```kline 代码块，也不要画图。",
    "需要行情、技术面、公告、财务等数据就调用金融工具去查，不要凭记忆编数字；回答简洁、用中文。",
  ].join("\n");
}

export function StockChat({ symbol, name, onShowSymbol, onClose }: {
  symbol: string;
  name?: string;
  onShowSymbol: (sym: string) => void;
  /** 手机抽屉：标题栏右边放关闭按钮 */
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const { enabledModels } = useModelsContext();
  const models = useMemo(() => chatModels(enabledModels), [enabledModels]);
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_KEY) || "";
    } catch {
      return "";
    }
  });
  const activeModel = models.find((m) => m.id === model)?.id ?? models[0]?.id ?? "";

  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const lastIdRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const assistantIdRef = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // 换股票：找这只的对话，载入当前分支
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMsgs([]);
    setConvId(null);
    lastIdRef.current = 0;
    conversationsAPI
      .fetchConversations()
      .then(async (convs) => {
        const c = findStockConversation(convs, symbol);
        if (!c || cancelled) return;
        const all = await conversationsAPI.fetchConversationMessages(c.id);
        if (cancelled) return;
        const path = activePath(all);
        setConvId(c.id);
        lastIdRef.current = path.length ? path[path.length - 1].id : 0;
        setMsgs(path.map((m) => ({ key: String(m.id), role: m.role as "user" | "assistant", content: m.content, tools: m.tools ?? [], error: m.error })));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  const patchLast = (f: (m: ChatMsg) => ChatMsg) => setMsgs((cur) => (cur.length ? [...cur.slice(0, -1), f(cur[cur.length - 1])] : cur));

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy || !activeModel) return;
      setInput("");
      setBusy(true);
      const now = Date.now();
      setMsgs((cur) => [...cur, { key: `u${now}`, role: "user", content, tools: [] }, { key: `a${now}`, role: "assistant", content: "", tools: [], pending: true }]);
      try {
        let id = convId;
        if (!id) {
          const c = await conversationsAPI.createConversation(convTitle(symbol, name));
          id = c.id;
          setConvId(id);
        }
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        assistantIdRef.current = null;
        await chatAPI.sendMessageStream(
          id,
          lastIdRef.current || null,
          activeModel,
          content,
          false,
          undefined,
          (chunk) => patchLast((m) => ({ ...m, content: m.content + chunk })),
          undefined,
          (tc) =>
            patchLast((m) => {
              const i = m.tools.findIndex((x) => x.id === tc.id);
              const tools = i >= 0 ? m.tools.map((x, j) => (j === i ? { ...x, ...tc } : x)) : [...m.tools, tc];
              return { ...m, tools };
            }),
          (meta) => {
            if (meta.assistantMessageId) assistantIdRef.current = meta.assistantMessageId;
          },
          (done) => {
            lastIdRef.current = done.assistantMessageId || lastIdRef.current;
            patchLast((m) => ({ ...m, pending: false }));
          },
          (err) => patchLast((m) => ({ ...m, pending: false, error: err })),
          undefined,
          ctrl.signal,
          pageContext(symbol, name),
        );
      } catch (e) {
        patchLast((m) => ({ ...m, pending: false, error: m.error || (e instanceof Error ? e.message : String(e)) }));
      } finally {
        patchLast((m) => ({ ...m, pending: false }));
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, activeModel, convId, symbol, name],
  );

  const stop = () => {
    if (assistantIdRef.current) chatAPI.cancelStream(assistantIdRef.current).catch(() => {});
    abortRef.current?.abort();
  };

  const quick = [
    { k: "tech", q: `分析一下 ${symbol} 的技术面：趋势、均线、成交量、关键指标` },
    { k: "levels", q: `${symbol} 现在的支撑位和压力位大概在哪里？` },
    { k: "ann", q: `解读一下 ${symbol} 最近的公告，有哪些值得注意` },
    { k: "fin", q: `${symbol} 最近几期财报的要点：营收、利润、毛利率的变化` },
    { k: "peers", q: `${symbol} 和同行业主要公司比一比` },
  ];

  const onKlineSpec = useCallback(
    (spec: unknown) => {
      const s = (spec as { symbol?: unknown })?.symbol;
      if (typeof s === "string") onShowSymbol(s.toUpperCase());
    },
    [onShowSymbol],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="text-sm font-medium">{t("kline.chat.title")}</span>
        <span className="truncate text-xs text-muted-foreground">{name ? `${name} ${symbol}` : symbol}</span>
        <select
          value={activeModel}
          onChange={(e) => {
            setModel(e.target.value);
            try {
              localStorage.setItem(MODEL_KEY, e.target.value);
            } catch {
              /* 本机存不了就算了 */
            }
          }}
          className="ml-auto max-w-[45%] rounded border bg-background px-1 py-0.5 text-xs"
          aria-label={t("kline.chat.model")}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.id}
            </option>
          ))}
        </select>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={t("kline.chat.close")}>
            <XIcon className="size-4" />
          </button>
        )}
      </div>
      <KlineInlineContext.Provider value={onKlineSpec}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-2 text-sm">
          {loading && <p className="text-xs text-muted-foreground">{t("kline.loading")}</p>}
          {!loading && msgs.length === 0 && <p className="text-xs text-muted-foreground">{t("kline.chat.empty")}</p>}
          {msgs.map((m) =>
            m.role === "user" ? (
              <div key={m.key} className="ml-6 rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap break-words">
                {m.content}
              </div>
            ) : (
              <div key={m.key} className="min-w-0">
                {m.tools.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {m.tools.map((tc) => (
                      <span key={tc.id} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {tc.tool_output === undefined && m.pending ? <Loader2Icon className="size-3 animate-spin" /> : <WrenchIcon className="size-3" />}
                        {tc.name}
                      </span>
                    ))}
                  </div>
                )}
                {m.content ? (
                  <Response className="text-sm [&_p]:mb-2 [&_p]:[line-height:1.6rem]">{m.content}</Response>
                ) : m.pending ? (
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                ) : null}
                {m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </KlineInlineContext.Provider>
      <div className="shrink-0 border-t px-2 py-2">
        <div className="mb-1.5 flex flex-wrap gap-1">
          {quick.map((x) => (
            <button
              key={x.k}
              type="button"
              disabled={busy || !activeModel}
              onClick={() => send(x.q)}
              className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {t(`kline.chat.q.${x.k}` as "kline.chat.q.tech")}
            </button>
          ))}
        </div>
        {!activeModel ? (
          <p className="px-1 text-xs text-destructive">{t("kline.chat.noModel")}</p>
        ) : (
          <div className="flex items-end gap-1.5 rounded-md border px-2 py-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder={t("kline.chat.placeholder")}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm outline-none"
            />
            {busy ? (
              <button type="button" onClick={stop} className="rounded-md border p-1.5 hover:bg-muted" title={t("kline.chat.stop")}>
                <SquareIcon className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send(input)}
                disabled={!input.trim()}
                className="rounded-md bg-primary p-1.5 text-primary-foreground disabled:opacity-40"
                title={t("kline.chat.send")}
              >
                <ArrowUpIcon className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

