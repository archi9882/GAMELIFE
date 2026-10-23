import { describe, expect, it } from "vitest";
import {
  aimAt,
  clampPitch,
  decay,
  dragLook,
  easeInOut,
  fitTaskRect,
  fpFov,
  lerpPose,
  PITCH_MAX,
  PITCH_MIN,
  screenCorners,
  screenDistance,
  screenPose,
  segmentBlocked,
  viewFor,
  visibleTanV,
  wrapAngle,
  type Aabb,
  type FpView,
} from "../src/scene/fp";
import { SWE_FP_VIEWS, SWE_NAV, SWE_PLACE_IDS, SWE_SCREENS, SWE_TASK_SCREENS } from "../src/scene/swe";
import { getCareer } from "../content/index";

/** 與 three.js 相同的前方向量：yaw=0 朝 -z */
const forward = (yaw: number, pitch: number) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

describe("aimAt", () => {
  it("faces -z with yaw 0 and turns left (+yaw) toward -x", () => {
    expect(aimAt([0, 1.6, 0], [0, 1.6, -5]).yaw).toBeCloseTo(0);
    expect(aimAt([0, 1.6, 0], [-5, 1.6, 0]).yaw).toBeCloseTo(Math.PI / 2);
    expect(aimAt([0, 1.6, 0], [5, 1.6, 0]).yaw).toBeCloseTo(-Math.PI / 2);
  });
  it("forward vector points at the target", () => {
    const pos = [1, 1.6, 2] as const;
    const look = [4, 1.2, -1] as const;
    const { yaw, pitch } = aimAt(pos, look);
    const f = forward(yaw, pitch);
    const d = [look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]];
    const len = Math.hypot(...d);
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo(d[i] / len, 5);
  });
  it("clamps steep pitch", () => {
    expect(aimAt([0, 1.6, 0], [0, 10, -0.1]).pitch).toBe(PITCH_MAX);
    expect(aimAt([0, 1.6, 0], [0, -10, -0.1]).pitch).toBe(PITCH_MIN);
  });
});

describe("look controls", () => {
  it("clampPitch keeps a small range", () => {
    expect(clampPitch(1)).toBe(PITCH_MAX);
    expect(clampPitch(-1)).toBe(PITCH_MIN);
    expect(clampPitch(0.1)).toBe(0.1);
  });
  it("dragLook turns with horizontal drag and clamps vertical drag", () => {
    const r = dragLook(0, 0, 100, 0, 0.005);
    expect(r.yaw).toBeCloseTo(0.5);
    expect(r.pitch).toBe(0);
    expect(dragLook(0, 0, 0, 10000).pitch).toBe(PITCH_MAX);
    expect(dragLook(0, 0, 0, -10000).pitch).toBe(PITCH_MIN);
  });
  it("wrapAngle stays within (-π, π]", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
    expect(dragLook(3, 0, 1000, 0).yaw).toBeLessThanOrEqual(Math.PI);
  });
  it("decay slows down and stops", () => {
    expect(Math.abs(decay(2, 0.1))).toBeLessThan(2);
    expect(decay(0.0005, 0.016)).toBe(0);
  });
});

describe("fpFov", () => {
  it("landscape without insets uses the base fov", () => {
    expect(fpFov(1280, 720, 0, 0, 64)).toBeCloseTo(64);
  });
  it("portrait keeps the horizontal fov of the visible area", () => {
    const w = 390, h = 844, bottom = 388;
    const fov = fpFov(w, h, 0, bottom, 64);
    const vh = h - bottom;
    // 可見範圍的水平視野 = 64°
    const tanV = Math.tan(((fov / 2) * Math.PI) / 180) * (vh / h);
    const hfov = (2 * Math.atan((tanV * w) / vh) * 180) / Math.PI;
    expect(hfov).toBeCloseTo(64, 3);
    expect(fov).toBeGreaterThan(64);
  });
  it("desktop left panel: visible area roughly square keeps base vertical fov", () => {
    expect(fpFov(1280, 720, 552, 0, 64)).toBeCloseTo(64);
  });
  it("degenerate size falls back", () => {
    expect(fpFov(0, 0)).toBe(64);
  });
});

