import { describe, expect, it, vi } from "vitest";
import { fmtMoney, fmtPct, hasCompanyData, loadCompany, periodLabel, recentYears, safeUrl } from "./CompanyPanel";

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
  it("报告期类型", () => {
    expect(periodLabel("三季报", true)).toBe("三季报");
    expect(periodLabel("三季报", false)).toBe("Q3 (9M)");
    expect(periodLabel("Q2 季报", false)).toBe("Q2 (fiscal)");
    expect(periodLabel(null, true)).toBe("—");
  });
  it("只留最近 5 年", () => {
    const rows = ["2026-09-30", "2022-03-31", "2021-12-31", "2021-09-30", "2020-12-31"].map((report_date) => ({ report_date }));
    expect(recentYears(rows, 5, new Date(2026, 10, 13)).map((r) => r.report_date)).toEqual(["2026-09-30", "2022-03-31", "2021-12-31"]);
  });
});

describe("loadCompany", () => {
  const ok = (body: object) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  it("同一请求只发一次，之后用缓存", async () => {
    const f = vi.fn(() => ok({ status: "success", rows: [{ report_date: "2026-09-30" }] }));
    const [a, b] = await Promise.all([loadCompany("C1.SH", "financials", f as unknown as typeof fetch),
      loadCompany("C1.SH", "financials", f as unknown as typeof fetch)]);
    await loadCompany("C1.SH", "financials", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.rows).toEqual(b.rows);
  });
  it("后台还在补公告的不缓存，下次重新取", async () => {
    const f = vi.fn(() => ok({ status: "success", backfilling: true, announcements: [] }));
    const d = await loadCompany("C2.SH", "announcements", f as unknown as typeof fetch);
    await loadCompany("C2.SH", "announcements", f as unknown as typeof fetch);
    expect(d.backfilling).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
