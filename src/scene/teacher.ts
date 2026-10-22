// 高中老師場景：剖開的校舍（教室、辦公室、輔導室、走廊）與前方的中庭。全部由方塊拼成。
import { Group, Vector3 } from "three";
import type { SceneHandle } from "./index";
import type { Rect } from "./nav";
import { box, createStage, floorLabel, type Place, type SceneDef } from "./kit";

const P = (x: number, y: number, z: number, zone: string): Place => ({ pos: new Vector3(x, y, z), zone });

const PLACES: Record<string, Place> = {
  classroom: P(3.2, 0, -4.9, "classroom"),
  office: P(8.3, 0, -1.2, "office"),
  counsel: P(13.2, 0, -1.2, "counsel"),
  hall: P(8.2, 0, 1.1, "hall"),
};
/** 自由走動：可走的地板（校舍含走廊、前方中庭）與家具障礙；隔間只到走廊前，出入口保持開著 */
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
export const TEACHER_NAV: { walkable: Rect[]; blocked: Rect[] } = {
  walkable: [R(-0.9, -5.9, 16, 2), R(-5, 2, 19, 5.2)],
  blocked: [
    R(5.4, -6, 5.6, -0.4), // 教室／辦公室矮隔間
    R(10.9, -6, 11.1, -0.4), // 辦公室／輔導室矮隔間
    R(-0.6, -5.3, 1.0, -4.5), // 講桌
    // 課桌（含椅子）：三排三列
    ...[0.5, 1.9, 4.5].flatMap((x) => [-3.6, -2.4, -1.2].flatMap((z) => [R(x - 0.5, z - 0.3, x + 0.5, z + 0.3), R(x - 0.25, z + 0.4, x + 0.25, z + 0.9)])),
    // 辦公桌（含椅子）
    ...[-4.9, -2.8].flatMap((z) => [7.0, 9.6].flatMap((x) => [R(x - 0.9, z - 0.45, x + 0.9, z + 0.45), R(x - 0.25, z + 0.7, x + 0.25, z + 1.2)])),
    R(10, -6, 10.8, -5.5), // 文件櫃
    R(12.9, -5.5, 15.5, -4.45), // 沙發
    R(11.45, -4.1, 12.55, -3.3), // 茶几
    R(14.75, -2.35, 15.45, -1.65), // 盆栽
    R(15.4, 4.3, 15.6, 4.5), // 旗桿
    R(4.1, 4.45, 5.9, 4.95), // 長椅
    R(9.6, 4.45, 11.4, 4.95),
    R(-3.45, 2.75, -1.75, 4.45), // 樹
  ],
};
export const TEACHER_PLACE_POS: Record<string, { x: number; z: number }> = Object.fromEntries(Object.entries(PLACES).map(([id, p]) => [id, { x: p.pos.x, z: p.pos.z }]));

/** 各房間在走廊上的出入口 x（與房間內的走道對齊） */
const HALL_X: Record<string, number> = { classroom: 3.2, office: 8.3, counsel: 13.2 };
const HALL_Z = 1.0;

/** 回到走廊再進另一間，不穿過桌椅 */
function route(from: Place, to: Place): Vector3[] {
  if (from.zone === to.zone) return [to.pos.clone()];
  const pts: Vector3[] = [];
  if (from.zone !== "hall") pts.push(new Vector3(HALL_X[from.zone], 0, HALL_Z));
  if (to.zone !== "hall") pts.push(new Vector3(HALL_X[to.zone], 0, HALL_Z));
  pts.push(to.pos.clone());
  return pts;
}

/** 坐在椅子上的學生（只畫上半身，腿藏在桌下） */
function student(w: Group, x: number, z: number, shirt: number, hair: number): void {
  box(w, 0.5, 0.55, 0.34, shirt, x, 0.62, z);
  box(w, 0.42, 0.42, 0.42, 0xf1c9a0, x, 1.17, z);
  box(w, 0.46, 0.14, 0.46, hair, x, 1.5, z - 0.02);
}

