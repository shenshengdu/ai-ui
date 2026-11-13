/** K 线页「大盘 / 全球市场」面板：分组常用指数、期货、汇率、利率。
 * A 股、港股指数走阿里云本地库；美股指数先本地库；其余（全球指数、期货、汇率、利率）平台直接走雅虎。 */
export type MarketItem = { symbol: string; name: string };
export type MarketGroup = { key: string; items: MarketItem[] };

export const MARKET_GROUPS: MarketGroup[] = [
  {
    key: "a",
    items: [
      { symbol: "000001.SH", name: "上证指数" },
      { symbol: "399001.SZ", name: "深证成指" },
      { symbol: "399006.SZ", name: "创业板指" },
      { symbol: "000300.SH", name: "沪深300" },
      { symbol: "000905.SH", name: "中证500" },
      { symbol: "000852.SH", name: "中证1000" },
      { symbol: "000016.SH", name: "上证50" },
      { symbol: "000688.SH", name: "科创50" },
    ],
  },
  {
    key: "hk",
    items: [
      { symbol: "HSI.HK", name: "恒生指数" },
      { symbol: "HSCEI.HK", name: "国企指数" },
      { symbol: "HSTECH.HK", name: "恒生科技" },
    ],
  },
  {
    key: "us",
    items: [
      { symbol: "^GSPC", name: "标普 500" },
      { symbol: "^IXIC", name: "纳斯达克" },
      { symbol: "^NDX", name: "纳斯达克 100" },
      { symbol: "^DJI", name: "道琼斯" },
      { symbol: "^RUT", name: "罗素 2000" },
      { symbol: "^VIX", name: "VIX 恐慌指数" },
    ],
  },
  {
    key: "asia",
    items: [
      { symbol: "^N225", name: "日经 225" },
      { symbol: "^KS11", name: "韩国 KOSPI" },
      { symbol: "^TWII", name: "台湾加权" },
      { symbol: "^NSEI", name: "印度 NIFTY 50" },
    ],
  },
  {
    key: "europe",
    items: [
      { symbol: "^GDAXI", name: "德国 DAX" },
      { symbol: "^FTSE", name: "英国 FTSE 100" },
      { symbol: "^FCHI", name: "法国 CAC 40" },
    ],
  },
  {
    key: "commodities",
    items: [
      { symbol: "GC=F", name: "黄金" },
      { symbol: "CL=F", name: "WTI 原油" },
      { symbol: "BZ=F", name: "布伦特原油" },
      { symbol: "HG=F", name: "铜" },
    ],
  },
  {
    key: "fx",
    items: [
      { symbol: "CNY=X", name: "美元/人民币" },          // 雅虎的 CNH=X（离岸）只给最近 5 天，没有历史日线
      { symbol: "JPY=X", name: "美元/日元" },
      { symbol: "EURUSD=X", name: "欧元/美元" },
    ],
  },
  {
    key: "rates",
    items: [
      { symbol: "^TNX", name: "美债 10 年收益率" },
      { symbol: "^FVX", name: "美债 5 年收益率" },
      { symbol: "^IRX", name: "美债 13 周收益率" },
    ],
  },
];

export const MARKET_NAME: Record<string, string> = Object.fromEntries(
  MARKET_GROUPS.flatMap((g) => g.items.map((i) => [i.symbol, i.name])),
);

export const ALL_MARKET_SYMBOLS: string[] = MARKET_GROUPS.flatMap((g) => g.items.map((i) => i.symbol));

export type MarketQuote = { symbol: string; price: number; change?: number | null; change_percent?: number | null; time?: string | null };

/** 价格显示：收益率、汇率、小于 100 的多给几位 */
export function fmtQuotePrice(symbol: string, p: number): string {
  if (symbol.startsWith("^") && /^\^(TNX|FVX|IRX|TYX)$/.test(symbol)) return `${p.toFixed(3)}%`;
  if (symbol.endsWith("=X")) return p.toFixed(4);
  return p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : p.toFixed(2);
}

export function fmtQuotePct(pct?: number | null): string {
  return pct == null || !Number.isFinite(pct) ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
