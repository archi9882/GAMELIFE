import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { hasScene, sceneCast } from "../src/scene";

describe("場景角色清單（首頁「今天會遇到的人」）", () => {
  it("每個有場景的職業都有角色，名牌非空、顏色是 #rrggbb", () => {
    for (const c of careers.filter((c) => hasScene(c.id))) {
      const cast = sceneCast[c.id];
      expect(cast.length).toBeGreaterThan(0);
      for (const m of cast) {
        expect(m.label.trim()).not.toBe("");
        expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
