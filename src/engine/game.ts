// 遊戲狀態機：predict → play → compare → result。純函式，方便測試。
//
// 事件依陣列順序進行，但同一個 `group` 的事件會「同時開放」：玩家可以用任意順序處理。
// 一個群組在「沒有任何已符合前置旗標、又還沒做的事件」時結束，沒做到的事件就被略過。
import {
  CATEGORIES,
  STATS,
  TRAITS,
  type Career,
  INSPECT_MINUTES,
  TRAVEL_MINUTES,
  choiceMinutes,
  deadlineSpec,
  isAvailable as eventAvailable,
  type Category,
  type Choice,
  type GameEvent,
  type Interrupt,
  type StatusBadge,
  type Stat,
  type Trait,
} from "../../content/schema";

export type Phase = "predict" | "play" | "compare" | "result";

export interface LogEntry {
  eventId: string;
  choiceIndex: number;
}

export interface GameState {
  careerId: string;
  phase: Phase;
  prediction: Record<Category, number>;
  /** 目前群組的第一個事件索引（在 career.events 中） */
  cursor: number;
  /** 已處理完的事件 id */
  done: string[];
  /** 玩家選來處理的事件（同時有多件待辦時才會有值） */
  active: string | null;
  /** 剛選完選項、正在顯示結果敘述的事件（interrupt 為 true 表示是打斷事件） */
  pendingOutcome: { eventId: string; choiceIndex: number; interrupt?: boolean } | null;
  /** 目前群組已花掉的遊戲分鐘（只在有時限的群組累計，換群組歸零） */
  used: number;
  /** 這個群組裡上一個處理事件的地點，用來算移動時間（換群組歸零） */
  at: string | null;
  /** 剛剛來不及處理的事件 id，等玩家看過「時間到」畫面 */
  expired: string[] | null;
  /** 已打開的資料卡，格式 `事件id:卡片id` */
  inspected: string[];
  stats: Record<Stat, number>;
  traits: Record<Trait, number>;
  flags: string[];
  log: LogEntry[];
}

export const INITIAL_STATS: Record<Stat, number> = { energy: 80, time: 80, trust: 60 };

const zeroTraits = (): Record<Trait, number> =>
  Object.fromEntries(TRAITS.map((t) => [t, 0])) as Record<Trait, number>;

export const evenPrediction = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 20])) as Record<Category, number>;

export function newGame(career: Career): GameState {
  return {
    careerId: career.id,
    phase: "predict",
    prediction: evenPrediction(),
    cursor: 0,
    done: [],
    active: null,
    pendingOutcome: null,
    used: 0,
    at: null,
    expired: null,
    inspected: [],
    stats: { ...INITIAL_STATS },
    traits: zeroTraits(),
    flags: [],
    log: [],
  };
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** 事件這局是否會出現（requires 全符合，且 requiresAny 至少一個符合） */
export function isAvailable(e: GameEvent, flags: readonly string[]): boolean {
  return eventAvailable(e, flags);
}

/** 從 start 起，同一個 group 的事件連續到哪裡結束（不含） */
function groupEnd(career: Career, start: number): number {
  const g = career.events[start].group;
  if (!g) return start + 1;
  let i = start + 1;
  while (i < career.events.length && career.events[i].group === g) i++;
  return i;
}

/** 目前群組裡還能做的事件（沒做過、前置旗標已符合） */
export function openEvents(career: Career, s: GameState): GameEvent[] {
  if (s.phase !== "play" || s.cursor >= career.events.length) return [];
  return career.events
    .slice(s.cursor, groupEnd(career, s.cursor))
    .filter((e) => !s.done.includes(e.id) && isAvailable(e, s.flags));
}

/** 把游標推進到下一個還有事可做的群組；全部結束就進入對照 */
function settle(career: Career, s: GameState): GameState {
  let cursor = s.cursor;
  while (cursor < career.events.length) {
    const end = groupEnd(career, cursor);
    const hasOpen = career.events.slice(cursor, end).some((e) => !s.done.includes(e.id) && isAvailable(e, s.flags));
    if (hasOpen) break;
    cursor = end;
  }
  const sameGroup = cursor === s.cursor;
  const used = sameGroup ? s.used : 0;
  const at = sameGroup ? s.at : null;
  return cursor >= career.events.length ? { ...s, cursor, used, at, active: null, phase: "compare" } : { ...s, cursor, used, at };
}

/** 目前畫面上的事件；同時有多件待辦、還沒選時為 null */
export function currentEvent(career: Career, s: GameState): GameEvent | null {
  if (s.phase !== "play") return null;
  const po = s.pendingOutcome;
  const id = po && !po.interrupt ? po.eventId : s.active;
  if (id) return career.events.find((e) => e.id === id) ?? null;
  const open = openEvents(career, s);
  return open.length === 1 ? open[0] : null;
}

/** 把預測正規化成加總 100 的整數（最大餘數法） */
export function normalize(pred: Record<Category, number>): Record<Category, number> {
  const total = CATEGORIES.reduce((a, c) => a + Math.max(0, pred[c]), 0);
  if (total === 0) return evenPrediction();
  const raw = CATEGORIES.map((c) => (Math.max(0, pred[c]) / total) * 100);
  const floor = raw.map(Math.floor);
  let rest = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floor[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest-- <= 0) break;
    floor[i]++;
  }
  return Object.fromEntries(CATEGORIES.map((c, i) => [c, floor[i]])) as Record<Category, number>;
}

