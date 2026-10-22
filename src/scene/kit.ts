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
  Plane,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { SceneHandle } from "./index";
import { buildGrid, findPath, slide, type Rect } from "./nav";

export interface Place {
  pos: Vector3;
  /** 區域名稱，路線規劃用（例如 "out"、"in"、"attic"、教室 id） */
  zone: string;
}

export interface Ctx {
  location: string | undefined;
  /** 玩家正在處理的事件 id */
  event: string | undefined;
  /** 目前開放的所有事件 id（含正在處理的）；等在各處的角色依此出現 */
  open: ReadonlySet<string>;
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
  /** 自由走動：可走的地板與家具障礙（xz 矩形）。沒有 walkable 的場景（水電工）只能「帶我去」 */
  walkable?: Rect[];
  blocked?: Rect[];
  /** 場景專屬的動態效果（例如滴水）；回傳 update，每幀呼叫 */
  extras?: (scene: Scene) => { update: (dt: number, t: number, ctx: Ctx, reduced: boolean) => void };
}

/** 首頁「今天會遇到的人」：名牌與衣服顏色（#rrggbb），直接取自場景的 npc 定義 */
export interface CastMember {
  label: string;
  color: string;
}

export const castOf = (def: Pick<SceneDef, "npcs">): CastMember[] =>
  def.npcs.map((n) => ({ label: n.label, color: `#${n.shirt.toString(16).padStart(6, "0")}` }));

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
  /** 方向鍵推著走（沒有路線，但也算在移動） */
  pushed = false;
  constructor(readonly p: Person, readonly speed: number) {}
  get moving(): boolean {
    return this.route.length > 0 || this.pushed;
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

/** 自由走動的速度（單位／秒）與「到達地點」的半徑 */
const MOVE_SPEED = 4;
const NEAR_RADIUS = 1.5;
const GROUND = new Plane(new Vector3(0, 1, 0), -0.1);
const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const SCREEN_DOWN = { x: Math.SQRT1_2, z: Math.SQRT1_2 };

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
  const cam = def.camera;
  const camTarget = cam.target.clone();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  /** 鏡頭方位：水平半徑 14√2、高 13，預設從 45°（+x、+z 之間）看；展示模式在這附近左右擺動 */
  const CAM_RADIUS = Math.hypot(14, 14);
  const CAM_HEIGHT = 13;
  const CAM_BASE_ANGLE = Math.PI / 4;
  let camAngle = CAM_BASE_ANGLE;
  const aimCamera = (): void => {
    camera.position.set(camTarget.x + CAM_RADIUS * Math.sin(camAngle), camTarget.y + CAM_HEIGHT, camTarget.z + CAM_RADIUS * Math.cos(camAngle));
    camera.lookAt(camTarget);
  };
  /** 展示模式（首頁與預測、對照、結算的背景）：鏡頭繞場景中心慢慢擺動，不能走動、不顯示「！」 */
  let showcase = false;
  const showcaseTarget = new Vector3((cam.minX + cam.maxX) / 2, 0.8, (cam.minZ + cam.maxZ) / 2);
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
  const playerTag = tags[0].el;
  for (const n of npcs) addTag(n.def.label, n.def.cls, above(n.w, 2.45), () => n.w.p.root.visible);
  for (const t of def.placeTags) addTag(t.text, "place", () => t.pos.clone());
  // 目標標記：黃色「！」，浮在有待辦的地點上方；每個地點一個，可以點
  interface GoalTag extends Tag {
    id: string;
  }
  let goalTags: GoalTag[] = [];
  let onPick: ((placeId: string) => void) | undefined;

  // 自由走動：格子地圖（沒有 walkable 的場景為 null）
  const grid = def.walkable ? buildGrid(def.walkable, def.blocked ?? []) : null;
  let moveVec = { x: 0, z: 0 };
  /** 外部（app）可關閉自由走動：事件內容顯示時，點地板與方向輸入都不能讓角色走開 */
  let walkEnabled = true;
  let nearbyCb: (() => void) | undefined;
  let nearbyKey = "";

  let size = { w: 0, h: 0 };
  const placeTags = (): void => {
    const w = size.w;
    const h = size.h;
    const placed: { x: number; y: number; hw: number }[] = [];
    for (const g of goalTags) if (showcase) g.el.style.display = "none";
    for (const t of showcase ? tags : [...tags, ...goalTags]) {
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
  let arriveCb: (() => void) | null = null;
  const nearPlace = (p: Place): boolean => {
    const pp = player.p.root.position;
    return Math.hypot(pp.x - p.pos.x, pp.z - p.pos.z) <= NEAR_RADIUS && Math.abs(pp.y - p.pos.y) < 1;
  };
  const nearbyIds = (): string[] => {
    if (arriveCb || player.moving) return [];
    return Object.entries(def.places).filter(([, p]) => nearPlace(p)).map(([id]) => id);
  };

  // 點地板：指標移動 < 8px 才算點擊（拖曳是捲動頁面）
  const raycaster = new Raycaster();
  let down: { x: number; y: number } | null = null;
  const canvas = renderer.domElement;
  if (grid) {
    canvas.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY };
    });
    canvas.addEventListener("pointercancel", () => {
      down = null;
    });
    canvas.addEventListener("pointerup", (ev) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) >= 8 || arriveCb || !active || !walkEnabled || showcase) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ndc = new Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(GROUND, new Vector3());
      if (!hit) return;
      const pp = player.p.root.position;
      const path = findPath(grid, { x: pp.x, z: pp.z }, { x: hit.x, z: hit.z });
      player.route = path.map((q) => new Vector3(q.x, 0, q.z));
    });
  }
  let location: string | undefined;
  let eventId: string | undefined;
  let openIds: ReadonlySet<string> = new Set();
  const visited = new Set<string>();
  let active = true;
  let progress = 0;
  let flags: readonly string[] = [];
  let sunNow = dayLight(0);
  let skyNow = sunNow.sky.clone();

  /** 畫面下方／左側被面板蓋住的大小（px）：鏡頭偏移一半，讓角色留在可見範圍中央 */
  let insets = { bottom: 0, left: 0 };
  const resize = (): void => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    // 寬螢幕（桌機鋪滿）時放寬視野：每單位最多約 50px，不讓方塊放得太大
    const halfW = Math.max(cam.halfW, w / 100);
    const halfH = (halfW * h) / w;
    Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    const dy = Math.min(insets.bottom, h * 0.8) / 2;
    const dx = Math.min(insets.left, w * 0.8) / 2;
    if (dx > 0 || dy > 0) camera.setViewOffset(w, h, -dx, dy, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new Clock();
  let orbitT = 0;
  let raf = 0;
  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!active) return;
    resize();
    const t = clock.elapsedTime;
    const ctx: Ctx = { location, event: eventId, open: openIds, flags, visited };
    if (grid && walkEnabled && !showcase && !arriveCb && (moveVec.x !== 0 || moveVec.z !== 0)) {
      // 方向鍵：取消點地板的路線，按住時以固定速度走，碰到家具沿邊滑動
      player.route = [];
      const len = Math.hypot(moveVec.x, moveVec.z);
      const wx = (SCREEN_RIGHT.x * moveVec.x + SCREEN_DOWN.x * moveVec.z) / len;
      const wz = (SCREEN_RIGHT.z * moveVec.x + SCREEN_DOWN.z * moveVec.z) / len;
      const pos = player.p.root.position;
      const next = slide(grid, { x: pos.x, z: pos.z }, wx * MOVE_SPEED * dt, wz * MOVE_SPEED * dt);
      player.pushed = next.x !== pos.x || next.z !== pos.z;
      if (player.pushed) {
        pos.x = next.x;
        pos.z = next.z;
        player.yaw = Math.atan2(wx, wz);
      }
    } else {
      player.pushed = false;
    }
    player.update(dt, t, !reduced);
    if (arriveCb && !player.moving) {
      const cb = arriveCb;
      arriveCb = null;
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

    if (grid && !showcase) {
      const key = nearbyIds().join(",");
      if (key !== nearbyKey) {
        nearbyKey = key;
        nearbyCb?.();
      }
    }

    // 鏡頭跟著玩家（高度只跟一半，爬上夾層時不會晃太大）
    // 展示模式：看場景中心，鏡頭在 45° 左右各約 30° 之間慢慢擺動（減少動態時靜止）
    const want = showcase
      ? showcaseTarget
      : new Vector3(Math.max(cam.minX, Math.min(cam.maxX, pp.x)), 0.8 + pp.y * 0.5, Math.max(cam.minZ, Math.min(cam.maxZ, pp.z)));
    camTarget.lerp(want, reduced ? 1 : Math.min(1, dt * (showcase ? 1.5 : 3)));
    if (showcase && !reduced) orbitT += dt;
    const wantAngle = showcase && !reduced ? CAM_BASE_ANGLE + 0.52 * Math.sin(orbitT * 0.14) : CAM_BASE_ANGLE;
    camAngle += (wantAngle - camAngle) * (reduced ? 1 : Math.min(1, dt * 2));
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
    setEvents(open, active) {
      openIds = new Set(open);
      eventId = active;
    },
    place(id) {
      const next = def.places[id];
      if (!next || current) return;
      location = id;
      player.p.root.position.copy(next.pos);
      camTarget.set(next.pos.x, 0.8 + next.pos.y * 0.5, next.pos.z);
      for (const n of npcs) if (n.def.follow) n.w.p.root.position.set(next.pos.x + n.def.follow.dx, 0, next.pos.z + n.def.follow.dz);
      visited.add(id);
      current = next;
    },
    setGoals(goals, pick) {
      onPick = pick;
      for (const g of goalTags) g.el.remove();
      goalTags = goals
        .filter((g) => def.places[g.id])
        .map((g) => {
          const place = def.places[g.id];
          const el = document.createElement("button");
          el.type = "button";
          el.className = "tag3d goal";
          el.setAttribute("aria-label", `前往${g.name ?? g.id}（${g.count} 件待辦）`);
          const icon = document.createElement("i");
          icon.textContent = g.count > 1 ? `！${g.count}` : "！";
          el.appendChild(icon);
          el.addEventListener("click", () => onPick?.(g.id));
          overlay.appendChild(el);
          return { id: g.id, el, anchor: () => place.pos.clone().add(new Vector3(0, 2.9, 0)), shown: () => true };
        });
    },
    goTo(id, onArrive) {
      const next = def.places[id];
      if (arriveCb) return;
      if (grid && next && !reduced) {
        // 自由走動的場景：以角色目前的位置找路（角色可能已經走離 current）
        const pp = player.p.root.position;
        if (nearPlace(next) && !player.moving) {
          location = id;
          current = next;
          visited.add(id);
          onArrive?.();
          return;
        }
        location = id;
        current = next;
        player.route = findPath(grid, { x: pp.x, z: pp.z }, { x: next.pos.x, z: next.pos.z }).map((q) => new Vector3(q.x, 0, q.z));
        arriveCb = onArrive ?? (() => undefined);
        return;
      }
      if (!next || !current || (grid ? nearPlace(next) : current === next)) {
        onArrive?.();
        return;
      }
      location = id;
      if (reduced) {
        player.p.root.position.copy(next.pos);
        player.route = [];
        current = next;
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
      if (grid) return !!p && nearPlace(p) && !player.moving && !arriveCb;
      return !!p && current === p && !arriveCb;
    },
    canWalk() {
      return !!grid;
    },
    setWalkEnabled(on) {
      walkEnabled = on;
      if (!on) moveVec = { x: 0, z: 0 };
    },
    setMove(dx, dz) {
      if (!walkEnabled) return;
      moveVec = { x: Math.max(-1, Math.min(1, dx)), z: Math.max(-1, Math.min(1, dz)) };
    },
    nearby: nearbyIds,
    onNearbyChange(cb) {
      nearbyCb = cb;
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
    setInsets(next) {
      const b = Math.max(0, next.bottom ?? 0);
      const l = Math.max(0, next.left ?? 0);
      if (b === insets.bottom && l === insets.left) return;
      insets = { bottom: b, left: l };
      size = { w: 0, h: 0 };
    },
    setShowcase(on) {
      if (on === showcase) return;
      showcase = on;
      if (on) {
        moveVec = { x: 0, z: 0 };
        player.pushed = false;
        if (!arriveCb) player.route = [];
      }
    },
    setPlayerName(name) {
      const n = name.trim();
      playerTag.textContent = n ? def.player.label.replace(/^你/, n) : def.player.label;
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
      // 釋放這個場景自己的貼圖與幾何（共用的方塊幾何與材質留著給下一個場景）
      const shared = new Set<unknown>(mats.values());
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        if (o.geometry !== geo) o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (shared.has(m)) continue;
          (m as MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      overlay.remove();
      goalTags = [];
    },
  };
}
