import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { splitPages } from "../src/engine/text";

describe("splitPages", () => {
  it("依句號拆頁，標點留在句尾", () => {
    expect(splitPages("第一句。第二句！第三句？")).toEqual(["第一句。", "第二句！", "第三句？"]);
  });
  it("最後一句沒有標點也會保留", () => {
    expect(splitPages("第一句。尾巴")).toEqual(["第一句。", "尾巴"]);
  });
  it("右引號、右括號跟著前一句", () => {
    expect(splitPages("PM 說：「今天上線。」你點頭。")).toEqual(["PM 說：「今天上線。」", "你點頭。"]);
    expect(splitPages("他問：「真的嗎？」）好。")).toEqual(["他問：「真的嗎？」）", "好。"]);
  });
  it("沒有任何一頁只剩標點", () => {
    for (const c of careers) for (const e of c.events) for (const p of splitPages(e.body)) expect(p).not.toMatch(/^[」』）。！？\s]*$/);
  });
  it("單句與空字串回傳單頁", () => {
    expect(splitPages("只有一句。")).toEqual(["只有一句。"]);
    expect(splitPages("")).toEqual([""]);
  });
  it("拆頁後重組等於原文", () => {
    for (const c of careers) for (const e of c.events) expect(splitPages(e.body).join("")).toBe(e.body);
  });
});