export function submitPrediction(career: Career, s: GameState, pred: Record<Category, number>): GameState {
  return settle(career, { ...s, prediction: normalize(pred), phase: "play", cursor: 0, done: [], active: null, pendingOutcome: null, used: 0, at: null, expired: null, inspected: [] });
}

/** 同時有多件待辦時，選一件來處理 */
export function selectEvent(career: Career, s: GameState, eventId: string): GameState {
  if (s.pendingOutcome) throw new Error("請先看完目前的結果");
  if (!openEvents(career, s).some((e) => e.id === eventId)) throw new Error(`事件 ${eventId} 現在不能處理`);
  return { ...s, active: eventId };
}

/** 套用一個選項（或來不及的後果）的資源、特質與旗標 */
function applyOutcome(s: GameState, effects: Partial<Record<Stat, number>>, traits: Partial<Record<Trait, number>>, setFlags: string[] = []): GameState {
  const stats = { ...s.stats };
  for (const k of STATS) stats[k] = clamp(stats[k] + (effects[k] ?? 0));
  const t = { ...s.traits };
  for (const k of TRAITS) t[k] += traits[k] ?? 0;
  return { ...s, stats, traits: t, flags: [...new Set([...s.flags, ...setFlags])] };
}

/**
 * 目前群組的時限（分鐘）；沒有時限回傳 null。
 * 時限 = 基本值 + 這局有出現（前置旗標已符合）的條件事件的加時。
 */
export function deadlineOf(career: Career, s: GameState): number | null {
  if (s.phase !== "play" || s.cursor >= career.events.length) return null;
  const g = career.events[s.cursor].group;
  const raw = g ? career.deadlines?.[g] : undefined;
  if (raw === undefined) return null;
  const { base, extra } = deadlineSpec(raw);
  const members = career.events.slice(s.cursor, groupEnd(career, s.cursor));
  return base + members.reduce((a, e) => a + (extra[e.id] !== undefined && isAvailable(e, s.flags) ? extra[e.id] : 0), 0);
}

