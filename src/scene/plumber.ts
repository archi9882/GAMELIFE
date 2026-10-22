// 水電工場景：剖開的老公寓、材料行、貨車。全部由方塊拼成，沒有外部模型。
import { Group, Vector3 } from "three";
import type { SceneHandle } from "./index";
import { box, castOf, createStage, floorLabel, type Ctx, type Place, type SceneDef } from "./kit";

type Zone = "out" | "in" | "attic";
const P = (x: number, y: number, z: number, zone: Zone): Place => ({ pos: new Vector3(x, y, z), zone });

const PLACES: Record<string, Place> = {
  van: P(-4.3, 0, 3.9, "out"),
  shop: P(-8.2, 0, 0.3, "out"),
  door: P(0.6, 0, 2.3, "out"),
  living: P(1.8, 0, -0.1, "in"),
  bathroom: P(6.2, 0, -1.2, "in"),
  ceiling: P(1.4, 3.2, -3.6, "attic"),
};
const DOOR_IN = new Vector3(0.6, 0, 0.4);
const LADDER_BASE = new Vector3(3.3, 0, -2.4);
const LADDER_TOP = new Vector3(3.3, 3.2, -2.4);

function buildWorld(w: Group): void {
  // 地面、人行道、馬路
  box(w, 30, 0.2, 22, 0xa9c19a, -2, -0.2, 0);
  box(w, 30, 0.06, 1.1, 0xbdb8ac, -2, 0, 2.7);
  box(w, 30, 0.05, 3.6, 0x6b6f76, -2, 0, 5.2);
  for (let x = -12; x < 9; x += 3) box(w, 1.4, 0.06, 0.18, 0xe8e2c8, x, 0.05, 5.2);

  // 公寓：地板、背牆、左牆（相機看不到的兩面）
  box(w, 9.4, 0.2, 7.4, 0xd9c7a8, 3.5, 0, -2.5);
  box(w, 9.4, 3.2, 0.25, 0xe9e1d3, 3.5, 0.2, -6.1);
  box(w, 0.25, 3.2, 7.4, 0xe9e1d3, -1.1, 0.2, -2.5);
  // 客廳與浴室之間的矮隔間（留一個門洞，高度壓低才不會擋住客廳）
  box(w, 0.2, 1.1, 3.8, 0xcfc4b0, 4.5, 0.2, -4.1);
  box(w, 0.2, 1.1, 1.4, 0xcfc4b0, 4.5, 0.2, 0.3);
  // 浴室地磚、浴缸、馬桶、洗手台
  box(w, 3.5, 0.06, 7, 0xbfd9e0, 6.25, 0.2, -2.5);
  box(w, 2.2, 0.8, 1.3, 0xf4f4f0, 6.9, 0.2, -5.3);
  box(w, 1.9, 0.12, 1.0, 0x9fd2e8, 6.9, 0.95, -5.3);
  box(w, 0.7, 0.9, 0.7, 0xf4f4f0, 5.3, 0.2, -3.3);
  box(w, 1.0, 0.9, 0.7, 0xf4f4f0, 7.4, 0.2, -3.3);
  // 牆上的水管（藍＝冷水、紅＝熱水）
  box(w, 3.6, 0.14, 0.14, 0x3b82c4, 6.2, 1.8, -5.9);
  box(w, 3.6, 0.14, 0.14, 0xc4513b, 6.2, 1.5, -5.9);
  // 客廳家具
  box(w, 2.2, 0.7, 0.9, 0x8a6f9e, 1.2, 0.2, -5.4);
  box(w, 1.4, 0.45, 0.9, 0x9b7b55, 1.5, 0.2, -2.0);
  box(w, 1.2, 0.9, 0.5, 0x4a4a52, -0.3, 0.2, -4.0);

  // 天花板夾層：木板、橫樑、電線
  box(w, 4.7, 0.2, 4.4, 0xb08d62, 1.25, 3.0, -3.8);
  for (let x = -0.8; x < 3.5; x += 1.2) box(w, 0.18, 0.28, 4.4, 0x8a6a45, x, 3.2, -3.8);
  box(w, 3.8, 0.07, 0.07, 0xd24b3c, 1.0, 3.5, -4.8);
  box(w, 3.8, 0.07, 0.07, 0x2f2f33, 1.0, 3.6, -4.6);
  // 梯子
  box(w, 0.1, 3.2, 0.1, 0x9a9a9a, 3.5, 0.2, -2.75);
  box(w, 0.1, 3.2, 0.1, 0x9a9a9a, 3.5, 0.2, -2.05);
  for (let y = 0.5; y < 3.1; y += 0.55) box(w, 0.08, 0.07, 0.7, 0x9a9a9a, 3.5, y, -2.4);
  // 門框與踏墊
  box(w, 0.12, 2.4, 0.12, 0x7a5a3a, 0.0, 0.2, 1.1);
  box(w, 0.12, 2.4, 0.12, 0x7a5a3a, 1.2, 0.2, 1.1);
  box(w, 1.32, 0.12, 0.12, 0x7a5a3a, 0.6, 2.5, 1.1);
  box(w, 1.0, 0.03, 0.6, 0x8b3a3a, 0.6, 0.2, 1.7);

  // 材料行：建築、條紋雨遮、招牌、門、堆在門口的管材與箱子
  box(w, 5, 3.2, 5, 0xc9a27e, -8.5, 0, -3.5);
  for (let i = 0; i < 5; i++) box(w, 1, 0.15, 1.0, i % 2 ? 0xf3efe6 : 0xc8453a, -10.5 + i, 2.35, -0.5);
  box(w, 3.2, 0.7, 0.1, 0x2b5d8a, -8.5, 2.55, -0.95);
  for (let i = 0; i < 4; i++) box(w, 0.4, 0.35, 0.05, 0xf3efe6, -9.6 + i * 0.75, 2.72, -0.88);
  box(w, 1.1, 2.0, 0.1, 0x5a3f2a, -8.5, 0, -0.98);
  box(w, 0.8, 0.8, 0.8, 0xb98f5a, -6.6, 0, -0.4);
  box(w, 0.8, 0.8, 0.8, 0xa97f4a, -6.6, 0.8, -0.4);
  for (let i = 0; i < 3; i++) box(w, 0.14, 0.14, 2.0, 0xd8d8d8, -10.8, 0.2 + i * 0.16, 0.0);

  // 貨車：車斗、車頭、擋風玻璃、車輪、藍條
  box(w, 2.6, 1.7, 1.7, 0xf3f1ea, -7.4, 0.5, 5.3);
  box(w, 1.1, 1.2, 1.7, 0xe6e3da, -5.5, 0.5, 5.3);
  box(w, 0.06, 0.55, 1.4, 0x2f3a4a, -4.93, 1.0, 5.3);
  box(w, 2.62, 0.2, 1.72, 0x2b6cb0, -7.4, 0.9, 5.3);
  for (const x of [-8.1, -5.6]) for (const z of [4.4, 6.2]) box(w, 0.7, 0.7, 0.2, 0x25262b, x, 0, z);

  // 地面區名
  floorLabel(w, "客廳", "LIVING", 1.4, 0.24, -0.5, 4.4);
  floorLabel(w, "浴室", "BATH", 6.4, 0.28, -1.2, 3.8);
  floorLabel(w, "材料行", "SHOP", -8.4, 0.02, 1.35, 4.4);
  floorLabel(w, "馬路", "STREET", 1.5, 0.08, 5.2, 4.4);

  // 樹
  for (const [x, z] of [[-3.2, -4.8], [-12.6, -6], [10, -4]] as const) {
    box(w, 0.4, 1.3, 0.4, 0x7a5a3a, x, 0, z);
    box(w, 1.7, 1.5, 1.7, 0x5f9a58, x, 1.3, z);
    box(w, 1.1, 0.9, 1.1, 0x6fae66, x, 2.8, z);
  }
}

