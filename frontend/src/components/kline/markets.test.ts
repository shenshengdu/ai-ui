import { describe, expect, it } from "vitest";
import { ALL_MARKET_SYMBOLS, fmtQuotePct, fmtQuotePrice } from "./markets";

describe("行情看板格式", () => {
  it("价格、涨跌", () => {
    expect(fmtQuotePrice("000001.SH", 3410.5)).toBe("3,410.50");
    expect(fmtQuotePrice("^TNX", 4.215)).toBe("4.215%");
    expect(fmtQuotePrice("CNY=X", 7.1234)).toBe("7.1234");
    expect(fmtQuotePrice("GC=F", 2012.4)).toBe("2,012.40");
    expect(fmtQuotePrice("^VIX", 15.2)).toBe("15.20");
    expect(fmtQuotePct(1.234)).toBe("+1.23%");
    expect(fmtQuotePct(-0.5)).toBe("-0.50%");
    expect(fmtQuotePct(null)).toBe("");
    expect(ALL_MARKET_SYMBOLS.length).toBeLessThanOrEqual(40);
  });
});
