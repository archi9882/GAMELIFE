import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import type { Career } from "../content/schema";
import { mergeSeen, progress, type Codex } from "../src/engine/codex";

const swe = careers.find((c) => c.id === "swe")!;
/** 合成的第二個職業：只用來測「各職業分開記錄」（v0.14 起登錄表只有軟體工程師） */
const other = { ...structuredClone(swe), id: "other", glossary: [{ term: "甲", meaning: "x" }, { term: "乙", meaning: "y" }] } as Career;

describe("圖鑑", () => {
  it("加入新名詞、忽略重複與不在詞庫的詞", () => {
    let codex: Codex = {};
    codex = mergeSeen(codex, swe, ["站會", "CI", "站會", "不存在的詞", "師傅"]);
    expect(codex.swe).toEqual(["站會", "CI"]);
  });

  it("沒有新名詞時回傳同一個物件（不觸發儲存）", () => {
    const codex = mergeSeen({}, swe, ["站會"]);
    expect(mergeSeen(codex, swe, ["站會"])).toBe(codex);
  });

  it("各職業分開記錄", () => {
    let codex: Codex = {};
    codex = mergeSeen(codex, other, ["甲"]);
    codex = mergeSeen(codex, swe, ["站會", "CI"]);
    const p = progress(codex, [swe, other]);
    expect(p.byCareer.other.collected).toBe(1);
    expect(p.byCareer.swe.collected).toBe(2);
    expect(p.all.collected).toBe(3);
    expect(p.all.total).toBe((swe.glossary?.length ?? 0) + 2);
  });

  it("壞掉的存檔（含已移除的名詞）不會讓進度超過總數", () => {
    const p = progress({ swe: ["站會", "已被刪掉的詞"] }, careers);
    expect(p.byCareer.swe.collected).toBe(1);
  });

  it("已刪除職業的舊紀錄（v0.13 高中老師、v0.14 水電工）不計入進度，也不會出錯", () => {
    const p = progress({ teacher: ["導師", "段考"], plumber: ["師傅", "報價"], swe: ["站會"] }, careers);
    expect(Object.keys(p.byCareer)).toEqual(["swe"]);
    expect(p.all.collected).toBe(1);
    expect(p.all.total).toBe(swe.glossary?.length ?? 0);
    // 收集新名詞時，舊職業的紀錄原樣保留（不主動刪除玩家資料）
    expect(mergeSeen({ teacher: ["導師"], plumber: ["師傅"] }, swe, ["CI"])).toEqual({ teacher: ["導師"], plumber: ["師傅"], swe: ["CI"] });
  });
});
