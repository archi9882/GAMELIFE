import { describe, expect, it } from "vitest";
import { careers, getCareer } from "../content/index";
import { newGame } from "../src/engine/game";
import { parseSave } from "../src/ui/storage";

const known = (id: string): boolean => !!getCareer(id);

describe("存檔解析", () => {
  it("目前職業的存檔原樣讀回", () => {
    for (const c of careers) {
      const s = newGame(c);
      expect(parseSave(JSON.stringify(s), known)).toEqual(s);
    }
  });

  it.each([
    ["teacher", "v0.13 刪除的高中老師"],
    ["plumber", "v0.14 刪除的水電工"],
  ])("已刪除的職業（%s：%s）視為沒有存檔", (careerId) => {
    const old = { ...newGame(careers[0]), careerId };
    expect(parseSave(JSON.stringify(old), known)).toBeNull();
  });

  it("空值、壞掉的 JSON、缺欄位都視為沒有存檔", () => {
    expect(parseSave(null, known)).toBeNull();
    expect(parseSave("", known)).toBeNull();
    expect(parseSave("{not json", known)).toBeNull();
    expect(parseSave("null", known)).toBeNull();
    expect(parseSave("42", known)).toBeNull();
    expect(parseSave(JSON.stringify({ careerId: "swe" }), known)).toBeNull();
    const { inspected: _drop, ...noInspected } = newGame(careers[0]);
    expect(parseSave(JSON.stringify(noInspected), known)).toBeNull();
  });
});
