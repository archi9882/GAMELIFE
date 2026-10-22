// 3D 場景共用元件：方塊、角色、走路、浮動名牌、相機跟隨、一天的光線。
// 各職業的場景只需提供 SceneDef（地圖、地點、路線、角色），其餘都在這裡。
// 座標：x 向右、z 朝向玩家、y 向上；相機從 (+x, +y, +z) 往下看，所以 +x/+z 側的牆不畫（剖面）。
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Clock,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { SceneHandle } from "./index";

export interface Place {
  pos: Vector3;
  /** 區域名稱，路線規劃用（例如 "out"、"in"、"attic"、教室 id） */
  zone: string;
}

export interface Ctx {
  location: string | undefined;
  /** 目前事件 id（讓角色只在特定事件出現） */
  event: string | undefined;
  flags: readonly string[];
  /** 到過的地點 id */
  visited: ReadonlySet<string>;
}

export interface NpcDef {
  label: string;
  cls: "mate" | "owner" | "npc";
  shirt: number;
  pants: number;
  hat: number | null;
  pos: Vector3;
  yaw?: number;
  /** 設定後會跟在玩家身後（dx, dz 為相對偏移），並留在地面 */
  follow?: { dx: number; dz: number };
  visible: (c: Ctx) => boolean;
}

export interface SceneDef {
  ariaLabel: string;
  world: (w: Group) => void;
  places: Record<string, Place>;
  route: (from: Place, to: Place) => Vector3[];
  player: { label: string; shirt: number; pants: number; hat: number | null };
  npcs: NpcDef[];
  placeTags: { text: string; pos: Vector3 }[];
  camera: { halfW: number; target: Vector3; minX: number; maxX: number; minZ: number; maxZ: number };
  /** 場景專屬的動態效果（例如滴水）；回傳 update，每幀呼叫 */
  extras?: (scene: Scene) => { update: (dt: number, t: number, ctx: Ctx, reduced: boolean) => void };
}

const geo = new BoxGeometry(1, 1, 1);
const mats = new Map<number, MeshLambertMaterial>();
export const mat = (c: number): MeshLambertMaterial => {
  let m = mats.get(c);
  if (!m) mats.set(c, (m = new MeshLambertMaterial({ color: c })));
  return m;
};