describe("viewFor", () => {
  const views: Record<string, FpView> = { a: { pos: [0, 1.6, 0], look: [0, 1.6, -1], faces: { e1: [1, 1.7, -1] } } };
  it("returns the location view, or the event's face target", () => {
    expect(viewFor(views, "a")?.look).toEqual([0, 1.6, -1]);
    expect(viewFor(views, "a", "e1")?.look).toEqual([1, 1.7, -1]);
    expect(viewFor(views, "a", "other")?.look).toEqual([0, 1.6, -1]);
    expect(viewFor(views, "missing")).toBeNull();
    expect(viewFor(views, undefined)).toBeNull();
  });
});

describe("SWE first-person views", () => {
  const career = getCareer("swe")!;
  const inside = (x: number, z: number) => SWE_NAV.walkable.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  it("every scene place has a view, at eye height, inside the office", () => {
    for (const id of SWE_PLACE_IDS) {
      const v = SWE_FP_VIEWS[id];
      expect(v, id).toBeDefined();
      expect(v.pos[1]).toBeCloseTo(1.6);
      expect(inside(v.pos[0], v.pos[2]), id).toBe(true);
    }
  });
  it("face overrides refer to real events at that location", () => {
    for (const [loc, v] of Object.entries(SWE_FP_VIEWS)) {
      for (const ev of Object.keys(v.faces ?? {})) {
        expect(career.events.find((e) => e.id === ev)?.location, `${loc}/${ev}`).toBe(loc);
      }
    }
  });
  it("default and face targets are within the allowed pitch (not clamped)", () => {
    for (const v of Object.values(SWE_FP_VIEWS)) {
      for (const look of [v.look, ...Object.values(v.faces ?? {})]) {
        const dy = look[1] - v.pos[1];
        const raw = Math.atan2(dy, Math.hypot(look[0] - v.pos[0], look[2] - v.pos[2]));
        expect(raw).toBeGreaterThan(PITCH_MIN);
        expect(raw).toBeLessThan(PITCH_MAX);
      }
    }
  });
});

describe("v0.12 畫面內任務：推近螢幕", () => {
  const monitor = SWE_SCREENS.monitor;
  it("fpFov: top inset (HUD) counts toward the covered height", () => {
    expect(fpFov(390, 844, 0, 300, 64, 100)).toBeCloseTo(fpFov(390, 844, 0, 400, 64), 6);
  });
  it("screenDistance: screen height fills the visible height (portrait may crop sides)", () => {
    const vw = 390, vh = 420;
    const d = screenDistance(monitor, vw, vh, 0.88);
    const tv = visibleTanV(vw, vh);
    expect(monitor.h / 2 / d).toBeCloseTo(tv * 0.88, 6);
  });
  it("screenDistance: landscape keeps the whole screen inside the visible width", () => {
    const vw = 600, vh = 500;
    const wide = { w: 3, h: 0.5 };
    const d = screenDistance(wide, vw, vh);
    const th = (visibleTanV(vw, vh) * vw) / vh;
    expect(wide.w / 2 / d).toBeLessThanOrEqual(th + 1e-9);
  });
  it("screenPose: stands in front of the screen and faces it level", () => {
    const p = screenPose(monitor, 0.5);
    expect(p.pos[2]).toBeCloseTo(monitor.center[2] + 0.5);
    expect(p.yaw).toBeCloseTo(0);
    expect(p.pitch).toBeCloseTo(0);
    const tv = screenPose(SWE_SCREENS.tv, 1);
    expect(Math.abs(tv.yaw)).toBeCloseTo(Math.PI); // 電視朝 -z，鏡頭轉身看它
  });
  it("screenCorners: four corners span w × h around the centre", () => {
    const c = screenCorners(monitor);
    const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(monitor.w);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(monitor.h);
    expect(c.every((q) => q[2] === monitor.center[2])).toBe(true);
  });
  it("lerpPose eases and takes the short way round", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    const mid = lerpPose({ pos: [0, 0, 0], yaw: 3, pitch: 0 }, { pos: [2, 0, 0], yaw: -3, pitch: 0.2 }, 0.5);
    expect(mid.pos[0]).toBeCloseTo(1);
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3); // 經過 ±π，不是繞回 0
    expect(mid.pitch).toBeCloseTo(0.1);
  });
  it("fitTaskRect: overlay = projected screen ∩ visible region (inset), else centred fallback", () => {
    const visible = { x: 0, y: 100, w: 390, h: 400 };
    const a = fitTaskRect({ x: -150, y: 120, w: 700, h: 360 }, visible, { margin: 8, inset: 6 });
    expect(a.fit).toBe("screen");
    expect(a.rect).toEqual({ x: 8, y: 126, w: 374, h: 348 });
    const off = fitTaskRect({ x: 900, y: 120, w: 100, h: 100 }, visible);
    expect(off.fit).toBe("fallback");
    expect(off.rect.x + off.rect.w / 2).toBeCloseTo(195);
    expect(off.rect.y + off.rect.h / 2).toBeCloseTo(300);
    expect(fitTaskRect(null, visible).fit).toBe("fallback");
  });
  it("SWE: task screens point at real screens, events and locations", () => {
    const career = getCareer("swe")!;
    for (const id of [...Object.values(SWE_TASK_SCREENS.investigate), ...Object.values(SWE_TASK_SCREENS.events)]) expect(SWE_SCREENS[id], id).toBeDefined();
    for (const loc of Object.keys(SWE_TASK_SCREENS.investigate)) expect(SWE_PLACE_IDS).toContain(loc);
    for (const [ev, scr] of Object.entries(SWE_TASK_SCREENS.events)) {
      const e = career.events.find((x) => x.id === ev);
      expect(e, ev).toBeDefined();
      // 事件所在地點的預設視線就是對著這個螢幕（技術分享會在會議室，看大螢幕）
      const v = SWE_FP_VIEWS[e!.location!];
      const sc = SWE_SCREENS[scr];
      expect(Math.hypot(v.look[0] - sc.center[0], v.look[2] - sc.center[2])).toBeLessThan(0.2);
    }
    // 所有在座位、有小遊戲或查資料的事件都會推近電腦螢幕
    const deskTasks = career.events.filter((e) => e.investigate && e.location === "desk").map((e) => e.id);
    expect(deskTasks.sort()).toEqual(["s-alert", "s-deepwork", "s-review", "s-unittest"]);
    expect(career.events.filter((e) => e.investigate && !(e.location! in SWE_TASK_SCREENS.investigate))).toEqual([]);
  });
});

