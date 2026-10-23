// 3D 場景共用元件：方塊、角色、浮動名牌、相機、一天的光線、第一人稱。
// 各職業的場景只需提供 SceneDef（地圖、地點、路線、角色），其餘都在這裡。
// 座標：x 向右、z 朝向玩家、y 向上；相機從 (+x, +y, +z) 往下看，所以 +x/+z 側的牆不畫（剖面）。
// 有 firstPerson 的場景（軟體工程師）遊玩時改為第一人稱：透視相機在眼睛高度、地點間漸黑傳送，
// 補上的天花板與牆只在第一人稱顯示，俯瞰（展示）時隱藏，維持剖面。
import {
  AmbientLight,
  HemisphereLight,
  PointLight,
  BoxGeometry,
  CanvasTexture,
  Clock,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { SceneHandle } from "./index";
import {
  aimAt,
  decay,
  dragLook,
  fpFov,
  lerpPose,
  screenCorners,
  screenDistance,
  screenPose,
  segmentBlocked,
  TURN_SPEED,
  viewFor,
  wrapAngle,
  type Aabb,
  type FpScreen,
  type FpView,
  type PxRect,
  type V3,
} from "./fp";

export type ViewMode = "iso" | "first";

export interface Place {
  pos: Vector3;
  /** 區域名稱，路線規劃用（例如房間 id） */
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
  visible: (c: Ctx) => boolean;
}

export interface SceneDef {
  ariaLabel: string;
  world: (w: Group) => void;
  places: Record<string, Place>;
  route: (from: Place, to: Place) => Vector3[];
  player: { label: string; shirt: number; pants: number; hat: number | null };
  npcs: NpcDef[];
  /** 地點標籤；at 是對應的地點 id（第一人稱站在該地點時不顯示自己的標籤） */
  placeTags: { text: string; pos: Vector3; at?: string }[];
  camera: { halfW: number; target: Vector3; minX: number; maxX: number; minZ: number; maxZ: number };
  /** 場景專屬的動態效果；回傳 update，每幀呼叫 */
  extras?: (scene: Scene) => { update: (dt: number, t: number, ctx: Ctx, reduced: boolean) => void };
  /** 第一人稱：各地點的視點，以及只在第一人稱顯示的物件（天花板、補齊的牆、螢幕畫面、門窗） */
  firstPerson?: {
    views: Record<string, FpView>;
    build: (g: Group) => void;
    /** 可以推近的螢幕（v0.12 畫面內任務）：螢幕 id → 位置與大小 */
    screens?: Record<string, FpScreen>;
    /** 哪些任務顯示在哪個螢幕：investigate＝在這個地點查資料／小遊戲（地點 id → 螢幕 id）；events＝事件 id → 螢幕 id */
    taskScreens?: { investigate?: Record<string, string>; events?: Record<string, string> };
    /** 第一人稱的補光（只在第一人稱開啟；不投影子） */
    lights?: { color: number; intensity: number; distance: number; pos: V3 }[];
  };
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
  m.userData.isoOnly = true; // 地面字是為俯瞰角度排的，第一人稱時隱藏
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

/** 俯瞰時「到達地點」的半徑 */
const NEAR_RADIUS = 1.5;

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
  /** 展示模式（首頁與預測、對照、結算的背景）：鏡頭繞場景中心慢慢擺動、不顯示「！」 */
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

  // 第一人稱：透視相機、只在第一人稱顯示的物件（不投影子，免得天花板把室內蓋暗）、俯瞰專用物件
  const fp = def.firstPerson;
  const pcam = new PerspectiveCamera(64, 1, 0.05, 80);
  pcam.rotation.order = "YXZ";
  const fpGroup = new Group();
  if (fp) {
    fp.build(fpGroup);
    fpGroup.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = false;
    });
    fpGroup.visible = false;
    scene.add(fpGroup);
  }
  // 第一人稱的補光（v0.12）：天空／地面的半球光，加上場景指定的幾盞點光；不投影子，手機也跑得動
  const fpLights: Object3D[] = [];
  if (fp) {
    fpLights.push(new HemisphereLight(0xe4eefa, 0x8a6f55, 0.6));
    for (const l of fp.lights ?? []) {
      const pl = new PointLight(l.color, l.intensity, l.distance, 2);
      pl.position.set(l.pos[0], l.pos[1], l.pos[2]);
      fpLights.push(pl);
    }
    for (const o of fpLights) {
      o.visible = false;
      scene.add(o);
    }
  }
  // 會擋住名牌的大方塊（牆）：高 ≥ 2 且寬或深 ≥ 2，或標了 userData.occluder；第一人稱時名牌被擋住就不顯示
  const occluders: Aabb[] = [];
  const collectOccluders = (g: Group): void =>
    g.traverse((o) => {
      if (!(o instanceof Mesh) || o.geometry !== geo) return;
      const { x: w, y: h, z: d } = o.scale;
      if (!o.userData.occluder && !(h >= 2 && Math.max(w, d) >= 2)) return;
      const p = o.position;
      occluders.push({ min: [p.x - w / 2, p.y - h / 2, p.z - d / 2], max: [p.x + w / 2, p.y + h / 2, p.z + d / 2] });
    });
  collectOccluders(world);
  if (fp) collectOccluders(fpGroup);
  const isoOnly: Object3D[] = [];
  world.traverse((o) => {
    if (o.userData.isoOnly) isoOnly.push(o);
  });
  /** mode：目前要的視角（app 設定）；camMode：實際在畫的相機（漸黑到一半才切換） */
  let mode: ViewMode = "iso";
  let camMode: ViewMode = "iso";
  let yaw = 0;
  let pitch = 0;
  let yawVel = 0;
  let turn = 0;
  /** 轉向某個朝向（事件換了、看向事件的人）；使用者一動就取消 */
  let aimWant: { yaw: number; pitch: number } | null = null;
  let aimedEvent: string | undefined;
  /** 漸黑傳送途中（還沒到新地點）：at() 為 false */
  let teleporting = false;
  let disposed = false;
  let fadeBusy: Promise<void> | null = null;
  // 畫面內任務（v0.12）：鏡頭推近某個螢幕（座位的電腦、茶水間的電視），推近時不能環顧
  type Pose = { pos: V3; yaw: number; pitch: number };
  /** 目前要推近的螢幕（null：沒有推近，或正在拉回） */
  let focusId: string | null = null;
  let focusAnim: { from: Pose; to: Pose; t: number; resolve: () => void; promise: Promise<void> } | null = null;
  let rectCb: ((r: PxRect | null) => void) | undefined;
  let rectKey = "";
  let focusKey = "";
  const activeCam = (): OrthographicCamera | PerspectiveCamera => (camMode === "first" ? pcam : camera);

  const player = new Walker(makePerson(def.player.shirt, def.player.pants, def.player.hat), 5);
  scene.add(player.p.root);

  const npcs = def.npcs.map((n) => {
    const w = new Walker(makePerson(n.shirt, n.pants, n.hat), 0);
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
  // 漸黑：蓋在畫布與名牌上、面板下面（CSS 控制 0.4 秒的透明度轉場；減少動態時直接切換）
  const fadeEl = document.createElement("div");
  fadeEl.className = "stage-fade";
  fadeEl.setAttribute("aria-hidden", "true");
  host.appendChild(fadeEl);
  interface Tag {
    el: HTMLElement;
    anchor: () => Vector3;
    shown: () => boolean;
    /** 第一人稱時被牆擋住就不顯示（人名與地點標籤；「！」不受影響） */
    occludable?: boolean;
    /** 地點標籤對應的地點：第一人稱站在這裡時不顯示 */
    at?: string;
  }
  const tags: Tag[] = [];
  const addTag = (text: string, cls: string, anchor: () => Vector3, shown: () => boolean = () => true, extra: Partial<Tag> = {}): void => {
    const el = document.createElement("span");
    el.className = `tag3d ${cls}`;
    el.textContent = text;
    overlay.appendChild(el);
    tags.push({ el, anchor, shown, ...extra });
  };
  const above = (w: Walker, h: number) => (): Vector3 => w.p.root.position.clone().add(new Vector3(0, h + w.p.body.position.y, 0));
  addTag(def.player.label, "me", above(player, 2.55), () => camMode !== "first");
  const playerTag = tags[0].el;
  for (const n of npcs) addTag(n.def.label, n.def.cls, above(n.w, 2.45), () => n.w.p.root.visible, { occludable: true });
  for (const t of def.placeTags) addTag(t.text, "place", () => t.pos.clone(), () => true, { occludable: true, at: t.at });
  // 目標標記：黃色「！」，浮在有待辦的地點上方；每個地點一個，可以點
  interface GoalTag extends Tag {
    id: string;
  }
  let goalTags: GoalTag[] = [];
  let onPick: ((placeId: string) => void) | undefined;

  let nearbyCb: (() => void) | undefined;
  let nearbyKey = "";

  let size = { w: 0, h: 0 };
  const placeTags = (): void => {
    const w = size.w;
    const h = size.h;
    const placed: { x: number; y: number; hw: number }[] = [];
    for (const g of goalTags) if (showcase) g.el.style.display = "none";
    const c = activeCam();
    const first = camMode === "first";
    // 鏡頭推近螢幕時（畫面內任務）不顯示任何名牌，免得蓋住任務
    const focusing = first && (focusId !== null || focusAnim !== null);
    const eye: V3 = [pcam.position.x, pcam.position.y, pcam.position.z];
    for (const t of showcase ? tags : [...tags, ...goalTags]) {
      const a = t.anchor();
      // 第一人稱：站在這個地點時不顯示自己的地點標籤；被牆擋住的名牌不顯示
      const hiddenFp = first && (focusing || (!!t.at && t.at === location) || (!!t.occludable && segmentBlocked(eye, [a.x, a.y, a.z], occluders)));
      // 透視相機：在鏡頭後面的點投影會翻到前面，先排除
      const front = !first || a.clone().applyMatrix4(c.matrixWorldInverse).z < -0.1;
      const v = a.project(c);
      const x = (v.x * 0.5 + 0.5) * w;
      let y = (-v.y * 0.5 + 0.5) * h;
      const on = !hiddenFp && front && t.shown() && v.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
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
    if (mode === "first") return teleporting || !location ? [] : [location];
    if (arriveCb || player.moving) return [];
    return Object.entries(def.places).filter(([, p]) => nearPlace(p)).map(([id]) => id);
  };

  const raycaster = new Raycaster();
  const canvas = renderer.domElement;
  let location: string | undefined;
  let eventId: string | undefined;
  let openIds: ReadonlySet<string> = new Set();
  const visited = new Set<string>();
  let active = true;
  let progress = 0;
  let flags: readonly string[] = [];
  let sunNow = dayLight(0);
  let skyNow = sunNow.sky.clone();

  // ── 第一人稱：視角切換、漸黑傳送、環顧 ──
  const FADE_MS = 400;
  const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
  const applyVis = (): void => {
    const first = camMode === "first";
    fpGroup.visible = first;
    for (const o of fpLights) o.visible = first;
    ambient.intensity = first ? 0.55 : 0.75;
    for (const o of isoOnly) o.visible = !first;
    player.p.root.visible = !first;
    canvas.style.touchAction = first ? "none" : "";
    canvas.style.cursor = first ? "grab" : "";
  };
  /** 切換漸黑層並等轉場結束（transitionend；裝置很慢、轉場晚開始時也等到全黑），最多等 FADE_MS + 400 */
  const fadeStep = (on: boolean): Promise<void> =>
    new Promise((resolve) => {
      void fadeEl.offsetWidth; // 先算好目前樣式，轉場立刻開始
      fadeEl.classList.toggle("on", on);
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        fadeEl.removeEventListener("transitionend", finish);
        resolve();
      };
      fadeEl.addEventListener("transitionend", finish);
      window.setTimeout(finish, FADE_MS + 400);
    });
  /** 漸黑 → mid()（切換／傳送）→ 漸亮；減少動態時直接呼叫 mid()。同時只跑一個，後來的排在後面 */
  const runFade = (mid: () => void): Promise<void> => {
    if (fadeBusy) return fadeBusy.then(() => runFade(mid));
    if (reduced) {
      mid();
      return Promise.resolve();
    }
    const job = (async () => {
      await fadeStep(true);
      if (disposed) return;
      mid();
      await wait(80); // 黑畫面停一下，讓新地點先畫好
      await fadeStep(false);
    })();
    fadeBusy = job.finally(() => {
      fadeBusy = null;
    });
    return fadeBusy;
  };
  /** 依視點與事件算出要看的方向 */
  const viewNow = (id: string | undefined, ev: string | undefined) => {
    const v = fp ? viewFor(fp.views, id, ev) : null;
    if (v) return v;
    const p = id ? def.places[id] : undefined;
    const pos = p ? ([p.pos.x, p.pos.y + 1.6, p.pos.z] as const) : ([0, 1.6, 0] as const);
    return { pos, look: [pos[0], pos[1], pos[2] - 1] as const };
  };
  /** 站到地點的視點（傳送的瞬間） */
  const enterView = (id: string, ev: string | undefined): void => {
    const p = def.places[id];
    if (!p) return;
    location = id;
    current = p;
    visited.add(id);
    player.route = [];
    player.p.root.position.copy(p.pos);
    camTarget.set(p.pos.x, 0.8 + p.pos.y * 0.5, p.pos.z);
    const v = viewNow(id, ev);
    pcam.position.set(v.pos[0], v.pos[1], v.pos[2]);
    ({ yaw, pitch } = aimAt(v.pos, v.look));
    yawVel = 0;
    aimWant = null;
    aimedEvent = ev;
    // 傳送時還要推近螢幕（例如重新整理後回到小遊戲）：直接定位，不做推近動畫
    finishFocusAnim();
    if (focusId) {
      const tp = focusTarget(focusId);
      if (tp) applyPose(tp);
    }
  };
  /** 在同一個地點轉向事件（例如在座位區選了另一件事）；減少動態時直接轉過去 */
  const faceEvent = (ev: string | undefined): void => {
    if (camMode !== "first" || teleporting || ev === aimedEvent) return;
    aimedEvent = ev;
    if (!ev) return;
    const v = viewNow(location, ev);
    const want = aimAt([pcam.position.x, pcam.position.y, pcam.position.z], v.look);
    if (reduced) ({ yaw, pitch } = want);
    else aimWant = want;
  };
  const setMode = (m: ViewMode): void => {
    if (m === "first" && !fp) return;
    if (m === mode) return;
    mode = m;
    turn = 0;
    if (m === "iso") {
      focusId = null;
      finishFocusAnim();
      camMode = "iso";
      applyVis();
      return;
    }
    void runFade(() => {
      if (mode !== "first") return;
      camMode = "first";
      if (location) enterView(location, eventId);
      applyVis();
    });
  };
  const fadeTo = (id: string, opts?: { eventId?: string }): Promise<void> => {
    const next = def.places[id];
    if (!next) return Promise.resolve();
    const ev = opts?.eventId ?? eventId;
    if (mode !== "first") return new Promise((r) => goTo(id, r));
    if (current === next && !teleporting) {
      faceEvent(ev);
      return Promise.resolve();
    }
    teleporting = true;
    return runFade(() => {
      teleporting = false;
      if (mode !== "first") return; // 漸黑途中回到俯瞰（例如回選單）：不再切成第一人稱
      enterView(id, ev);
      if (camMode !== "first") {
        camMode = "first";
        applyVis();
      }
    });
  };

  // ── 畫面內任務：推近螢幕／拉回 ──
  const FOCUS_MS = 650;
  const applyPose = (p: Pose): void => {
    pcam.position.set(p.pos[0], p.pos[1], p.pos[2]);
    yaw = p.yaw;
    pitch = p.pitch;
  };
  const visibleSize = (): { vw: number; vh: number } => ({
    vw: size.w - Math.min(insets.left, size.w * 0.8),
    vh: size.h - Math.min(insets.top + insets.bottom, size.h * 0.8),
  });
  /** 推近螢幕後的姿勢：依目前可見範圍（扣掉 HUD 與對話框）算距離 */
  const focusTarget = (id: string): Pose | null => {
    const sc = fp?.screens?.[id];
    if (!sc) return null;
    const { vw, vh } = visibleSize();
    return screenPose(sc, screenDistance(sc, vw, vh));
  };
  /** 沒推近時的姿勢：地點的視點，看向目前的事件 */
  const homePose = (): Pose => {
    const v = viewNow(location, aimedEvent);
    return { pos: v.pos, ...aimAt(v.pos, v.look) };
  };
  function finishFocusAnim(): void {
    const a = focusAnim;
    focusAnim = null;
    a?.resolve();
  }
  const focusScreen = (want: string | null): Promise<void> => {
    const id = want && fp?.screens?.[want] ? want : null;
    if (id === focusId) return focusAnim ? focusAnim.promise : Promise.resolve();
    focusId = id;
    finishFocusAnim();
    // 還沒進第一人稱（漸黑途中）：到了視點（enterView）時直接定位
    if (camMode !== "first") return Promise.resolve();
    const to = id ? focusTarget(id) : homePose();
    if (!to) return Promise.resolve();
    yawVel = 0;
    aimWant = null;
    look = null;
    if (reduced) {
      applyPose(to);
      return Promise.resolve();
    }
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    focusAnim = { from: { pos: [pcam.position.x, pcam.position.y, pcam.position.z], yaw, pitch }, to, t: 0, resolve, promise };
    return promise;
  };

  // 拖曳環顧（滑鼠、觸控）；移動不到 8px 算點擊：點到人，就選那個地點的事件（同點「！」）
  let look: { id: number; x: number; y: number; sx: number; sy: number; t: number } | null = null;
  const pickPerson = (ev: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !onPick) return;
    const ndc = new Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, pcam);
    const shown = npcs.filter((n) => n.w.p.root.visible);
    const hit = raycaster.intersectObjects(shown.map((n) => n.w.p.root), true)[0];
    if (!hit) return;
    const who = shown.find((n) => {
      let o: Object3D | null = hit.object;
      while (o && o !== n.w.p.root) o = o.parent;
      return !!o;
    });
    if (!who) return;
    const np = who.w.p.root.position;
    const near = Object.entries(def.places).sort(([, a], [, b]) => a.pos.distanceTo(np) - b.pos.distanceTo(np))[0]?.[0];
    if (near && goalTags.some((g) => g.id === near)) onPick(near);
  };
  if (fp) {
    canvas.addEventListener("pointerdown", (ev) => {
      if (camMode !== "first" || showcase || !active || focusId || focusAnim) return;
      look = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now() };
      yawVel = 0;
      aimWant = null;
      canvas.setPointerCapture?.(ev.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!look || ev.pointerId !== look.id) return;
      const now = performance.now();
      const before = yaw;
      ({ yaw, pitch } = dragLook(yaw, pitch, ev.clientX - look.x, ev.clientY - look.y));
      const dt = Math.max(1, now - look.t) / 1000;
      yawVel = yawVel * 0.5 + (wrapAngle(yaw - before) / dt) * 0.5;
      look.x = ev.clientX;
      look.y = ev.clientY;
      look.t = now;
    });
    const endLook = (ev: PointerEvent, tap: boolean): void => {
      if (!look || ev.pointerId !== look.id) return;
      const moved = Math.hypot(ev.clientX - look.sx, ev.clientY - look.sy);
      // 停住一下才放開就沒有慣性；減少動態時一律沒有
      if (reduced || performance.now() - look.t > 80) yawVel = 0;
      look = null;
      canvas.style.cursor = camMode === "first" ? "grab" : "";
      if (tap && moved < 8) {
        yawVel = 0;
        pickPerson(ev);
      }
    };
    canvas.addEventListener("pointerup", (ev) => endLook(ev, true));
    canvas.addEventListener("pointercancel", (ev) => endLook(ev, false));
  }

  /** 畫面下方／左側被面板蓋住的大小（px）：鏡頭偏移一半，讓角色留在可見範圍中央 */
  let insets = { bottom: 0, left: 0, top: 0 };
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
    // 上方 HUD 與下方對話框：可見範圍的中心 = 畫面中心往上（下方蓋得多）或往下（上方蓋得多）
    const vCover = Math.min(insets.bottom + insets.top, h * 0.8);
    const dy = insets.bottom + insets.top > 0 ? (vCover * (insets.bottom - insets.top)) / (insets.bottom + insets.top) / 2 : 0;
    const dx = Math.min(insets.left, w * 0.8) / 2;
    if (dx !== 0 || dy !== 0) camera.setViewOffset(w, h, -dx, dy, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    // 透視相機：同樣偏移，視野依「看得到的範圍」計算（手機直向時以水平視野為準）
    pcam.aspect = w / h;
    pcam.fov = fpFov(w, h, insets.left, insets.bottom, undefined, insets.top);
    if (dx !== 0 || dy !== 0) pcam.setViewOffset(w, h, -dx, dy, w, h);
    else pcam.clearViewOffset();
    pcam.updateProjectionMatrix();
    // 推近螢幕時視窗大小或遮蓋範圍變了：重新對準
    if (camMode === "first" && focusId && !focusAnim) {
      const tp = focusTarget(focusId);
      if (tp) applyPose(tp);
    }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function goTo(id: string, onArrive?: () => void): void {
    const next = def.places[id];
    if (mode === "first") {
      // 第一人稱：漸黑傳送；減少動態時直接到
      if (reduced) {
        if (next) enterView(id, eventId);
        onArrive?.();
        return;
      }
      void fadeTo(id).then(() => onArrive?.());
      return;
    }
    if (arriveCb) return;
    if (!next || !current || current === next) {
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
  }

  /** 推近完成時，把螢幕投影到畫面上的矩形告訴 app（改變時才通知）；畫布的 data-screen／data-focus 供自動化測試讀取 */
  const updateScreenRect = (): void => {
    let rect: PxRect | null = null;
    const sc = focusId ? fp?.screens?.[focusId] : undefined;
    if (camMode === "first" && sc && !focusAnim) {
      const pts = screenCorners(sc).map((c) => new Vector3(c[0], c[1], c[2]));
      if (pts.every((q) => q.clone().applyMatrix4(pcam.matrixWorldInverse).z < -0.02)) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const q of pts) {
          q.project(pcam);
          xs.push((q.x * 0.5 + 0.5) * size.w);
          ys.push((-q.y * 0.5 + 0.5) * size.h);
        }
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        rect = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }
    }
    const fk = focusId ? `${focusId} ${focusAnim ? "moving" : camMode === "first" ? "in" : "wait"}` : focusAnim ? "returning" : "";
    if (fk !== focusKey) {
      focusKey = fk;
      canvas.dataset.focus = fk;
    }
    const key = rect ? `${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.w)} ${Math.round(rect.h)}` : "";
    if (key !== rectKey) {
      rectKey = key;
      canvas.dataset.screen = key;
      rectCb?.(rect);
    }
  };

  let lastView = "";
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
      if (fp) {
        // 第一人稱：附近（3.5 以內）的人轉頭面向你；遠了或回到俯瞰時轉回原本的方向
        const np = n.w.p.root.position;
        const cp = pcam.position;
        const close = camMode === "first" && Math.hypot(cp.x - np.x, cp.z - np.z) < 3.5;
        const wantYaw = close ? Math.atan2(cp.x - np.x, cp.z - np.z) : (n.def.yaw ?? 0);
        const diff = wrapAngle(wantYaw - n.w.p.body.rotation.y);
        n.w.p.body.rotation.y += reduced ? diff : diff * Math.min(1, dt * 6);
      }
    }
    extras?.update(dt, t, ctx, reduced);

    if (!showcase) {
      const key = nearbyIds().join(",");
      if (key !== nearbyKey) {
        nearbyKey = key;
        nearbyCb?.();
      }
    }

    // 俯瞰時鏡頭跟著玩家（高度只跟一半）
    // 展示模式：看場景中心，鏡頭在 45° 左右各約 30° 之間慢慢擺動（減少動態時靜止）
    const want = showcase
      ? showcaseTarget
      : new Vector3(Math.max(cam.minX, Math.min(cam.maxX, pp.x)), 0.8 + pp.y * 0.5, Math.max(cam.minZ, Math.min(cam.maxZ, pp.z)));
    camTarget.lerp(want, reduced ? 1 : Math.min(1, dt * (showcase ? 1.5 : 3)));
    if (showcase && !reduced) orbitT += dt;
    const wantAngle = showcase && !reduced ? CAM_BASE_ANGLE + 0.52 * Math.sin(orbitT * 0.14) : CAM_BASE_ANGLE;
    camAngle += (wantAngle - camAngle) * (reduced ? 1 : Math.min(1, dt * 2));
    aimCamera();
    if (camMode === "first" && focusAnim) {
      // 推近／拉回：在兩個姿勢之間緩入緩出
      focusAnim.t += dt * 1000;
      const k = Math.min(1, focusAnim.t / FOCUS_MS);
      applyPose(lerpPose(focusAnim.from, focusAnim.to, k));
      if (k >= 1) finishFocusAnim();
      pcam.rotation.set(pitch, yaw, 0);
    } else if (camMode === "first" && focusId) {
      // 推近後停住：不能環顧
      pcam.rotation.set(pitch, yaw, 0);
    } else if (camMode === "first") {
      if (turn !== 0) {
        yaw = wrapAngle(yaw - turn * TURN_SPEED * dt);
        aimWant = null;
      } else if (!look && yawVel !== 0) {
        yaw = wrapAngle(yaw + yawVel * dt);
        yawVel = decay(yawVel, dt);
      }
      if (aimWant) {
        const dy = wrapAngle(aimWant.yaw - yaw);
        const dp = aimWant.pitch - pitch;
        const k2 = Math.min(1, dt * 4);
        yaw = wrapAngle(yaw + dy * k2);
        pitch += dp * k2;
        if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) aimWant = null;
      }
      pcam.rotation.set(pitch, yaw, 0);
    }

    const light = dayLight(progress);
    const k = Math.min(1, dt * 2.5);
    sunNow.sun.lerp(light.sun, k);
    skyNow.lerp(light.sky, k);
    sunNow.intensity += (light.intensity - sunNow.intensity) * k;
    sun.color.copy(sunNow.sun);
    sun.intensity = sunNow.intensity;
    renderer.setClearColor(skyNow);
    renderer.render(scene, activeCam());
    placeTags();
    updateScreenRect();
    // 視角狀態寫在畫布的 data-view（自動化測試與除錯用；只在改變時寫入）："iso" 或 "first 眼高 yaw pitch x z"
    const view = camMode === "first" ? `first ${pcam.position.y.toFixed(2)} ${yaw.toFixed(2)} ${pitch.toFixed(2)} ${pcam.position.x.toFixed(2)} ${pcam.position.z.toFixed(2)}` : "iso";
    if (view !== lastView) {
      lastView = view;
      canvas.dataset.view = view;
    }
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
    goTo,
    at(id) {
      const p = id ? def.places[id] : undefined;
      if (mode === "first") return !!p && current === p && !teleporting;
      return !!p && current === p && !arriveCb;
    },
    hasFirstPerson() {
      return !!fp;
    },
    setViewMode: setMode,
    viewMode() {
      return mode;
    },
    fadeTo,
    setTurn(dir) {
      turn = camMode === "first" ? Math.max(-1, Math.min(1, dir)) : 0;
      if (turn !== 0) yawVel = 0;
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
      const t = Math.max(0, next.top ?? 0);
      if (b === insets.bottom && l === insets.left && t === insets.top) return;
      insets = { bottom: b, left: l, top: t };
      size = { w: 0, h: 0 };
    },
    screenFor(loc, ev, investigating) {
      const ts = fp?.taskScreens;
      if (!ts) return null;
      const byEvent = ev ? ts.events?.[ev] : undefined;
      if (byEvent && fp?.screens?.[byEvent]) return byEvent;
      const byPlace = investigating && loc ? ts.investigate?.[loc] : undefined;
      return byPlace && fp?.screens?.[byPlace] ? byPlace : null;
    },
    focusScreen,
    focusedScreen() {
      return focusId;
    },
    onScreenRect(cb) {
      rectCb = cb;
      rectKey = "\u0000"; // 下一幀一定通知一次
    },
    setShowcase(on) {
      if (on) {
        setMode("iso");
        look = null;
      }
      if (on === showcase) return;
      showcase = on;
      if (on && !arriveCb) player.route = [];
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
      disposed = true;
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
      fadeEl.remove();
      goalTags = [];
    },
  };
}