/** 以底面中心定位的方塊 */
export function box(parent: Group, w: number, h: number, d: number, color: number, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** 貼在地面上的區名文字（中文加英文小字），朝向與相機的「螢幕右方」對齊 */
export function floorLabel(parent: Group, zh: string, en: string, x: number, y: number, z: number, width: number): void {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 200;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(43, 37, 32, 0.42)";
  g.font = "bold 92px system-ui, 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  g.fillText(zh, 320, 72);
  g.font = "600 46px system-ui, sans-serif";
  g.fillText(en.split("").join(" "), 320, 152);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new Mesh(new PlaneGeometry(width, (width * c.height) / c.width), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.order = "YXZ";
  m.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  m.position.set(x, y, z);
  parent.add(m);
}

export interface Person {
  root: Group;
  body: Group;
}

export function makePerson(shirt: number, pants: number, hat: number | null): Person {
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

export function createStage(host: HTMLElement, def: SceneDef): SceneHandle | null {
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
  renderer.domElement.setAttribute("aria-label", def.ariaLabel);
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const CAM_OFFSET = new Vector3(14, 13, 14);
  const cam = def.camera;
  const camTarget = cam.target.clone();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  const aimCamera = (): void => {
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);
  };
  aimCamera();

  const ambient = new AmbientLight(0xffffff, 0.75);
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.copy(cam.target).add(new Vector3(9, 18, 7));
  sun.target.position.copy(cam.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  const world = new Group();
  def.world(world);
  scene.add(ambient, sun, sun.target, world);
  const extras = def.extras?.(scene);

  const player = new Walker(makePerson(def.player.shirt, def.player.pants, def.player.hat), 5);
  scene.add(player.p.root);

  const npcs = def.npcs.map((n) => {
    const w = new Walker(makePerson(n.shirt, n.pants, n.hat), n.follow ? 4.4 : 0);
    w.p.root.position.copy(n.pos);
    w.yaw = n.yaw ?? 0;
    w.p.body.rotation.y = w.yaw;
    w.p.root.visible = false;
    scene.add(w.p.root);
    return { def: n, w };
  });

  // 浮動名牌：把 3D 座標投影到畫面，用 HTML 呈現（文字清楚、可換字型）
  const overlay = document.createElement("div");
  overlay.className = "stage-tags";
  host.appendChild(overlay);
  interface Tag {
    el: HTMLElement;
    anchor: () => Vector3;
    shown: () => boolean;
  }
  const tags: Tag[] = [];
  const addTag = (text: string, cls: string, anchor: () => Vector3, shown: () => boolean = () => true): void => {
    const el = document.createElement("span");
    el.className = `tag3d ${cls}`;
    el.textContent = text;
    overlay.appendChild(el);
    tags.push({ el, anchor, shown });
  };
  const above = (w: Walker, h: number) => (): Vector3 => w.p.root.position.clone().add(new Vector3(0, h + w.p.body.position.y, 0));
  addTag(def.player.label, "me", above(player, 2.55));
  for (const n of npcs) addTag(n.def.label, n.def.cls, above(n.w, 2.45), () => n.w.p.root.visible);
  for (const t of def.placeTags) addTag(t.text, "place", () => t.pos.clone());
  // 目標標記：黃色「！」，浮在要前往的地點上方
  const goalEl = document.createElement("span");
  goalEl.className = "tag3d goal";
  const goalIcon = document.createElement("i");
  goalIcon.textContent = "！";
  goalEl.appendChild(goalIcon);
  overlay.appendChild(goalEl);
  tags.push({
    el: goalEl,
    anchor: () => (goal ? goal.pos.clone().add(new Vector3(0, 2.9, 0)) : new Vector3(0, -99, 0)),
    shown: () => goal !== null,
  });

  let size = { w: 0, h: 0 };
  const placeTags = (): void => {
    const w = size.w;
    const h = size.h;
    const placed: { x: number; y: number; hw: number }[] = [];
    for (const t of tags) {
      const v = t.anchor().project(camera);
      const x = (v.x * 0.5 + 0.5) * w;
      let y = (-v.y * 0.5 + 0.5) * h;
      const on = t.shown() && v.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
      t.el.style.display = on ? "" : "none";
      if (!on) continue;
      // 名牌互相重疊時，後面的往上疊（tags 依重要性排序：玩家先）
      const hw = t.el.offsetWidth / 2;
      while (placed.some((p) => Math.abs(p.x - x) < p.hw + hw && Math.abs(p.y - y) < 18)) y -= 18;
      placed.push({ x, y, hw });
      t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  };

  let current: Place | null = null;
  /** 目標標記所在地點（事件發生地，玩家還沒到） */
  let goal: Place | null = null;
  let arriveCb: (() => void) | null = null;
  let location: string | undefined;
  let eventId: string | undefined;
  const visited = new Set<string>();
  let active = true;
  let progress = 0;
  let flags: readonly string[] = [];
  let sunNow = dayLight(0);
  let skyNow = sunNow.sky.clone();

  const resize = (): void => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    const halfH = (cam.halfW * h) / w;
    Object.assign(camera, { left: -cam.halfW, right: cam.halfW, top: halfH, bottom: -halfH });
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new Clock();
  let raf = 0;
  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!active) return;
    resize();
    const t = clock.elapsedTime;
    const ctx: Ctx = { location, event: eventId, flags, visited };
    player.update(dt, t, !reduced);
    if (arriveCb && !player.moving) {
      const cb = arriveCb;
      arriveCb = null;
      goal = null;
      if (location) visited.add(location);
      cb();
    }
    const pp = player.p.root.position;

    for (const n of npcs) {
      n.w.p.root.visible = n.def.visible(ctx);
      if (n.def.follow) {
        const f = new Vector3(pp.x + n.def.follow.dx, 0, pp.z + n.def.follow.dz);
        const np = n.w.p.root.position;
        np.x += (f.x - np.x) * Math.min(1, dt * 3);
        np.z += (f.z - np.z) * Math.min(1, dt * 3);
        n.w.yaw = player.yaw;
        n.w.p.body.rotation.y = player.yaw;
        const moving = Math.hypot(f.x - np.x, f.z - np.z) > 0.15;
        n.w.p.body.position.y = !reduced && moving ? Math.abs(Math.sin(t * 11)) * 0.12 : 0;
      }
    }
    extras?.update(dt, t, ctx, reduced);

    // 鏡頭跟著玩家（高度只跟一半，爬上夾層時不會晃太大）
    const want = new Vector3(Math.max(cam.minX, Math.min(cam.maxX, pp.x)), 0.8 + pp.y * 0.5, Math.max(cam.minZ, Math.min(cam.maxZ, pp.z)));
    camTarget.lerp(want, reduced ? 1 : Math.min(1, dt * 3));
    aimCamera();

    const light = dayLight(progress);
    const k = Math.min(1, dt * 2.5);
    sunNow.sun.lerp(light.sun, k);
    skyNow.lerp(light.sky, k);
    sunNow.intensity += (light.intensity - sunNow.intensity) * k;
    sun.color.copy(sunNow.sun);
    sun.intensity = sunNow.intensity;
    renderer.setClearColor(skyNow);
    renderer.render(scene, camera);
    placeTags();
  };
  raf = requestAnimationFrame(frame);

  return {
    focus(id, event) {
      eventId = event;
      const next = id ? def.places[id] : undefined;
      if (!id || !next) return;
      location = id;
      if (!current) {
        // 第一次：直接站到事件發生地
        player.p.root.position.copy(next.pos);
        camTarget.set(next.pos.x, 0.8 + next.pos.y * 0.5, next.pos.z);
        for (const n of npcs) if (n.def.follow) n.w.p.root.position.set(next.pos.x + n.def.follow.dx, 0, next.pos.z + n.def.follow.dz);
        visited.add(id);
        current = next;
        goal = null;
        return;
      }
      goal = current === next && !arriveCb ? null : next;
    },
    goTo(id, onArrive) {
      const next = def.places[id];
      if (arriveCb) return;
      if (!next || !current || current === next) {
        goal = null;
        onArrive?.();
        return;
      }
      location = id;
      if (reduced) {
        player.p.root.position.copy(next.pos);
        player.route = [];
        current = next;
        goal = null;
        visited.add(id);
        onArrive?.();
        return;
      }
      player.route = def.route(current, next);
      current = next;
      arriveCb = onArrive ?? (() => undefined);
    },
    at(id) {
      const p = id ? def.places[id] : undefined;
      return !!p && current === p && !arriveCb;
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
      overlay.remove();
    },
  };
}
