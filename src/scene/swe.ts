// 軟體工程師場景：開放式辦公室（站會區、會議室、座位區、茶水間）。全部由方塊拼成。
import { Group, MeshBasicMaterial, Vector3 } from "three";
import type { SceneHandle } from "./index";
import { box, castOf, createStage, floorLabel, type Place, type SceneDef } from "./kit";
import type { FpScreen, FpView } from "./fp";

const P = (x: number, y: number, z: number, zone: string): Place => ({ pos: new Vector3(x, y, z), zone });

const PLACES: Record<string, Place> = {
  standup: P(1.6, 0, -3.6, "standup"),
  meeting: P(6.3, 0, -1.8, "meeting"),
  desk: P(10.6, 0, -0.9, "desk"),
  newbie: P(12.1, 0, -4.4, "newbie"),
  pantry: P(1.2, 0, 0.9, "pantry"),
};
/** 辦公室地板範圍（xz）：第一人稱的視點都要站在這裡面（測試用） */
export const SWE_FLOOR = { x0: -0.9, z0: -5.9, x1: 16, z1: 2.5 };

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
  for (const [x, z] of DESKS) desk(w, x, z);
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

/** 四張桌子的位置（俯瞰的桌子與第一人稱的螢幕畫面共用） */
const DESKS: readonly (readonly [number, number])[] = [
  [10.6, -2.6],
  [13.6, -2.6],
  [10.6, -5.0],
  [13.6, -5.0],
];

/** 不受光的材質（螢幕、窗、燈會「發亮」）：依顏色共用 */
const glowMats = new Map<number, MeshBasicMaterial>();
const glow = (c: number): MeshBasicMaterial => {
  let m = glowMats.get(c);
  if (!m) glowMats.set(c, (m = new MeshBasicMaterial({ color: c })));
  return m;
};

/** 只在第一人稱顯示：天花板、補齊前牆與右牆（俯瞰時是剖面）、門、窗、亮著的螢幕、燈、地毯與磁磚 */
function buildFirstPerson(w: Group): void {
  const WALL = 0xe9e1d3;
  // 材質變化（v0.12）：會議室地毯、座位區地墊、茶水間磁磚、站會區的色牆；全部是程式產生的方塊，不用貼圖
  box(w, 3.9, 0.02, 4.7, 0x56677a, 6.25, 0.2, -3.75); // 會議室地毯
  box(w, 6.4, 0.015, 5.0, 0xaeb7c0, 12.1, 0.2, -3.6); // 座位區地墊
  const tiles = [0xece7de, 0xcbc3b6];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) box(w, 0.75, 0.015, 0.7, tiles[(i + j) % 2], -0.5 + i * 0.75, 0.2, 0.75 + j * 0.7); // 茶水間磁磚
  box(w, 4.4, 3.2, 0.02, 0x8fb3a8, 1.4, 0.2, -5.965); // 站會區的色牆（看板後面）
  box(w, 0.04, 1.0, 8.5, 0xd9cfbf, -0.96, 0.2, -1.75); // 左牆的護牆板
  box(w, 17.2, 0.12, 0.04, 0xcfc6b6, 7.5, 0.2, -5.96); // 背牆踢腳板
  // 天花板與燈不受光（太陽從上面照，天花板底面會太暗）；材質只建一次，整片共用
  const ceiling = new MeshBasicMaterial({ color: 0xdcd8d0 });
  const lamp = new MeshBasicMaterial({ color: 0xfffdf4 });
  box(w, 17.4, 0.12, 9.0, 0, 7.5, 3.4, -1.75).material = ceiling;
  for (const x of [1.5, 5.5, 9.5, 13.5]) for (const z of [-4.2, -0.6]) box(w, 1.6, 0.03, 0.5, 0, x, 3.37, z).material = lamp;
  box(w, 17.2, 3.2, 0.25, WALL, 7.5, 0.2, 2.62); // 前牆
  box(w, 0.25, 3.2, 8.9, WALL, 16.1, 0.2, -1.75); // 右牆
  box(w, 17.2, 0.12, 0.04, 0xcfc6b6, 7.5, 0.2, 2.48); // 前牆踢腳板
  for (const x of [6.5, 9.5, 12.5]) box(w, 2.2, 1.4, 0.06, 0, x, 1.3, 2.47).material = glow(0xdcedf6); // 前牆的窗（亮）
  for (const x of [6.5, 9.5, 12.5]) box(w, 0.06, 1.4, 0.07, 0xb9b2a6, x, 1.3, 2.46); // 窗框
  // 右牆的門（門把朝室內）
  box(w, 0.06, 2.2, 1.1, 0x8a6a4a, 15.95, 0.2, 0.9);
  box(w, 0.08, 0.06, 0.18, 0xd8d8d8, 15.9, 1.2, 0.5);
  box(w, 0.04, 0.3, 0.6, 0x3b8a4a, 15.95, 2.6, 0.9); // 出口指示燈
  // 茶水間：技術分享的電視（前牆，吧檯上方）
  box(w, 1.7, 0.95, 0.06, 0x2b2b30, 1.4, 1.85, 2.46);
  box(w, 1.55, 0.8, 0.01, 0, 1.4, 1.92, 2.425).material = glow(0x3a6ea5);
  box(w, 0.9, 0.12, 0.01, 0, 1.4, 2.4, 2.42).material = glow(0xf4f4f0);
  for (let i = 0; i < 3; i++) box(w, 0.6 - i * 0.12, 0.06, 0.01, 0, 1.25, 2.18 - i * 0.14, 2.42).material = glow(0xcfe6f2);
  // 座位區：亮著的螢幕（程式碼與圖表）
  const code = [0x8ed19a, 0x7ab5e0, 0xf2c230, 0xee7a6a];
  for (const [x, z] of DESKS) {
    for (const [mx, k] of [[x - 0.35, 0], [x + 0.4, 1]] as const) {
      box(w, 0.62, 0.37, 0.01, 0, mx, 0.99, z - 0.155).material = glow(k ? 0x1f3550 : 0x1c2b22);
      for (let i = 0; i < 4; i++) box(w, 0.18 + ((i * 7 + k * 3) % 5) * 0.06, 0.03, 0.005, 0, mx - 0.2 + ((i * 7 + k * 3) % 5) * 0.03, 1.27 - i * 0.07, z - 0.148).material = glow(code[(i + k) % 4]);
    }
  }
  // 會議室：螢幕亮起（簡報底色）
  box(w, 2.44, 1.16, 0.01, 0, 6.3, 1.07, -5.905).material = glow(0x24364d);
}

