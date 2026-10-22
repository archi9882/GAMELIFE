import { describe, expect, it } from "vitest";
import { buildGrid, findPath, isFree, slide, type Grid, type Pt, type Rect } from "../src/scene/nav";
import { SWE_NAV, SWE_PLACE_POS } from "../src/scene/swe";
import { TEACHER_NAV, TEACHER_PLACE_POS } from "../src/scene/teacher";

const room: Rect[] = [{ x0: 0, z0: 0, x1: 10, z1: 6 }];
const wall: Rect[] = [{ x0: 4.5, z0: 0, x1: 5.5, z1: 4 }]; // 牆從上緣伸到 z=4，下方留缺口

const pathLength = (from: Pt, pts: Pt[]): number => {
  let len = 0;
  let prev = from;
  for (const p of pts) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return len;
};

/** 沿折線每 0.05 取樣，確認都在可站立格子內 */
const staysFree = (g: Grid, from: Pt, pts: Pt[]): boolean => {
  let prev = from;
  for (const p of pts) {
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.05));
    for (let i = 1; i <= n; i++) if (!isFree(g, prev.x + ((p.x - prev.x) * i) / n, prev.z + ((p.z - prev.z) * i) / n)) return false;
    prev = p;
  }
  return true;
};

describe("buildGrid", () => {
  it("格子中心離障礙至少一個半徑，障礙內與可走區外都不可站", () => {
    const g = buildGrid(room, wall);
    expect(isFree(g, 2, 2)).toBe(true);
    expect(isFree(g, 5, 2)).toBe(false); // 牆內
    expect(isFree(g, 4.25, 2)).toBe(false); // 離牆 0.25 < 0.3
    expect(isFree(g, 3.75, 2)).toBe(true);
    expect(isFree(g, -1, 2)).toBe(false);
    expect(isFree(g, 5, 5)).toBe(true); // 缺口
  });
});

describe("findPath", () => {
  const g = buildGrid(room, wall);
  it("繞過障礙，路徑每一步都在可站立格子內", () => {
    const from = { x: 2, z: 1 };
    const to = { x: 8, z: 1 };
    const path = findPath(g, from, to);
    expect(path.length).toBeGreaterThan(1);
    expect(path.some((p) => p.z >= 4.3)).toBe(true); // 經過缺口
    expect(staysFree(g, from, path)).toBe(true);
    expect(path[path.length - 1]).toEqual(to);
    expect(pathLength(from, path)).toBeGreaterThan(6);
  });
  it("沒有阻擋時直線走過去", () => {
    expect(findPath(g, { x: 1, z: 5 }, { x: 9, z: 5 })).toEqual([{ x: 9, z: 5 }]);
  });
  it("終點在障礙內：走到最近的可站立位置", () => {
    const path = findPath(g, { x: 2, z: 1 }, { x: 5, z: 1 });
    const end = path[path.length - 1];
    expect(isFree(g, end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - 5, end.z - 1)).toBeLessThan(1.6);
  });
  it("終點不可達：走到可達範圍內離終點最近的點", () => {
    const sealed = buildGrid([...room, { x0: 12, z0: 0, x1: 14, z1: 3 }], []); // 右邊另有一塊不相連的地板
    const path = findPath(sealed, { x: 2, z: 2 }, { x: 13, z: 1 });
    const end = path[path.length - 1];
    expect(isFree(sealed, end.x, end.z)).toBe(true);
    expect(end.x).toBeGreaterThan(9); // 停在房間右緣
    expect(end.x).toBeLessThan(10);
  });
  it("起點與終點相同格子", () => {
    expect(findPath(g, { x: 2.1, z: 2.1 }, { x: 2.3, z: 2.2 })).toEqual([{ x: 2.3, z: 2.2 }]);
  });
});

describe("slide", () => {
  const g = buildGrid(room, wall);
  it("自由空間照走", () => {
    expect(slide(g, { x: 2, z: 2 }, 0.1, 0.1)).toEqual({ x: 2.1, z: 2.1 });
  });
  it("碰到牆停下（正面）", () => {
    const p = slide(g, { x: 3.8, z: 2 }, 0.3, 0);
    expect(p).toEqual({ x: 3.8, z: 2 });
  });
  it("斜著撞牆沿牆滑動", () => {
    const p = slide(g, { x: 3.8, z: 2 }, 0.3, 0.3);
    expect(p.x).toBe(3.8);
    expect(p.z).toBeCloseTo(2.3);
    expect(isFree(g, p.x, p.z)).toBe(true);
  });
  it("連續推擠永遠不進入不可站立的格子", () => {
    let p = { x: 2, z: 2 };
    for (let i = 0; i < 300; i++) {
      p = slide(g, p, 0.07, 0.03 * Math.sin(i / 7));
      expect(isFree(g, p.x, p.z)).toBe(true);
    }
  });
  it("四面都是牆就留在原地", () => {
    const closed = buildGrid([{ x0: 0, z0: 0, x1: 0.5, z1: 0.5 }], []);
    expect(slide(closed, { x: 0.25, z: 0.25 }, 1, 1)).toEqual({ x: 0.25, z: 0.25 });
  });
});

describe.each([
  ["teacher", TEACHER_NAV, TEACHER_PLACE_POS],
  ["swe", SWE_NAV, SWE_PLACE_POS],
])("%s 場景導航資料", (_name, nav, places) => {
  const g = buildGrid(nav.walkable, nav.blocked);
  const ids = Object.keys(places);
  it("每個地點都站得上去", () => {
    for (const id of ids) expect(isFree(g, places[id].x, places[id].z), id).toBe(true);
  });
  it("任兩個地點之間走得通，而且路徑全程可站立、終點就是地點", () => {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const path = findPath(g, places[a], places[b]);
        expect(path.length, `${a}->${b}`).toBeGreaterThan(0);
        expect(path[path.length - 1], `${a}->${b}`).toEqual(places[b]);
        expect(staysFree(g, places[a], path), `${a}->${b}`).toBe(true);
      }
    }
  });
});
