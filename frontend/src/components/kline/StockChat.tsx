/**
 * K 线页右侧的 AI 聊天框：分析当前这只股票。
 * - 每只股票一个固定对话（标题「📈 600519.SH 贵州茅台」），下次打开接着聊，也出现在首页的对话列表里
 * - 每轮把「在看哪只股票」作为 pageContext 发给后端（只进这次的系统提示，不存库）；数据让 AI 用金融工具查
 * - 这里不画 K 线（左边就是图）：代码块换成按钮，点了在左边大图上看
 * - 模型只给 DeepSeek V4 Flash 和 GPT Luna
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, EraserIcon, Loader2Icon, SquareIcon, WrenchIcon, XIcon } from "lucide-react";
import { chatAPI } from "@/lib/api/chat";
import { conversationsAPI } from "@/lib/api/conversations";
import type { Message, Model, ToolCall } from "@/lib/api/types";
import { ChartActionContext, ChartActionLabel, KlineInlineContext, Response } from "@/components/ai-elements/response";
import { describeActions, extractChartActions, parseChartActions, type ChartAction } from "./chart-actions";
import { useModelsContext } from "@/hooks/useModelsContext";
import { useI18n } from "@/lib/i18n";

type ChatMsg = {
  key: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  pending?: boolean;
  error?: string;
  /** 这一轮发给模型的上下文、模型输出的 token 数 */
  promptTokens?: number;
  outputTokens?: number;
};

/** 上下文超过这么多 token 就提示清空 */
export const LONG_CONTEXT_TOKENS = 30000;