describe("v0.12 名牌遮擋（segmentBlocked）", () => {
  // SWE 辦公室的四面牆（與 swe.ts 的 box 座標一致：背牆、左牆、前牆、右牆）
  const wall = (x: number, z: number, w: number, d: number): Aabb => ({ min: [x - w / 2, 0.2, z - d / 2], max: [x + w / 2, 3.4, z + d / 2] });
  const walls = [wall(7.5, -6.1, 17.2, 0.25), wall(-1.1, -1.75, 0.25, 8.5), wall(7.5, 2.62, 17.2, 0.25), wall(16.1, -1.75, 0.25, 8.9)];
  it("a point behind a wall is blocked; a tag just in front of the wall is not", () => {
    const eye = SWE_FP_VIEWS.desk.pos;
    expect(segmentBlocked(eye, [10, 2, -8], walls)).toBe(true); // 背牆後面
    expect(segmentBlocked(eye, [20, 2, -1], walls)).toBe(true); // 右牆外面
    expect(segmentBlocked(eye, [12.1, 3.1, -5.9], walls)).toBe(false); // 座位區標籤貼在背牆前
  });
  it("every SWE place tag is visible from every view (the office is one room)", () => {
    const tagsAt: [number, number, number][] = [[1.4, 3.1, -5.9], [6.3, 3.1, -5.9], [12.1, 3.1, -5.9], [1.2, 2.2, 2.1]];
    for (const v of Object.values(SWE_FP_VIEWS)) for (const t of tagsAt) expect(segmentBlocked(v.pos, t, walls)).toBe(false);
  });
  it("parallel rays and degenerate segments", () => {
    const box: Aabb = { min: [0, 0, 0], max: [1, 1, 1] };
    expect(segmentBlocked([-1, 0.5, 0.5], [2, 0.5, 0.5], [box])).toBe(true);
    expect(segmentBlocked([-1, 2, 0.5], [2, 2, 0.5], [box])).toBe(false);
    expect(segmentBlocked([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [box])).toBe(false);
  });
});
