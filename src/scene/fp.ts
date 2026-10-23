// 第一人稱視角的純函式：視點查詢、朝向計算、拖曳環顧、上下角度限制、視野。不依賴 three.js（方便單元測試）。
// 角度慣例與 three.js 相機（rotation.order = "YXZ"）相同：yaw = 0 朝 -z，yaw 增加是往左轉；pitch > 0 抬頭。

export type V3 = readonly [number, number, number];

export interface FpView {
  /** 眼睛的位置（世界座標，y 為眼睛高度） */
  pos: V3;
  /** 預設看的點（例如螢幕、白板） */
  look: V3;
  /** 某些事件改看別的點（例如事件的人站的位置）：事件 id → 看的點 */
  faces?: Readonly<Record<string, V3>>;
}

/** 上下角度範圍（弧度）：只能稍微抬頭、低頭 */
export const PITCH_MIN = -0.5;
export const PITCH_MAX = 0.35;
/** 拖曳環顧的靈敏度（弧度／px） */
export const DRAG_SENS = 0.005;
/** 方向鍵轉頭的速度（弧度／秒） */
export const TURN_SPEED = 1.8;
/** 可見範圍的視野（度）：橫向畫面用垂直視野，直向畫面用水平視野 */
export const FP_FOV = 64;

export const clampPitch = (p: number): number => Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));

/** 角度換到 (-π, π] */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** 從 pos 看向 look 的 yaw／pitch（pitch 已限制在範圍內） */
export function aimAt(pos: V3, look: V3): { yaw: number; pitch: number } {
  const dx = look[0] - pos[0];
  const dy = look[1] - pos[1];
  const dz = look[2] - pos[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: clampPitch(Math.atan2(dy, Math.hypot(dx, dz))) };
}

/** 地點的視點；事件有指定朝向時改看該點。沒有這個地點時回傳 null */
export function viewFor(views: Readonly<Record<string, FpView>>, location: string | undefined, eventId?: string): { pos: V3; look: V3 } | null {
  const v = location ? views[location] : undefined;
  if (!v) return null;
  const face = eventId ? v.faces?.[eventId] : undefined;
  return { pos: v.pos, look: face ?? v.look };
}

/** 拖曳環顧：「抓著畫面拖」，往右拖畫面跟著往右移（視線往左轉）；往下拖抬頭 */
export function dragLook(yaw: number, pitch: number, dx: number, dy: number, sens = DRAG_SENS): { yaw: number; pitch: number } {
  return { yaw: wrapAngle(yaw + dx * sens), pitch: clampPitch(pitch + dy * sens) };
}

/**
 * 透視相機的垂直視野（度，對整個畫布）。畫面下方／左側被面板蓋住時，讓「看得到的範圍」維持約 FP_FOV 的視野：
 * 可見範圍是橫的 → 可見範圍的垂直視野 = fov；是直的 → 可見範圍的水平視野 = fov。
 * 鏡頭用 setViewOffset 偏移一半的遮蓋量，所以整個畫布的垂直視野依高度比例放大。insetTop：上方 HUD 的高度（v0.12）。
 */
export function fpFov(w: number, h: number, insetLeft = 0, insetBottom = 0, fov = FP_FOV, insetTop = 0): number {
  if (w <= 0 || h <= 0) return fov;
  const vw = w - Math.min(insetLeft, w * 0.8);
  const vh = h - Math.min(insetBottom + insetTop, h * 0.8);
  const t = Math.tan(((fov / 2) * Math.PI) / 180);
  const visibleTanV = vw >= vh ? t : (t * vh) / vw;
  const fullTanV = (visibleTanV * h) / vh;
  return (2 * Math.atan(fullTanV) * 180) / Math.PI;
}

/** 放開後的環顧慣性：速度隨時間指數衰減（減少動態時不使用） */
export const decay = (vel: number, dt: number, rate = 5): number => (Math.abs(vel) < 1e-3 ? 0 : vel * Math.exp(-rate * dt));

// ── v0.12 文字 RPG 框架：畫面內任務（鏡頭推近螢幕）、名牌遮擋 ──

/** 場景裡可以「推近」的螢幕：中心、寬高、正面朝向（單位向量，水平） */
export interface FpScreen {
  center: V3;
  w: number;
  h: number;
  normal: V3;
}

/** 畫面上的矩形（CSS px） */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 可見範圍（扣掉上方 HUD、下方對話框、左側面板）的上下視野半角正切；與 fpFov 的規則一致 */
export function visibleTanV(vw: number, vh: number, fov = FP_FOV): number {
  const t = Math.tan(((fov / 2) * Math.PI) / 180);
  if (vw <= 0 || vh <= 0) return t;
  return vw >= vh ? t : (t * vh) / vw;
}