function buildWorld(w: Group): void {
  // 地面：草地、中庭鋪面
  box(w, 34, 0.2, 24, 0xa9c19a, 6, -0.2, 0);
  box(w, 24, 0.06, 3.2, 0xd8d0c0, 7, 0, 3.6);

  // 校舍：地板、背牆、左牆、走廊
  box(w, 17, 0.2, 8, 0xd9c7a8, 7.5, 0, -2);
  box(w, 17, 0.03, 1.8, 0xe6dccb, 7.5, 0.2, 1.1);
  box(w, 17.2, 3.2, 0.25, 0xe9e1d3, 7.5, 0.2, -6.1);
  box(w, 0.25, 3.2, 8, 0xe9e1d3, -1.1, 0.2, -2);
  // 房間之間的矮隔間（壓低才不會擋住後面的房間）
  box(w, 0.2, 1.1, 5.6, 0xcfc4b0, 5.5, 0.2, -3.2);
  box(w, 0.2, 1.1, 5.6, 0xcfc4b0, 11, 0.2, -3.2);
  // 各房間地板顏色
  box(w, 6.5, 0.03, 5.6, 0xcdb894, 2.25, 0.2, -3.2);
  box(w, 5.5, 0.03, 5.6, 0xbfc4c9, 8.25, 0.2, -3.2);
  box(w, 4.5, 0.03, 5.6, 0xc7d3b8, 13.25, 0.2, -3.2);

  // 教室：黑板（在背牆上）、講桌、三排課桌椅與學生
  box(w, 4.4, 1.7, 0.1, 0x7a5a3a, 2.4, 1.0, -5.95);
  box(w, 4.1, 1.4, 0.1, 0x2f5a45, 2.4, 1.15, -5.88);
  for (let i = 0; i < 3; i++) box(w, 1.1 + i * 0.4, 0.05, 0.02, 0xf2f2ee, 1.2 + i * 0.5, 1.9 - i * 0.3, -5.8);
  box(w, 1.6, 0.8, 0.8, 0x8a6a45, 0.2, 0.2, -4.9);
  const hair = [0x2b2118, 0x4a3426, 0x1c1916, 0x6a4a2a];
  const shirts = [0xf0f0f0, 0xe9eef5, 0xf5f0e6, 0xe6f0ea];
  let n = 0;
  for (const x of [0.5, 1.9, 4.5]) {
    for (const z of [-3.6, -2.4, -1.2]) {
      box(w, 1.0, 0.7, 0.6, 0xb08d62, x, 0.2, z);
      box(w, 0.5, 0.45, 0.5, 0x5a6b8a, x, 0.2, z + 0.65);
      if (!(x === 4.5 && z === -1.2)) student(w, x, z + 0.65, shirts[n % 4], hair[n % 4]);
      n++;
    }
  }

  // 辦公室：兩排辦公桌（桌上有螢幕與紙堆）、背牆白板
  for (const z of [-4.9, -2.8]) {
    for (const x of [7.0, 9.6]) {
      box(w, 1.8, 0.7, 0.9, 0xc9b08a, x, 0.2, z);
      box(w, 0.55, 0.42, 0.08, 0x2b2b30, x, 0.9, z - 0.2);
      box(w, 0.5, 0.12, 0.4, 0xf2f2ee, x + 0.55, 0.9, z + 0.05);
      box(w, 0.5, 0.45, 0.5, 0x4a4a52, x, 0.2, z + 0.95);
    }
  }
  box(w, 3.2, 1.5, 0.08, 0xf4f4f0, 8.2, 1.0, -5.95);
  box(w, 2.6, 0.06, 0.02, 0xc4513b, 8.2, 2.0, -5.9);
  box(w, 1.8, 0.06, 0.02, 0x3b82c4, 7.8, 1.65, -5.9);
  box(w, 0.8, 1.9, 0.5, 0x9a8a72, 10.4, 0.2, -5.75);

  // 輔導室：沙發、茶几、盆栽
  box(w, 2.6, 0.5, 0.9, 0x8a6f9e, 14.2, 0.2, -4.9);
  box(w, 2.6, 0.5, 0.18, 0x7a5f8e, 14.2, 0.7, -5.4);
  box(w, 1.1, 0.4, 0.8, 0x9b7b55, 12.0, 0.2, -3.7);
  box(w, 0.5, 0.5, 0.5, 0x7a5a3a, 15.1, 0.2, -2.0);
  box(w, 0.7, 0.8, 0.7, 0x5f9a58, 15.1, 0.7, -2.0);

  // 中庭：旗桿、長椅、樹
  box(w, 0.12, 5, 0.12, 0xb8b8b8, 15.5, 0, 4.4);
  box(w, 0.9, 0.55, 0.04, 0xc8453a, 15.95, 4.3, 4.4);
  box(w, 1.8, 0.35, 0.5, 0x9b7b55, 5, 0, 4.7);
  box(w, 1.8, 0.35, 0.5, 0x9b7b55, 10.5, 0, 4.7);
  for (const [x, z] of [[-2.6, 3.6], [-3.4, -4.6], [17.6, -3]] as const) {
    box(w, 0.4, 1.3, 0.4, 0x7a5a3a, x, 0, z);
    box(w, 1.7, 1.5, 1.7, 0x5f9a58, x, 1.3, z);
    box(w, 1.1, 0.9, 1.1, 0x6fae66, x, 2.8, z);
  }

  // 地面區名（放在前面的中庭，不被家具擋住）
  floorLabel(w, "教室", "CLASSROOM", 2.6, 0.08, 3.5, 4.6);
  floorLabel(w, "辦公室", "OFFICE", 8.2, 0.08, 3.5, 4.6);
  floorLabel(w, "輔導室", "COUNSEL", 13.2, 0.08, 3.5, 4.6);
}

