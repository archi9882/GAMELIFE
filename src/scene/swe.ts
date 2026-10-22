// 軟體工程師場景：開放式辦公室（站會區、會議室、座位區、茶水間）。全部由方塊拼成。
import { Group, Vector3 } from "three";
import type { SceneHandle } from "./index";
import type { Rect } from "./nav";
import { box, createStage, floorLabel, type Place, type SceneDef } from "./kit";

const P = (x: number, y: number, z: number, zone: string): Place => ({ pos: new Vector3(x, y, z), zone });

const PLACES: Record<string, Place> = {
  standup: P(1.6, 0, -3.6, "standup"),
  meeting: P(6.3, 0, -1.8, "meeting"),
  desk: P(10.6, 0, -0.9, "desk"),
  newbie: P(12.1, 0, -4.4, "newbie"),
  pantry: P(1.2, 0, 0.9, "pantry"),
};
/** 自由走動：可走的辦公室地板與家具障礙 */
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
export const SWE_NAV: { walkable: Rect[]; blocked: Rect[] } = {
  walkable: [R(-0.9, -5.9, 16, 2.5)],
  blocked: [
    R(3.75, -6, 3.85, -1.2), // 會議室玻璃隔間（南端留出入口）
    R(4.9, -4.5, 7.7, -3.3), // 會議桌
    ...[5.3, 6.3, 7.3].flatMap((x) => [R(x - 0.25, -3.05, x + 0.25, -2.55), R(x - 0.25, -5.25, x + 0.25, -4.75)]), // 會議椅
    // 四張辦公桌（含椅子）
    ...[-2.6, -5.0].flatMap((z) => [10.6, 13.6].flatMap((x) => [R(x - 0.9, z - 0.45, x + 0.9, z + 0.45), R(x - 0.25, z + 0.7, x + 0.25, z + 1.2)])),
    R(15.05, -1.35, 15.75, -0.65), // 盆栽
    R(-0.4, 1.7, 2.8, 2.5), // 吧檯
    R(2.4, 0.7, 3.6, 1.9), // 圓桌
  ],
};
export const SWE_PLACE_POS: Record<string, { x: number; z: number }> = Object.fromEntries(Object.entries(PLACES).map(([id, p]) => [id, { x: p.pos.x, z: p.pos.z }]));

/** 主走道 z；各地點先走到走道，再沿走道移動，不穿過桌椅 */
const AISLE_Z = 0.2;

function route(from: Place, to: Place): Vector3[] {
  if (from.zone === to.zone) return [to.pos.clone()];
  return [new Vector3(from.pos.x, 0, AISLE_Z), new Vector3(to.pos.x, 0, AISLE_Z), to.pos.clone()];
}

function desk(w: Group, x: number, z: number): void {
  box(w, 1.8, 0.75, 0.9, 0xd2b48c, x, 0.2, z);
  box(w, 0.7, 0.45, 0.08, 0x2b2b30, x - 0.35, 0.95, z - 0.2);
  box(w, 0.7, 0.45, 0.08, 0x2b2b30, x + 0.4, 0.95, z - 0.2);
  box(w, 0.5, 0.05, 0.25, 0x3a3a42, x, 0.95, z + 0.2);
  box(w, 0.5, 0.45, 0.5, 0x3a4a6a, x, 0.2, z + 0.95);
}