/**
 * 鏡頭推近螢幕時離螢幕的距離：螢幕高度佔可見範圍高度的 fill。
 * 可見範圍是橫的（桌機）時同時保證寬度也放得下（整個螢幕都看得到）；直的（手機）時允許左右超出畫面，讓螢幕夠大好操作。
 */
export function screenDistance(s: Pick<FpScreen, "w" | "h">, vw: number, vh: number, fill = 0.88, fov = FP_FOV): number {
  const tv = visibleTanV(vw, vh, fov);
  let d = s.h / 2 / (tv * fill);
  if (vw >= vh && vh > 0) {
    const th = (tv * vw) / vh;
    d = Math.max(d, s.w / 2 / (th * 0.94));
  }
  return d;
}

/** 推近螢幕的鏡頭位置與朝向：站在螢幕正前方 d，正對螢幕中心 */
export function screenPose(s: FpScreen, d: number): { pos: V3; yaw: number; pitch: number } {
  const pos: V3 = [s.center[0] + s.normal[0] * d, s.center[1] + s.normal[1] * d, s.center[2] + s.normal[2] * d];
  return { pos, ...aimAt(pos, s.center) };
}

/** 螢幕四個角（世界座標），用來投影到畫面 */
export function screenCorners(s: FpScreen): V3[] {
  // 右方 = 上方 (0,1,0) × 正面
  const rx = s.normal[2];
  const rz = -s.normal[0];
  const len = Math.hypot(rx, rz) || 1;
  const hw = s.w / 2 / len;
  const hh = s.h / 2;
  const [cx, cy, cz] = s.center;
  return [
    [cx - rx * hw, cy - hh, cz - rz * hw],
    [cx + rx * hw, cy - hh, cz + rz * hw],
    [cx + rx * hw, cy + hh, cz + rz * hw],
    [cx - rx * hw, cy + hh, cz - rz * hw],
  ];
}

/** 緩入緩出（0–1） */
export const easeInOut = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 兩個鏡頭姿勢之間內插（yaw 走最短的方向） */
export function lerpPose(
  a: { pos: V3; yaw: number; pitch: number },
  b: { pos: V3; yaw: number; pitch: number },
  t: number,
): { pos: V3; yaw: number; pitch: number } {
  const k = easeInOut(t);
  return {
    pos: [lerp(a.pos[0], b.pos[0], k), lerp(a.pos[1], b.pos[1], k), lerp(a.pos[2], b.pos[2], k)],
    yaw: wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * k),
    pitch: lerp(a.pitch, b.pitch, k),
  };
}

/**
 * 任務疊層要放在哪裡：螢幕投影的矩形（內縮一點，留邊框）與可見範圍的交集。
 * 投影不在畫面上、或交集太小時，改放在可見範圍中央（fallback）。
 */
export function fitTaskRect(
  proj: PxRect | null,
  visible: PxRect,
  opts: { margin?: number; inset?: number; minW?: number; minH?: number; maxW?: number; maxH?: number } = {},
): { rect: PxRect; fit: "screen" | "fallback" } {
  const margin = opts.margin ?? 8;
  const v = { x: visible.x + margin, y: visible.y + margin, w: Math.max(0, visible.w - margin * 2), h: Math.max(0, visible.h - margin * 2) };
  if (proj && proj.w > 0 && proj.h > 0) {
    const inset = opts.inset ?? Math.min(proj.w, proj.h) * 0.03;
    const x0 = Math.max(proj.x + inset, v.x);
    const y0 = Math.max(proj.y + inset, v.y);
    const x1 = Math.min(proj.x + proj.w - inset, v.x + v.w);
    const y1 = Math.min(proj.y + proj.h - inset, v.y + v.h);
    if (x1 - x0 >= (opts.minW ?? 160) && y1 - y0 >= (opts.minH ?? 110)) return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, fit: "screen" };
  }
  const w = Math.min(v.w, opts.maxW ?? 720);
  const h = Math.min(v.h, opts.maxH ?? 460);
  return { rect: { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }, fit: "fallback" };
}

/** 軸對齊的方塊（世界座標） */
export interface Aabb {
  min: V3;
  max: V3;
}

/**
 * 線段 from→to 是否被任一方塊擋住（slab 法）。只算「離終點還有 tol 以上」的交點：
 * 名牌貼在牆前面一點點時不算被擋。
 */
export function segmentBlocked(from: V3, to: V3, boxes: readonly Aabb[], tol = 0.3): boolean {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  const tMax = 1 - tol / len;
  if (tMax <= 0) return false;
  for (const b of boxes) {
    let t0 = 0;
    let t1 = tMax;
    let hit = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (from[i] < b.min[i] || from[i] > b.max[i]) {
          hit = false;
          break;
        }
        continue;
      }
      let a = (b.min[i] - from[i]) / d[i];
      let c = (b.max[i] - from[i]) / d[i];
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}
