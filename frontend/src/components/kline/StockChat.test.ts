import { describe, expect, it } from "vitest";
import { activePath, chatModels, convTitle, findStockConversation, pageContext } from "./StockChat";
import type { Message, Model } from "@/lib/api/types";

const m = (id: string, name: string): Model => ({ id, name, provider: "p", is_enabled: true });

describe("StockChat helpers", () => {
  it("只给 DeepSeek V4 Flash 和 Luna，DeepSeek 在前", () => {
    const got = chatModels([m("p/gpt-6-luna", "GPT-6 Luna"), m("p/deepseek-v4-pro", "DeepSeek V4 Pro"), m("p/deepseek-v4-flash", "DeepSeek V4 Flash"),
      m("p/gpt-5.6-luna", "gpt-5.6-luna"), m("p/claude", "Claude")]);
    expect(got.map((x) => x.id)).toEqual(["p/deepseek-v4-flash", "p/gpt-6-luna", "p/gpt-5.6-luna"]);
    expect(chatModels([m("x/deepseek-flash", "deepseek-flash"), m("y/DeepSeek_V4_Flash", ""), m("z/deepseek-chat", "DeepSeek Chat")]).map((x) => x.id))
      .toEqual(["x/deepseek-flash", "y/DeepSeek_V4_Flash"]);
  });
  it("按股票找对话：标题「📈 代码」或「📈 代码 名称」，不会把 600519 当成 6005", () => {
    expect(convTitle("600519.SH", "贵州茅台")).toBe("📈 600519.SH 贵州茅台");
    const convs = [{ id: "a", title: "📈 600519.SHX" }, { id: "b", title: "📈 600519.SH 贵州茅台" }, { id: "c", title: "📈 AAPL" }];
    expect(findStockConversation(convs, "600519.SH")?.id).toBe("b");
    expect(findStockConversation(convs, "AAPL")?.id).toBe("c");
    expect(findStockConversation(convs, "0700.HK")).toBeUndefined();
  });
  it("当前分支：从根沿最后一个孩子走", () => {
    const msg = (id: number, role: string, parentId: number | undefined, children: number[]): Message =>
      ({ id, convId: "x", role, content: String(id), status: "completed", parentId, children }) as Message;
    const all: Record<number, Message> = {
      1: msg(1, "user", 0, [2, 4]), 2: msg(2, "assistant", 1, [3]), 3: msg(3, "user", 2, []),
      4: msg(4, "assistant", 1, [5]), 5: msg(5, "user", 4, [6]), 6: msg(6, "assistant", 5, []),
    };
    expect(activePath(all).map((x) => x.id)).toEqual([1, 4, 5, 6]);
    expect(activePath({})).toEqual([]);
  });
  it("背景里有代码、名称，并说明不要画 K 线", () => {
    const c = pageContext("0700.HK", "腾讯控股");
    expect(c).toContain("0700.HK（腾讯控股）");
    expect(c).toContain("不要输出 ```kline");
  });
});

describe("pageContext 长度", () => {
  it("后端最多收 2000 字", () => {
    const c = pageContext("600519.SH", "贵州茅台");
    expect([...c].length).toBeLessThan(2000);
    expect(c).toContain("```chart");
    expect(c).toContain("finance_company");
    expect(c).toContain("web_search");
  });
});