function buildWorld(w: Group): void {
  // 地面與樓板
  box(w, 36, 0.2, 26, 0x9aa3ad, 6.5, -0.2, 0);
  box(w, 17, 0.2, 8.5, 0xbcc3cc, 7.5, 0, -1.75);
  // 背牆（有落地窗）與左牆
  box(w, 17.2, 3.2, 0.25, 0xe9e1d3, 7.5, 0.2, -6.1);
  box(w, 0.25, 3.2, 8.5, 0xe9e1d3, -1.1, 0.2, -1.75);
  for (const x of [5.5, 8.5, 11.5, 14.5]) box(w, 2.2, 1.4, 0.06, 0xcfe6f2, x, 1.3, -5.95);

  // 站會區：看板（便利貼）
  box(w, 3.4, 1.6, 0.1, 0xf4f4f0, 1.4, 0.9, -5.95);
  const notes = [0xf2c230, 0xee7a6a, 0x7ab5e0, 0x8ed19a];
  for (let i = 0; i < 9; i++) box(w, 0.4, 0.4, 0.04, notes[i % 4], 0.2 + (i % 3) * 1.0 + (i % 2) * 0.1, 1.15 + Math.floor(i / 3) * 0.5, -5.88);
  box(w, 0.04, 1.6, 0.03, 0x6a6a72, 0.7, 0.9, -5.86);
  box(w, 0.04, 1.6, 0.03, 0x6a6a72, 1.9, 0.9, -5.86);

  // 會議室：低玻璃隔間、桌椅、螢幕
  box(w, 0.1, 1.1, 4.8, 0xbcdcea, 3.8, 0.2, -3.6);
  box(w, 2.8, 0.75, 1.2, 0xb08d62, 6.3, 0.2, -3.9);
  for (const x of [5.3, 6.3, 7.3]) {
    box(w, 0.5, 0.45, 0.5, 0x4a4a52, x, 0.2, -2.8);
    box(w, 0.5, 0.45, 0.5, 0x4a4a52, x, 0.2, -5.0);
  }
  box(w, 2.6, 1.3, 0.08, 0x2b2b30, 6.3, 1.0, -5.95);
  for (let i = 0; i < 5; i++) box(w, 0.28, 0.2 + i * 0.16, 0.04, i % 2 ? 0x7ab5e0 : 0x8ed19a, 5.4 + i * 0.45, 1.2, -5.9);

  // 座位區：四張桌子
  desk(w, 10.6, -2.6);
  desk(w, 13.6, -2.6);
  desk(w, 10.6, -5.0);
  desk(w, 13.6, -5.0);
  box(w, 0.4, 0.5, 0.4, 0x7a5a3a, 15.4, 0.2, -1.0);
  box(w, 0.7, 0.8, 0.7, 0x5f9a58, 15.4, 0.7, -1.0);

  // 茶水間：吧檯、咖啡機、圓桌
  box(w, 3.2, 0.95, 0.8, 0xe9e1d3, 1.2, 0.2, 2.1);
  box(w, 0.5, 0.6, 0.4, 0x2b2b30, 0.4, 1.15, 2.1);
  box(w, 0.4, 0.4, 0.4, 0xc4513b, 2.0, 1.15, 2.1);
  box(w, 1.2, 0.7, 1.2, 0xb08d62, 3.0, 0.2, 1.3);

  // 外面的樹與停車位
  for (const [x, z] of [[-3, 3.5], [17.8, 3.5], [-3.4, -5]] as const) {
    box(w, 0.4, 1.3, 0.4, 0x7a5a3a, x, 0, z);
    box(w, 1.7, 1.5, 1.7, 0x5f9a58, x, 1.3, z);
    box(w, 1.1, 0.9, 1.1, 0x6fae66, x, 2.8, z);
  }

  // 地面區名
  floorLabel(w, "站會區", "STANDUP", 1.6, 0.23, -1.5, 3.6);
  floorLabel(w, "會議室", "MEETING", 6.3, 0.23, -0.9, 3.6);
  floorLabel(w, "座位區", "DESKS", 12.1, 0.23, 0.9, 3.6);
  floorLabel(w, "茶水間", "PANTRY", 4.6, 0.23, 2.6, 3.2);
}

const def: SceneDef = {
  ariaLabel: "軟體工程師的一天：開放式辦公室的方塊場景",
  world: buildWorld,
  places: PLACES,
  route,
  player: { label: "你｜工程師", shirt: 0x3b6fa8, pants: 0x2f2f36, hat: null },
  npcs: [
    { label: "新人", cls: "mate", shirt: 0x7ab58a, pants: 0x3a3a42, hat: null, pos: new Vector3(13.6, 0, -4.05), yaw: Math.PI, visible: () => true },
    { label: "隔壁團隊", cls: "npc", shirt: 0xb59ac8, pants: 0x3a3a42, hat: null, pos: new Vector3(13.6, 0, -1.65), yaw: Math.PI, visible: () => true },
    { label: "資深同事", cls: "npc", shirt: 0x6a7bb5, pants: 0x3a3a42, hat: null, pos: new Vector3(2.9, 0, -3.5), yaw: Math.PI * 0.6, visible: (c) => c.open.has("s-standup") },
    { label: "產品經理", cls: "owner", shirt: 0xc0707a, pants: 0x3a3a42, hat: null, pos: new Vector3(7.6, 0, -3.3), yaw: Math.PI * 0.5, visible: (c) => c.open.has("s-scope") },
  ],
  placeTags: [
    { text: "站會區", pos: new Vector3(1.4, 3.1, -5.9) },
    { text: "會議室", pos: new Vector3(6.3, 3.1, -5.9) },
    { text: "座位區", pos: new Vector3(12.1, 3.1, -5.9) },
    { text: "茶水間", pos: new Vector3(1.2, 2.2, 2.1) },
  ],
  ...SWE_NAV,
  camera: { halfW: 8.2, target: new Vector3(3, 0.8, -1.5), minX: 2, maxX: 12.5, minZ: -3, maxZ: 1.5 },
};

export const SWE_PLACE_IDS = Object.keys(PLACES);

export function createSweScene(host: HTMLElement): SceneHandle | null {
  return createStage(host, def);
}
