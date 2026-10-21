import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { validateCareer, type Career } from "../content/schema";

describe("劇本格式驗證", () => {
  it.each(careers.map((c) => [c.id, c] as const))("%s 通過 schema 驗證", (_id, career) => {
    expect(validateCareer(career)).toEqual([]);
  });

  it("包含第一版三個職業", () => {
    expect(careers.map((c) => c.id).sort()).toEqual(["plumber", "swe", "teacher"]);
  });

  it("能抓到明顯正解與無代價選項", () => {
    const bad = structuredClone(careers[0]) as Career;
    bad.events[0].choices = [
      { label: "好", effects: { energy: 5 }, traits: {}, outcome: "好" },
      { label: "壞", effects: { energy: -5 }, traits: {}, outcome: "壞" },
    ];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("明顯正解"))).toBe(true);
    expect(errors.some((e) => e.includes("代價"))).toBe(true);
  });

  it("能抓到比例加總錯誤與未定義的前置旗標", () => {
    const bad = structuredClone(careers[0]) as Career;
    bad.actualAllocation.core += 1;
    bad.events[0].requires = ["nope"];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("加總"))).toBe(true);
    expect(errors.some((e) => e.includes("nope"))).toBe(true);
  });

  it("名詞必須出現在文字中、解釋不可為空或過長", () => {
    const bad = structuredClone(careers[2]) as Career;
    bad.glossary = [
      { term: "不存在的詞", meaning: "x" },
      { term: "報價", meaning: "" },
      { term: "學徒", meaning: "字".repeat(81) },
    ];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("不存在的詞") && e.includes("沒有出現"))).toBe(true);
    expect(errors.some((e) => e.includes("報價") && e.includes("meaning"))).toBe(true);
    expect(errors.some((e) => e.includes("學徒") && e.includes("meaning"))).toBe(true);
  });

  it("有 locations 的職業，每個事件都要有合法 location", () => {
    const plumber = careers.find((c) => c.id === "plumber")!;
    expect(plumber.locations?.length).toBeGreaterThan(0);
    const bad = structuredClone(plumber) as Career;
    bad.events[0].location = "mars";
    delete bad.events[1].location;
    const errors = validateCareer(bad);
    expect(errors.filter((e) => e.includes("location")).length).toBe(2);
  });

  it("三個職業都有名詞折疊", () => {
    for (const c of careers) expect(c.glossary?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
