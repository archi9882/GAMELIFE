// 遊戲狀態機：predict → play → compare → result。純函式，方便測試。
//
// 事件依陣列順序進行，但同一個 `group` 的事件會「同時開放」：玩家可以用任意順序處理。
// 一個群組在「沒有任何已符合前置旗標、又還沒做的事件」時結束，沒做到的事件就被略過。
import {
  CATEGORIES,
  STATS,
  TRAITS,
  type Career,
  type Category,
  type GameEvent,
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
  /** 剛選完選項、正在顯示結果敘述的事件 */
  pendingOutcome: { eventId: string; choiceIndex: number } | null;
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
    stats: { ...INITIAL_STATS },
    traits: zeroTraits(),
    flags: [],
    log: [],
  };
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function isAvailable(e: GameEvent, flags: readonly string[]): boolean {
  return (e.requires ?? []).every((f) => flags.includes(f));
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
  return cursor >= career.events.length ? { ...s, cursor, active: null, phase: "compare" } : { ...s, cursor };
}

/** 目前畫面上的事件；同時有多件待辦、還沒選時為 null */
export function currentEvent(career: Career, s: GameState): GameEvent | null {
  if (s.phase !== "play") return null;
  const id = s.pendingOutcome?.eventId ?? s.active;
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
  return settle(career, { ...s, prediction: normalize(pred), phase: "play", cursor: 0, done: [], active: null, pendingOutcome: null });
}

/** 同時有多件待辦時，選一件來處理 */
export function selectEvent(career: Career, s: GameState, eventId: string): GameState {
  if (s.pendingOutcome) throw new Error("請先看完目前的結果");
  if (!openEvents(career, s).some((e) => e.id === eventId)) throw new Error(`事件 ${eventId} 現在不能處理`);
  return { ...s, active: eventId };
}

export function choose(career: Career, s: GameState, choiceIndex: number): GameState {
  const e = currentEvent(career, s);
  if (!e || s.pendingOutcome) throw new Error("目前沒有可選擇的事件");
  const ch = e.choices[choiceIndex];
  if (!ch) throw new Error(`選項 ${choiceIndex} 不存在`);
  const stats = { ...s.stats };
  for (const k of STATS) stats[k] = clamp(stats[k] + (ch.effects[k] ?? 0));
  const traits = { ...s.traits };
  for (const k of TRAITS) traits[k] += ch.traits[k] ?? 0;
  const flags = [...new Set([...s.flags, ...(ch.setFlags ?? [])])];
  return {
    ...s,
    stats,
    traits,
    flags,
    log: [...s.log, { eventId: e.id, choiceIndex }],
    done: [...s.done, e.id],
    active: e.id,
    pendingOutcome: { eventId: e.id, choiceIndex },
  };
}

/** 看完結果敘述後前進；群組做完就換下一個，沒有後續事件就進入對照 */
export function advance(career: Career, s: GameState): GameState {
  if (s.phase === "play") return settle(career, { ...s, pendingOutcome: null, active: null });
  if (s.phase === "compare") return { ...s, phase: "result" };
  return s;
}

/** 目前時間軸位置 0–1 */
export function timelineProgress(career: Career, s: GameState): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = toMin(career.dayStart);
  const end = toMin(career.dayEnd);
  if (s.phase === "predict") return 0;
  if (s.phase !== "play") return 1;
  const e = currentEvent(career, s) ?? openEvents(career, s)[0];
  return e ? (toMin(e.time) - start) / (end - start) : 1;
}

/** 目前的狀態徽章：依序比對旗標，第一個符合者；職業沒有定義時回傳 null */
export function currentBadge(career: Career, flags: readonly string[]): StatusBadge | null {
  return career.statusBadges?.find((b) => (b.flags ?? []).every((f) => flags.includes(f))) ?? null;
}