function buildRoute(from: Place, to: Place): Vector3[] {
  const pts: Vector3[] = [];
  let zone = from.zone;
  if (zone === "attic") {
    pts.push(LADDER_TOP, LADDER_BASE);
    zone = "in";
  }
  if (zone === "in" && to.zone === "out") pts.push(DOOR_IN, PLACES.door.pos);
  else if (zone === "out" && to.zone !== "out") pts.push(PLACES.door.pos, DOOR_IN);
  if (to.zone === "attic") pts.push(LADDER_BASE, LADDER_TOP);
  pts.push(to.pos);
  return pts;
}

const def: SceneDef = {
  ariaLabel: "水電工的一天：公寓、材料行與貨車的方塊場景",
  world: buildWorld,
  places: PLACES,
  route: buildRoute,
  player: { label: "你｜水電工", shirt: 0xee7a2f, pants: 0x2f4a6b, hat: 0xf2c230 },
  npcs: [
    { label: "阿凱｜學徒", cls: "mate", shirt: 0x5fae6a, pants: 0x2f4a6b, hat: 0xf2c230, pos: new Vector3(0, 0, 0), follow: { dx: -0.9, dz: 0.7 }, visible: (c) => hasEntered(c) },
    { label: "屋主", cls: "owner", shirt: 0x6f9fbf, pants: 0x4a4a52, hat: null, pos: new Vector3(2.8, 0.2, -0.9), yaw: Math.PI * 0.75, visible: (c) => hasEntered(c) },
  ],
  placeTags: [
    { text: "材料行", pos: new Vector3(-8.5, 3.9, -1) },
    { text: "貨車", pos: new Vector3(-6.8, 2.7, 5.3) },
    { text: "浴室", pos: new Vector3(6.4, 3.0, -4.6) },
    { text: "天花板夾層", pos: new Vector3(1.2, 4.0, -3.8) },
  ],
  camera: { halfW: 8.2, target: new Vector3(-1.6, 0.8, 0), minX: -8, maxX: 6, minZ: -4, maxZ: 3 },
  extras: (scene) => {
    // 漏水：滴水方塊與地上的水漬，找到漏水點後消失
    const leak = new Group();
    const puddle = box(leak, 1.1, 0.03, 1.3, 0x7fc4e8, 5.0, 0.26, -5.1);
    const drips = [0, 1, 2].map((i) => {
      const m = box(leak, 0.1, 0.16, 0.1, 0x7fc4e8, 5.1, 0, -5.7);
      m.userData.phase = i / 3;
      return m;
    });
    scene.add(leak);
    return {
      update(_dt: number, t: number, ctx: Ctx, reduced: boolean) {
        const show = !ctx.flags.includes("found_leak");
        leak.visible = show;
        if (!show) return;
        for (const d of drips) {
          const ph = reduced ? 0.3 : (t * 0.9 + (d.userData.phase as number)) % 1;
          d.position.y = 1.75 - ph * 1.5;
          d.visible = ph < 0.95;
        }
        puddle.visible = true;
      },
    };
  },
};

/** 進過公寓（門口、客廳、浴室或夾層）之後，學徒與屋主才出現 */
function hasEntered(c: Ctx): boolean {
  return ["door", "living", "bathroom", "ceiling"].some((id) => c.visited.has(id));
}

export const PLUMBER_PLACE_IDS = Object.keys(PLACES);
export const PLUMBER_CAST = castOf(def);

export function createPlumberScene(host: HTMLElement): SceneHandle | null {
  return createStage(host, def);
}