/**
 * 可以推近的螢幕（v0.12 畫面內任務）：座位的左邊螢幕（小遊戲、查資料）、會議室的大螢幕（技術分享會）、茶水間電視。
 * 位置對齊 buildFirstPerson 的螢幕畫面（正面朝向房間）。
 */
const SWE_SCREENS: Record<string, FpScreen> = {
  monitor: { center: [DESKS[0][0] - 0.35, 0.99 + 0.185, DESKS[0][1] - 0.149], w: 0.62, h: 0.37, normal: [0, 0, 1] },
  meeting: { center: [6.3, 1.07 + 0.58, -5.899], w: 2.44, h: 1.16, normal: [0, 0, 1] },
  tv: { center: [1.4, 1.92 + 0.4, 2.419], w: 1.55, h: 0.8, normal: [0, 0, -1] },
};
/** 在座位查資料／玩小遊戲 → 自己的電腦螢幕；技術分享會 → 會議室大螢幕 */
const SWE_TASK_SCREENS = { investigate: { desk: "monitor" }, events: { "s-techshare": "meeting" } };
export { SWE_SCREENS, SWE_TASK_SCREENS };

/** 第一人稱的視點：眼睛高度 1.6；事件的人站在別處時改面向那個人（頭的高度約 1.7） */
const EYE = 1.6;
const SWE_VIEWS: Record<string, FpView> = {
  standup: { pos: [0.8, EYE, -0.9], look: [1.4, 1.7, -5.9], faces: { "s-standup": [2.9, 1.7, -3.5] } },
  meeting: { pos: [5.5, EYE, -0.7], look: [6.3, 1.6, -5.9], faces: { "s-scope": [7.6, 1.7, -3.3] } },
  desk: { pos: [10.6, EYE, -1.05], look: [10.6, 1.15, -2.8] },
  newbie: { pos: [12.2, EYE, -3.0], look: [13.6, 1.7, -4.05], faces: { "s-mentor": [13.6, 1.7, -4.05] } },
  pantry: { pos: [1.4, EYE, -0.6], look: [1.4, 1.75, 2.45] },
};
export const SWE_FP_VIEWS = SWE_VIEWS;

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
    { text: "站會區", pos: new Vector3(1.4, 3.1, -5.9), at: "standup" },
    { text: "會議室", pos: new Vector3(6.3, 3.1, -5.9), at: "meeting" },
    { text: "座位區", pos: new Vector3(12.1, 3.1, -5.9), at: "desk" },
    { text: "茶水間", pos: new Vector3(1.2, 2.2, 2.1), at: "pantry" },
  ],
  camera: { halfW: 8.2, target: new Vector3(3, 0.8, -1.5), minX: 2, maxX: 12.5, minZ: -3, maxZ: 1.5 },
  firstPerson: {
    views: SWE_VIEWS,
    build: buildFirstPerson,
    screens: SWE_SCREENS,
    taskScreens: SWE_TASK_SCREENS,
    // 補光：茶水間暖光、會議室螢幕的冷光、座位區的檯燈色
    lights: [
      { color: 0xffc488, intensity: 5, distance: 6, pos: [1.4, 2.8, 1.2] },
      { color: 0x9cc4ff, intensity: 3, distance: 5, pos: [6.3, 1.8, -5.0] },
      { color: 0xfff0d8, intensity: 4, distance: 7, pos: [12.1, 2.9, -3.6] },
    ],
  },
};

export const SWE_PLACE_IDS = Object.keys(PLACES);
export const SWE_CAST = castOf(def);

export function createSweScene(host: HTMLElement): SceneHandle | null {
  return createStage(host, def);
}