/** 剩餘分鐘；沒有時限回傳 null（可能為負，代表已超時） */
export function remainingMinutes(career: Career, s: GameState): number | null {
  const dl = deadlineOf(career, s);
  return dl === null ? null : dl - s.used;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const formatClock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 時鐘（分鐘）：有時限的群組 = 群組起始時間 + 已花費分鐘；否則 null */
export function clockMinutes(career: Career, s: GameState): number | null {
  return deadlineOf(career, s) === null ? null : toMin(career.events[s.cursor].time) + s.used;
}

/** 目前畫面上的打斷事件（等玩家回應，或正在顯示它的結果）；沒有則 null */
export function currentInterrupt(career: Career, s: GameState): Interrupt | null {
  if (s.phase !== "play") return null;
  const list = career.interrupts ?? [];
  const po = s.pendingOutcome;
  if (po?.interrupt) return list.find((i) => i.id === po.eventId) ?? null;
  if (po) return null;
  const e = currentEvent(career, s);
  if (!e) return null;
  return list.find((i) => i.during === e.id && !s.done.includes(i.id) && (i.requires ?? []).every((f) => s.flags.includes(f))) ?? null;
}

/** 查資料是否完成：沒有查資料的事件視為完成；有關的卡都打開了才算 */
export function investigationDone(_career: Career, s: GameState, e: GameEvent): boolean {
  return (e.investigate?.items ?? []).every((it) => !it.relevant || s.inspected.includes(`${e.id}:${it.id}`));
}

/** 打開一張資料卡：記錄並扣時間（只在有時限的群組）；不能重複打開 */
export function inspect(career: Career, s: GameState, itemId: string): GameState {
  const e = currentEvent(career, s);
  if (!e?.investigate || s.pendingOutcome) throw new Error("目前沒有可查的資料");
  if (currentInterrupt(career, s)) throw new Error("請先處理打斷事件");
  if (!e.investigate.items.some((it) => it.id === itemId)) throw new Error(`資料 ${itemId} 不存在`);
  const key = `${e.id}:${itemId}`;
  if (s.inspected.includes(key)) throw new Error("這份資料已經看過了");
  const used = deadlineOf(career, s) !== null ? s.used + INSPECT_MINUTES : s.used;
  return { ...s, inspected: [...s.inspected, key], used };
}

export function choose(career: Career, s: GameState, choiceIndex: number): GameState {
  const e = currentEvent(career, s);
  if (!e || s.pendingOutcome) throw new Error("目前沒有可選擇的事件");
  if (currentInterrupt(career, s)) throw new Error("請先處理打斷事件");
  if (!investigationDone(career, s, e)) throw new Error("請先查完資料");
  const ch: Choice | undefined = e.choices[choiceIndex];
  if (!ch) throw new Error(`選項 ${choiceIndex} 不存在`);
  const travel = s.at && e.location && s.at !== e.location ? TRAVEL_MINUTES : 0;
  const used = deadlineOf(career, s) !== null ? s.used + choiceMinutes(ch) + travel : s.used;
  return {
    ...applyOutcome(s, ch.effects, ch.traits, ch.setFlags),
    log: [...s.log, { eventId: e.id, choiceIndex }],
    done: [...s.done, e.id],
    active: e.id,
    used,
    at: e.location ?? s.at,
    pendingOutcome: { eventId: e.id, choiceIndex },
  };
}

/** 回應打斷事件（兩個選項都有代價）；看完結果後回到原本的事件 */
export function chooseInterrupt(career: Career, s: GameState, choiceIndex: number): GameState {
  const it = currentInterrupt(career, s);
  if (!it || s.pendingOutcome) throw new Error("目前沒有打斷事件");
  const ch = it.choices[choiceIndex];
  if (!ch) throw new Error(`選項 ${choiceIndex} 不存在`);
  const used = deadlineOf(career, s) !== null ? s.used + choiceMinutes(ch) : s.used;
  return {
    ...applyOutcome(s, ch.effects, ch.traits, ch.setFlags),
    log: [...s.log, { eventId: it.id, choiceIndex }],
    done: [...s.done, it.id],
    used,
    pendingOutcome: { eventId: it.id, choiceIndex, interrupt: true },
  };
}

/** 時間到：其餘還開著的事件全部來不及，依各自的 expire 結算 */
function expireAll(s: GameState, open: GameEvent[]): GameState {
  let next = s;
  for (const e of open) {
    const ex = e.expire;
    if (ex) next = applyOutcome(next, ex.effects, ex.traits ?? {}, ex.setFlags);
    next = { ...next, done: [...next.done, e.id], log: [...next.log, { eventId: e.id, choiceIndex: -1 }] };
  }
  return { ...next, expired: open.map((e) => e.id) };
}

/** 玩家看完「時間到」畫面 */
export function ackExpired(s: GameState): GameState {
  return { ...s, expired: null };
}

/** 看完結果敘述後前進；群組做完就換下一個，沒有後續事件就進入對照 */
export function advance(career: Career, s: GameState): GameState {
  if (s.phase === "play") {
    if (s.pendingOutcome?.interrupt) return { ...s, pendingOutcome: null };
    let next: GameState = { ...s, pendingOutcome: null, active: null };
    const left = remainingMinutes(career, next);
    if (left !== null && left <= 0) {
      const open = openEvents(career, next);
      if (open.length > 0) next = expireAll(next, open);
    }
    return settle(career, next);
  }
  if (s.phase === "compare") return { ...s, phase: "result" };
  return s;
}

/** 目前時間軸位置 0–1 */
export function timelineProgress(career: Career, s: GameState): number {
  const start = toMin(career.dayStart);
  const end = toMin(career.dayEnd);
  if (s.phase === "predict") return 0;
  if (s.phase !== "play") return 1;
  const e = currentEvent(career, s) ?? openEvents(career, s)[0];
  return e ? ((clockMinutes(career, s) ?? toMin(e.time)) - start) / (end - start) : 1;
}

/** 目前的狀態徽章：依序比對旗標，第一個符合者；職業沒有定義時回傳 null */
export function currentBadge(career: Career, flags: readonly string[]): StatusBadge | null {
  return career.statusBadges?.find((b) => (b.flags ?? []).every((f) => flags.includes(f))) ?? null;
}
