// 水電工場景：剖開的老公寓、材料行、貨車。全部由方塊拼成，沒有外部模型。
// 座標：x 向右、z 朝向玩家、y 向上；相機從 (+x, +y, +z) 往下看，所以 +x/+z 側的牆不畫（剖面）。
import {
  AmbientLight,
  BoxGeometry,
  Clock,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { SceneHandle } from "./index";

type Zone = "out" | "in" | "attic";
interface Place {
  pos: Vector3;
  zone: Zone;
}

const PLACES: Record<string, Place> = {
  van: { pos: new Vector3(-4.3, 0, 3.9), zone: "out" },
  shop: { pos: new Vector3(-8.2, 0, 0.3), zone: "out" },
  door: { pos: new Vector3(0.6, 0, 2.3), zone: "out" },
  living: { pos: new Vector3(1.8, 0, -0.1), zone: "in" },
  bathroom: { pos: new Vector3(6.2, 0, -1.2), zone: "in" },
  ceiling: { pos: new Vector3(1.4, 3.2, -3.6), zone: "attic" },
};
const DOOR_IN = new Vector3(0.6, 0, 0.4);
const LADDER_BASE = new Vector3(3.3, 0, -2.4);
const LADDER_TOP = new Vector3(3.3, 3.2, -2.4);

const geo = new BoxGeometry(1, 1, 1);
const mats = new Map<number, MeshLambertMaterial>();
const mat = (c: number): MeshLambertMaterial => {
  let m = mats.get(c);
  if (!m) mats.set(c, (m = new MeshLambertMaterial({ color: c })));
  return m;
};

/** 以底面中心定位的方塊 */
function box(parent: Group, w: number, h: number, d: number, color: number, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildWorld(): Group {
  const w = new Group();
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

  // 樹
  for (const [x, z] of [[-3.2, -4.8], [-12.6, -6], [10, -4]] as const) {
    box(w, 0.4, 1.3, 0.4, 0x7a5a3a, x, 0, z);
    box(w, 1.7, 1.5, 1.7, 0x5f9a58, x, 1.3, z);
    box(w, 1.1, 0.9, 1.1, 0x6fae66, x, 2.8, z);
  }
  return w;
}

interface Person {
  root: Group;
  body: Group;
}

function makePerson(shirt: number, pants: number, hat: number | null): Person {
  const root = new Group();
  const body = new Group();
  box(body, 0.28, 0.7, 0.3, pants, -0.18, 0, 0);
  box(body, 0.28, 0.7, 0.3, pants, 0.18, 0, 0);
  box(body, 0.74, 0.78, 0.42, shirt, 0, 0.7, 0);
  box(body, 0.2, 0.66, 0.24, shirt, -0.5, 0.74, 0);
  box(body, 0.2, 0.66, 0.24, shirt, 0.5, 0.74, 0);
  box(body, 0.5, 0.5, 0.5, 0xf1c9a0, 0, 1.48, 0);
  if (hat !== null) {
    box(body, 0.6, 0.22, 0.6, hat, 0, 1.92, 0);
    box(body, 0.6, 0.06, 0.24, hat, 0, 1.92, 0.32);
  } else {
    box(body, 0.54, 0.16, 0.54, 0x4a3426, 0, 1.96, -0.02);
  }
  root.add(body);
  return { root, body };
}

class Walker {
  route: Vector3[] = [];
  yaw = 0;
  constructor(readonly p: Person, readonly speed: number) {}
  get moving(): boolean {
    return this.route.length > 0;
  }
  update(dt: number, t: number, bob: boolean): void {
    const pos = this.p.root.position;
    if (this.route.length) {
      const target = this.route[0];
      const d = target.clone().sub(pos);
      const step = this.speed * dt;
      if (d.length() <= step) {
        pos.copy(target);
        this.route.shift();
      } else {
        d.normalize();
        pos.addScaledVector(d, step);
      }
      if (Math.hypot(d.x, d.z) > 0.01) this.yaw = Math.atan2(d.x, d.z);
    }
    let diff = this.yaw - this.p.body.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.p.body.rotation.y += diff * Math.min(1, dt * 12);
    this.p.body.position.y = bob && this.moving ? Math.abs(Math.sin(t * 11)) * 0.12 : 0;
  }
}

function buildRoute(from: Place, to: Place): Vector3[] {
  const pts: Vector3[] = [];
  let zone: Zone = from.zone;
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

const lerpColor = (a: number, b: number, t: number): Color => new Color(a).lerp(new Color(b), t);

/** 一天的光線：早晨暖黃 → 正午明亮 → 傍晚橘紅 */
function dayLight(p: number): { sun: Color; sky: Color; intensity: number } {
  if (p < 0.5) {
    const t = p * 2;
    return { sun: lerpColor(0xffd2a0, 0xfff4e0, t), sky: lerpColor(0xc4d9ec, 0xd3e8f6, t), intensity: 1.35 + 0.35 * t };
  }
  const t = (p - 0.5) * 2;
  return { sun: lerpColor(0xfff4e0, 0xff9a60, t), sky: lerpColor(0xd3e8f6, 0xf0b898, t), intensity: 1.7 - 0.5 * t };
}

export function createPlumberScene(host: HTMLElement): SceneHandle | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "水電工的一天：公寓、材料行與貨車的方塊場景");
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const CAM_OFFSET = new Vector3(14, 13, 14);
  const target = new Vector3(-1.6, 0.8, 0);
  const camTarget = target.clone();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  const aimCamera = (): void => {
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);
  };
  aimCamera();

  const ambient = new AmbientLight(0xffffff, 0.75);
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.copy(target).add(new Vector3(9, 18, 7));
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
  scene.add(ambient, sun, sun.target, buildWorld());

  // 漏水：滴水方塊與地上的水漬，找到漏水點後消失
  const leak = new Group();
  const puddle = box(leak, 1.1, 0.03, 1.3, 0x7fc4e8, 5.0, 0.26, -5.1);
  const drips = [0, 1, 2].map((i) => {
    const m = box(leak, 0.1, 0.16, 0.1, 0x7fc4e8, 5.1, 0, -5.7);
    m.userData.phase = i / 3;
    return m;
  });
  scene.add(leak);

  const player = new Walker(makePerson(0xee7a2f, 0x2f4a6b, 0xf2c230), 5);
  const owner = new Walker(makePerson(0x6f9fbf, 0x4a4a52, null), 0);
  const apprentice = new Walker(makePerson(0x5fae6a, 0x2f4a6b, 0xf2c230), 4.4);
  owner.p.root.position.set(2.8, 0.2, -0.9);
  owner.yaw = Math.PI * 0.75;
  for (const w of [player, owner, apprentice]) scene.add(w.p.root);
  owner.p.root.visible = false;
  apprentice.p.root.visible = false;

  let current: Place | null = null;
  let active = true;
  let progress = 0;
  let flags: readonly string[] = [];
  let hasEntered = false;
  let sunNow = dayLight(0);
  let skyNow = sunNow.sky.clone();
  let size = { w: 0, h: 0 };

  const resize = (): void => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    const halfW = 8.2;
    const halfH = (halfW * h) / w;
    Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new Clock();
  let raf = 0;
  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!active) return;
    resize();
    const t = clock.elapsedTime;
    player.update(dt, t, !reduced);
    apprentice.update(dt, t, !reduced);
    // 學徒跟在玩家身後，進了夾層就留在樓下
    const pp = player.p.root.position;
    const follow = new Vector3(pp.x - 0.9, 0, pp.z + 0.7);
    const ap = apprentice.p.root.position;
    ap.x += (follow.x - ap.x) * Math.min(1, dt * 3);
    ap.z += (follow.z - ap.z) * Math.min(1, dt * 3);
    apprentice.yaw = player.yaw;
    apprentice.route = [];
    const apMoving = Math.hypot(follow.x - ap.x, follow.z - ap.z) > 0.15;
    apprentice.p.body.position.y = !reduced && apMoving ? Math.abs(Math.sin(t * 11)) * 0.12 : 0;

    const showLeak = !flags.includes("found_leak");
    leak.visible = showLeak;
    if (showLeak) {
      for (const d of drips) {
        const ph = reduced ? 0.3 : (t * 0.9 + (d.userData.phase as number)) % 1;
        d.position.y = 1.75 - ph * 1.5;
        d.visible = ph < 0.95;
      }
      puddle.visible = true;
    }

    // 鏡頭跟著玩家（高度只跟一半，爬上夾層時不會晃太大）
    const want = new Vector3(Math.max(-8, Math.min(6, pp.x)), 0.8 + pp.y * 0.5, Math.max(-4, Math.min(3, pp.z)));
    camTarget.lerp(want, reduced ? 1 : Math.min(1, dt * 3));
    aimCamera();

    const goal = dayLight(progress);
    const k = Math.min(1, dt * 2.5);
    sunNow.sun.lerp(goal.sun, k);
    skyNow.lerp(goal.sky, k);
    sunNow.intensity += (goal.intensity - sunNow.intensity) * k;
    sun.color.copy(sunNow.sun);
    sun.intensity = sunNow.intensity;
    renderer.setClearColor(skyNow);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setLocation(id) {
      const next = id ? PLACES[id] : undefined;
      if (!next) return;
      if (next.zone !== "out" || id === "door") hasEntered = true;
      owner.p.root.visible = hasEntered;
      apprentice.p.root.visible = hasEntered;
      if (!current) {
        player.p.root.position.copy(next.pos);
        camTarget.set(next.pos.x, 0.8 + next.pos.y * 0.5, next.pos.z);
        apprentice.p.root.position.set(next.pos.x - 0.9, 0, next.pos.z + 0.7);
      } else if (current !== next) {
        if (reduced) snapTo(player, next.pos);
        else player.route = buildRoute(current, next);
      }
      current = next;
    },
    setFlags(f) {
      flags = f;
    },
    setProgress(p) {
      progress = Math.max(0, Math.min(1, p));
      if (!current) {
        sunNow = dayLight(progress);
        skyNow = sunNow.sky.clone();
      }
    },
    setActive(a) {
      active = a;
      if (a) {
        size = { w: 0, h: 0 };
        clock.getDelta();
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function snapTo(w: Walker, to: Vector3): void {
  w.p.root.position.copy(to);
  w.route = [];
}