export function fmtTokens(n?: number): string {
  if (!n || n <= 0) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** 清空上下文时旧对话改成的标题：不再以「📈 代码」开头，下次就开新对话；旧的仍在对话列表里 */
export function archiveTitle(symbol: string, name: string | undefined, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return `🗂 ${symbol}${name ? ` ${name}` : ""} · ${ts} 存档`;
}

const MODEL_KEY = "kline.chatModel";

/** 聊天框能用的模型：DeepSeek V4 Flash、GPT Luna（模型列表里有哪个给哪个），DeepSeek 排前面 */
export function chatModels(models: Model[]): Model[] {
  // 名字写法不一（deepseek-v4-flash、DeepSeek V4 Flash、deepseek-flash、deepseek/deepseek_v4_flash…）：
  // 去掉空格、横线、下划线、点、斜杠后看有没有 deepseek 和 flash
  const norm = (m: Model) => `${m.id} ${m.name || ""}`.toLowerCase().replace(/[\s\-_./]/g, "");
  const flash = models.filter((m) => norm(m).includes("deepseek") && norm(m).includes("flash"));
  const luna = models.filter((m) => norm(m).includes("luna"));
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
  return `用户正在 K 线页看：${symbol}${name ? `（${name}）` : ""}。用户说「这只」「它」「当前股票」都指它，除非用户换了别的代码。
这个聊天框在 K 线图右侧，左边已经画好了这只股票的全部历史 K 线：不要输出 \`\`\`kline 代码块。

【范围】
- 这里只聊投资相关的话题（这只或其他股票、行业、公司、财报、公告、行情、宏观与市场）。和投资无关的问题（写作、编程、闲聊、生活等）一句话礼貌说明这里只做投资分析、请到首页聊天，不要回答。
- 这里不发布报告：不要生成或发布可分享的报告页面，分析直接写在回答里。

【怎么回答】
- 简单问题直接答，需要时调一个工具。问行业、公司是做什么的、发行价、营收主要来自哪里，先用 finance_company kind=profile。行情、技术面、财务、公告先用金融工具查，不凭记忆编数字；引用数字带数据日期。
- 金融工具没有的（公司简介、发行价、营收板块、管理层、行业地位、近期事件等）不要只说不知道，用 web_search 上网查；网上查到的每一条都按平台的引用格式注明来源（有日期写日期），并说明是网页资料；正文用了几个引用编号，文末来源列表就列几条，每条带链接。股价、财务数字以金融工具为准，网页数字和工具不一致时用工具的并说明差异。
- 用户要「深度研究」「全面分析」「能不能买」这类综合问题，按步骤做：
  1. 先用 3–6 条列出要查什么（计划）；
  2. 逐项调用工具：finance_quote（最新行情）、finance_technical（技术面）、finance_company kind=profile（行业、主营构成）、finance_company kind=financials（最近 5 年财务）、finance_company kind=announcements（近期公告）；美股可再用 finance_stock、finance_valuation；需要大盘背景用 finance_global_market；
  3. 深度研究以工具数据为主；网上资料只用可靠来源（公司官网 / 投资者关系、交易所和监管披露、政府统计、主流财经媒体），论坛、社交媒体、自媒体、来历不明的内容不写进报告，只有这类来源的就略过并说明无法从可靠来源核实；
  4. 最后按这个结构输出：**结论**（一两句）、**技术面**、**基本面与财报**、**近期公告**、**风险**、**关键价位**（支撑、压力），每部分注明数据日期。这是给用户自己做决定的分析，不代替用户下单。

【在左边 K 线图上操作】
回答末尾可以附一个 \`\`\`chart 代码块，内容是 JSON {"actions":[...]}，界面会照着改左边的图。可用动作：
- {"type":"hline","price":1380,"label":"支撑 1380","kind":"support"} 画水平线（kind：support 支撑 / resistance 压力 / other）
- {"type":"range","from":"2026-03-01","to":"2026-04-15","label":"箱体震荡"} 标一段时间区间
- {"type":"interval","value":"week"} 切周期（day / week / month / quarter / year）
- {"type":"indicators","add":["MACD"],"remove":["BOLL"]} 开关指标（MA EMA BOLL VOL MACD KDJ RSI）
- {"type":"symbol","value":"0700.HK"} 换成另一只股票
- {"type":"compare","symbols":["000858.SZ","000568.SZ"]} 打开同行对比页（并排 K 线、涨跌、财务指标；当前股票自动在内，最多再加 5 只）——做同行比较时用
- {"type":"clear"} 先清掉之前画的线和区间
说到具体的支撑位、压力位、形态区间时就画出来（通常先 clear 再画）；价位和日期必须来自工具返回的数据。一条回答最多一个 chart 块，放在最后，不要在正文里解释这个代码块。`;
}

export function StockChat({ symbol, name, onShowSymbol, onChartActions, onClose }: {
  symbol: string;
  name?: string;
  onShowSymbol: (sym: string) => void;
  /** AI 回答里的 ```chart 动作：回答完自动执行一次；点按钮再执行 */
  onChartActions?: (actions: ChartAction[]) => void;
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
  const replyRef = useRef("");

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
        setMsgs(path.map((m) => ({ key: String(m.id), role: m.role as "user" | "assistant", content: m.content, tools: m.tools ?? [], error: m.error,
          promptTokens: m.contextSize, outputTokens: m.tokenCount })));
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
        replyRef.current = "";
        assistantIdRef.current = null;
        await chatAPI.sendMessageStream(
          id,
          lastIdRef.current || null,
          activeModel,
          content,
          false,
          undefined,
          (chunk) => {
            replyRef.current += chunk;
            patchLast((m) => ({ ...m, content: m.content + chunk }));
          },
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
            patchLast((m) => ({ ...m, pending: false, promptTokens: done.streamStats?.PromptTokens, outputTokens: done.streamStats?.CompletionTokens }));
            const acts = extractChartActions(replyRef.current);
            if (acts.length) onChartActions?.(acts);
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
    [busy, activeModel, convId, symbol, name, onChartActions],
  );

  // 清空上下文：旧对话改名存档（还在首页对话列表里），这里重新开始；下一条消息开新对话
  const [cleared, setCleared] = useState(false);
  const clearContext = async () => {
    if (busy) return;
    if (convId && msgs.length) {
      try {
        await conversationsAPI.renameConversation(convId, archiveTitle(symbol, name));
      } catch {
        /* 改名失败也照样开新对话 */
      }
    }
    setConvId(null);
    setMsgs([]);
    lastIdRef.current = 0;
    setCleared(true);
  };
  useEffect(() => setCleared(false), [symbol]);
  const lastPrompt = [...msgs].reverse().find((m) => m.role === "assistant" && m.promptTokens)?.promptTokens ?? 0;

  const stop = () => {
    if (assistantIdRef.current) chatAPI.cancelStream(assistantIdRef.current).catch(() => {});
    abortRef.current?.abort();
  };

  const quick = [
    { k: "deep", q: `深度研究 ${symbol}：先列计划，再查行情、技术面、财务、公告，最后给结论、风险和关键价位，并在图上标出支撑和压力` },
    { k: "tech", q: `分析一下 ${symbol} 的技术面：趋势、均线、成交量、关键指标` },
    { k: "levels", q: `${symbol} 现在的支撑位和压力位大概在哪里？` },
    { k: "ann", q: `解读一下 ${symbol} 最近的公告，有哪些值得注意` },
    { k: "fin", q: `${symbol} 最近几期财报的要点：营收、利润、毛利率的变化` },
    { k: "peers", q: `${symbol} 和同行业主要公司比一比` },
  ];

  const applyCode = useCallback((code: string) => onChartActions?.(parseChartActions(code)), [onChartActions]);
  const describeCode = useCallback((code: string) => describeActions(parseChartActions(code)), []);

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
        <button
          type="button"
          onClick={clearContext}
          disabled={busy || (msgs.length === 0 && !convId)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          title={t("kline.chat.clear")}
          aria-label={t("kline.chat.clear")}
        >
          <EraserIcon className="size-4" />
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={t("kline.chat.close")}>
            <XIcon className="size-4" />
          </button>
        )}
      </div>
      <KlineInlineContext.Provider value={onKlineSpec}>
      <ChartActionContext.Provider value={onChartActions ? applyCode : null}>
      <ChartActionLabel.Provider value={describeCode}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-2 text-sm">
          {loading && <p className="text-xs text-muted-foreground">{t("kline.loading")}</p>}
          {!loading && msgs.length === 0 && (
            <p className="text-xs text-muted-foreground">{cleared ? t("kline.chat.cleared") : t("kline.chat.empty")}</p>
          )}
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
                {!m.pending && (m.promptTokens || m.outputTokens) ? (
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {t("kline.chat.tokens", { ctx: fmtTokens(m.promptTokens) || "-", out: fmtTokens(m.outputTokens) || "-" })}
                  </p>
                ) : null}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </ChartActionLabel.Provider>
      </ChartActionContext.Provider>
      </KlineInlineContext.Provider>
      {lastPrompt > LONG_CONTEXT_TOKENS && !busy && (
        <div className="flex shrink-0 items-center gap-2 border-t bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="flex-1">{t("kline.chat.longContext", { n: fmtTokens(lastPrompt) })}</span>
          <button type="button" onClick={clearContext} className="shrink-0 rounded border border-current px-1.5 py-0.5 hover:opacity-80">
            {t("kline.chat.clearShort")}
          </button>
        </div>
      )}
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

