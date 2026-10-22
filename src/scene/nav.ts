// 場景導航：格子地圖、A* 找路、碰撞滑動。純函式，不依賴 three.js（方便單元測試）。
// 座標與場景相同：x 向右、z 朝向玩家；這裡只看 xz 平面。

export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Pt = { x: number; z: number };

export interface Grid {
  cell: number;
  /** 格子 (0,0) 的左上角（世界座標） */
  ox: number;
  oz: number;
  cols: number;
  rows: number;
  /** 1 = 可站立 */
  free: Uint8Array;
}

/** 點到矩形的最短距離（在矩形內為 0） */
function distToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * 建格子：格子中心在某個可走矩形內，而且離每個障礙矩形至少 radius（角色半徑）才算可站立。
 * 格子範圍取可走矩形的外框，對齊 cell 的倍數。
 */
export function buildGrid(walkable: Rect[], blocked: Rect[], cell = 0.5, radius = 0.3): Grid {
  const minX = Math.min(...walkable.map((r) => r.x0));
  const minZ = Math.min(...walkable.map((r) => r.z0));
  const maxX = Math.max(...walkable.map((r) => r.x1));
  const maxZ = Math.max(...walkable.map((r) => r.z1));
  const ox = Math.floor(minX / cell) * cell;
  const oz = Math.floor(minZ / cell) * cell;
  const cols = Math.ceil((maxX - ox) / cell);
  const rows = Math.ceil((maxZ - oz) / cell);
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + (c + 0.5) * cell;
      const z = oz + (r + 0.5) * cell;
      const inside = walkable.some((w) => x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1);
      if (inside && blocked.every((b) => distToRect(x, z, b) >= radius)) free[r * cols + c] = 1;
    }
  }
  return { cell, ox, oz, cols, rows, free };
}

const cellOf = (g: Grid, x: number, z: number): { c: number; r: number } => ({
  c: Math.floor((x - g.ox) / g.cell),
  r: Math.floor((z - g.oz) / g.cell),
});
const inGrid = (g: Grid, c: number, r: number): boolean => c >= 0 && r >= 0 && c < g.cols && r < g.rows;
const centre = (g: Grid, i: number): Pt => ({ x: g.ox + ((i % g.cols) + 0.5) * g.cell, z: g.oz + (Math.floor(i / g.cols) + 0.5) * g.cell });

/** 這個點所在的格子是否可站立 */
export function isFree(g: Grid, x: number, z: number): boolean {
  const { c, r } = cellOf(g, x, z);
  return inGrid(g, c, r) && g.free[r * g.cols + c] === 1;
}

/** 兩點之間的直線是否都走在可站立的格子上（每 0.02 取樣） */
function lineOfSight(g: Grid, a: Pt, b: Pt): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.02));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!isFree(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

const NEIGHBOURS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** 離 (x,z) 最近的可站立格子（找不到回傳 -1） */
function nearestFree(g: Grid, x: number, z: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < g.free.length; i++) {
    if (!g.free[i]) continue;
    const p = centre(g, i);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/**
 * A*（8 方向，斜走不可切過障礙角）。回傳要依序走的世界座標（不含起點）。
 * 終點不可達（或不在可站立格子上）時，改走到「起點可達範圍內離終點最近」的格子。
 * 路徑再用視線檢查化簡成少數轉折點。
 */
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] {
  const startCell = isFree(g, from.x, from.z) ? (() => { const { c, r } = cellOf(g, from.x, from.z); return r * g.cols + c; })() : nearestFree(g, from.x, from.z);
  if (startCell < 0) return [];
  const toCell = cellOf(g, to.x, to.z);
  const goal = inGrid(g, toCell.c, toCell.r) && g.free[toCell.r * g.cols + toCell.c] ? toCell.r * g.cols + toCell.c : -1;
  const goalPt = goal >= 0 ? centre(g, goal) : to;

  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: { i: number; f: number }[] = [];
  const h = (i: number): number => {
    const p = centre(g, i);
    return Math.hypot(p.x - goalPt.x, p.z - goalPt.z);
  };
  gScore[startCell] = 0;
  open.push({ i: startCell, f: goal >= 0 ? h(startCell) : 0 });
  let reached = -1;
  while (open.length) {
    let k = 0;
    for (let j = 1; j < open.length; j++) if (open[j].f < open[k].f) k = j;
    const { i } = open.splice(k, 1)[0];
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) {
      reached = i;
      break;
    }
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!inGrid(g, nc, nr)) continue;
      const ni = nr * g.cols + nc;
      if (!g.free[ni] || closed[ni]) continue;
      // 不切角：斜走時兩側的格子也必須可站立
      if (dc !== 0 && dr !== 0 && (!g.free[r * g.cols + nc] || !g.free[nr * g.cols + c])) continue;
      const ng = gScore[i] + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        parent[ni] = i;
        open.push({ i: ni, f: ng + (goal >= 0 ? h(ni) : 0) });
      }
    }
  }
  if (reached < 0) {
    // 終點走不到：closed 就是起點能到的全部格子，挑離終點最近的
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!closed[i]) continue;
      const p = centre(g, i);
      const d = Math.hypot(p.x - to.x, p.z - to.z);
      if (d < bd) {
        bd = d;
        reached = i;
      }
    }
  }
  if (reached < 0) return [];

  const cells: number[] = [];
  for (let i = reached; i >= 0; i = parent[i]) cells.push(i);
  cells.reverse();
  const raw: Pt[] = cells.map((i) => centre(g, i));
  raw[0] = { x: from.x, z: from.z };
  // 起點若本來就站在可站立格子上，用真實位置；終點可達時用真實終點
  if (reached === goal) {
    if (raw.length === 1) raw.push({ x: to.x, z: to.z });
    else raw[raw.length - 1] = { x: to.x, z: to.z };
  }

  const out: Pt[] = [];
  let a = 0;
  while (a < raw.length - 1) {
    let b = raw.length - 1;
    while (b > a + 1 && !lineOfSight(g, raw[a], raw[b])) b--;
    out.push(raw[b]);
    a = b;
  }
  return out;
}

/** 移動 (dx,dz)：整段可走就整段走，否則只走 x、只走 z，再不行就留在原地。永遠不進入不可站立的格子 */
export function slide(g: Grid, pos: Pt, dx: number, dz: number): Pt {
  if (isFree(g, pos.x + dx, pos.z + dz)) return { x: pos.x + dx, z: pos.z + dz };
  if (dx !== 0 && isFree(g, pos.x + dx, pos.z)) return { x: pos.x + dx, z: pos.z };
  if (dz !== 0 && isFree(g, pos.x, pos.z + dz)) return { x: pos.x, z: pos.z + dz };
  return { x: pos.x, z: pos.z };
}
