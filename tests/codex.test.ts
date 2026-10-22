import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { mergeSeen, progress, type Codex } from "../src/engine/codex";

const teacher = careers.find((c) => c.id === "teacher")!;
const swe = careers.find((c) => c.id === "swe")!;

describe("圖鑑", () => {
  it("加入新名詞、忽略重複與不在詞庫的詞", () => {
    let codex: Codex = {};
    codex = mergeSeen(codex, teacher, ["導師", "段考", "導師", "不存在的詞", "回滾"]);
    expect(codex.teacher).toEqual(["導師", "段考"]);
  });

  it("沒有新名詞時回傳同一個物件（不觸發儲存）", () => {
    const codex = mergeSeen({}, teacher, ["導師"]);
    expect(mergeSeen(codex, teacher, ["導師"])).toBe(codex);
  });

  it("各職業分開記錄", () => {
    let codex: Codex = {};
    codex = mergeSeen(codex, teacher, ["導師"]);
    codex = mergeSeen(codex, swe, ["站會", "CI"]);
    const p = progress(codex, careers);
    expect(p.byCareer.teacher.collected).toBe(1);
    expect(p.byCareer.swe.collected).toBe(2);
    expect(p.all.collected).toBe(3);
    expect(p.all.total).toBe(careers.reduce((a, c) => a + (c.glossary?.length ?? 0), 0));
  });

  it("壞掉的存檔（含已移除的名詞）不會讓進度超過總數", () => {
    const p = progress({ teacher: ["導師", "已被刪掉的詞"] }, careers);
    expect(p.byCareer.teacher.collected).toBe(1);
  });
});
