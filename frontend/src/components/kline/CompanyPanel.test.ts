import { describe, expect, it } from "vitest";
import { fmtMoney, fmtPct, hasCompanyData, safeUrl } from "./CompanyPanel";

describe("CompanyPanel helpers", () => {
  it("只有个股有公告和财报", () => {
    for (const s of ["600519.SH", "000001.SZ", "00700.HK", "AAPL", "BRK.B"]) expect(hasCompanyData(s)).toBe(true);
    for (const s of ["000300.SH", "000001.SH", "399006.SZ", "HSI.HK", "HSTECH.HK", "^GSPC", "GC=F", "CNH=X"]) expect(hasCompanyData(s)).toBe(false);
  });
  it("链接只放行 http(s)", () => {
    expect(safeUrl("http://static.cninfo.com.cn/finalpage/2026-10-30/1.PDF")).toContain("cninfo");
    expect(safeUrl("https://www1.hkexnews.hk/listedco/x.pdf")).toContain("hkexnews");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
  it("金额和百分比", () => {
    expect(fmtMoney(1.2345e11, true)).toBe("1234.50亿");
    expect(fmtMoney(5e5, true)).toBe("50.00万");
    expect(fmtMoney(1.02e11, false)).toBe("102.00B");
    expect(fmtMoney(null, true)).toBe("—");
    expect(fmtPct(12.345)).toBe("+12.35%");
    expect(fmtPct(-3)).toBe("-3.00%");
    expect(fmtPct(undefined)).toBe("—");
  });
});