const def: SceneDef = {
  ariaLabel: "高中老師的一天：教室、辦公室、輔導室與走廊的方塊場景",
  world: buildWorld,
  places: PLACES,
  route,
  player: { label: "你｜導師", shirt: 0x4f6fa8, pants: 0x3a3a42, hat: null },
  npcs: [
    { label: "同事", cls: "mate", shirt: 0x7a9b6a, pants: 0x4a4a52, hat: null, pos: new Vector3(9.6, 0, -1.95), yaw: Math.PI, visible: () => true },
    { label: "阿哲｜學生", cls: "npc", shirt: 0xf0f0f0, pants: 0x2a3550, hat: null, pos: new Vector3(9.4, 0, -1.0), yaw: Math.PI * 1.2, visible: (c) => c.open.has("t-lunch-talk") },
    { label: "家長", cls: "owner", shirt: 0xb06a8a, pants: 0x4a4a52, hat: null, pos: new Vector3(12.2, 0, -2.6), yaw: Math.PI * 0.6, visible: (c) => c.open.has("t-parent-meeting") },
    { label: "小美｜學生", cls: "npc", shirt: 0xf0f0f0, pants: 0x2a3550, hat: null, pos: new Vector3(9.6, 0, 1.2), yaw: Math.PI * 0.9, visible: (c) => c.open.has("t-progress") },
  ],
  placeTags: [
    { text: "教室", pos: new Vector3(2.4, 3.1, -5.9) },
    { text: "辦公室", pos: new Vector3(8.2, 3.1, -5.9) },
    { text: "輔導室", pos: new Vector3(13.2, 3.1, -5.9) },
  ],
  ...TEACHER_NAV,
  camera: { halfW: 8.2, target: new Vector3(3.2, 0.8, -2), minX: 2.5, maxX: 12.5, minZ: -3.5, maxZ: 1.5 },
};

export const TEACHER_PLACE_IDS = Object.keys(PLACES);

export function createTeacherScene(host: HTMLElement): SceneHandle | null {
  return createStage(host, def);
}
