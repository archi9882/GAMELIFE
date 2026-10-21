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
  it("單句與空字串回傳單頁", () => {
    expect(splitPages("只有一句。")).toEqual(["只有一句。"]);
    expect(splitPages("")).toEqual([""]);
  });
  it("拆頁後重組等於原文", () => {
    for (const c of careers) for (const e of c.events) expect(splitPages(e.body).join("")).toBe(e.body);
  });
});
