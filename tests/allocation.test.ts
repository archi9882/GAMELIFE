import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { CATEGORIES, type Category } from "../content/schema";

/** Meyer et al. (IEEE TSE 2021) Table 2，全部工作日欄（%）；休息不在遊戲五類內 */
const MEYER_TABLE2 = {
  coding: 15, bugfixing: 14, testing: 8, specification: 4, reviewing: 5, documentation: 2,
  meetings: 15, email: 10, interruptions: 4, helping: 5, networking: 2,
  learning: 3, administrative: 2, breaks: 8, various: 3,
};

/** 最大餘數法換算成加總 100 的整數 */
function largestRemainder(values: Record<Category, number>): Record<Category, number> {
  const total = CATEGORIES.reduce((a, c) => a + values[c], 0);
  const raw = CATEGORIES.map((c) => (values[c] / total) * 100);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  [...raw.keys()].sort((i, j) => raw[j] - Math.floor(raw[j]) - (raw[i] - Math.floor(raw[i]))).slice(0, rest).forEach((i) => out[i]++);
  return Object.fromEntries(CATEGORIES.map((c, i) => [c, out[i]])) as Record<Category, number>;
}

describe("時間比例的可追溯性", () => {
  it("原表加總為 100", () => {
    expect(Object.values(MEYER_TABLE2).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("軟體工程師的比例等於 Meyer Table 2 依文件所述方式換算的結果", () => {
    const t = MEYER_TABLE2;
    const grouped: Record<Category, number> = {
      core: t.coding + t.bugfixing + t.testing + t.specification + t.reviewing,
      communicate: t.meetings + t.email + t.interruptions + t.helping + t.networking,
      admin: t.administrative + t.documentation,
      wait: t.various,
      learn: t.learning,
    };
    const swe = careers.find((c) => c.id === "swe")!;
    expect(swe.actualAllocation).toEqual(largestRemainder(grouped));
  });

  it("尚未查到公開數字的職業，來源必須標示為 fiction（推估）", () => {
    for (const id of ["teacher", "plumber"]) {
      const c = careers.find((x) => x.id === id)!;
      expect(c.allocationSources.some((src) => src.type === "fiction")).toBe(true);
    }
  });

  it("軟體工程師的來源是公開報告，不含 fiction", () => {
    const swe = careers.find((c) => c.id === "swe")!;
    expect(swe.allocationSources.every((src) => src.type === "public_report")).toBe(true);
  });
});
