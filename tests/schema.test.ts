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
});
