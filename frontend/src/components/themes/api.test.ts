import { describe, expect, it } from "vitest";
import { fetchThemes, rankMove, streak } from "./api";

describe("themes api", () => {
  it("fetches latest and by date", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ status: "success", date: "2026-11-16", industries: [] }));
    }) as unknown as typeof fetch;
    expect((await fetchThemes(undefined, f)).date).toBe("2026-11-16");
    await fetchThemes("2026-11-13", f);
    expect(urls).toEqual(["/api/tools/finance/themes", "/api/tools/finance/themes?date=2026-11-13"]);
  });
  it("throws platform error", async () => {
    const f = (async () => new Response(JSON.stringify({ status: "error", error: "还没有数据" }), { status: 404 })) as unknown as typeof fetch;
    await expect(fetchThemes(undefined, f)).rejects.toThrow("还没有数据");
  });
  it("rank move and streak", () => {
    expect(rankMove({ rank: 2, rank_5d_ago: 8 })).toBe(6);
    expect(rankMove({ rank: 2, rank_5d_ago: null })).toBeNull();
    const h = [
      { date: "d3", top: [{ industry: "半导体", score: 90 }] },
      { date: "d2", top: [{ industry: "白酒", score: 80 }] },
      { date: "d1", top: [{ industry: "半导体", score: 70 }] },
    ];
    expect(streak(h, "半导体")).toEqual([true, false, true]);
  });
});
