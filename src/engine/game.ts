// 遊戲狀態機：predict → play → compare → result。純函式，方便測試。
import {
  CATEGORIES,
  STATS,
  TRAITS,
  type Career,
  type Category,
  type GameEvent,
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
  /** 下一個要檢查的事件索引（在 career.events 中） */
  cursor: number;
  /** 目前顯示中的事件；選完後顯示 outcome 時仍保留 */
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

/** 從 cursor 起找下一個符合前置旗標的事件索引；沒有則回傳 -1 */
export function nextEventIndex(career: Career, cursor: number, flags: readonly string[]): number {
  for (let i = cursor; i < career.events.length; i++) {
    if (isAvailable(career.events[i], flags)) return i;
  }
  return -1;
}

export function currentEvent(career: Career, s: GameState): GameEvent | null {
  if (s.phase !== "play") return null;
  if (s.pendingOutcome) return career.events.find((e) => e.id === s.pendingOutcome!.eventId) ?? null;
  const i = nextEventIndex(career, s.cursor, s.flags);
  return i < 0 ? null : career.events[i];
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
  const next: GameState = { ...s, prediction: normalize(pred), phase: "play", cursor: 0 };
  return nextEventIndex(career, 0, next.flags) < 0 ? { ...next, phase: "compare" } : next;
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
    cursor: career.events.indexOf(e) + 1,
    pendingOutcome: { eventId: e.id, choiceIndex },
  };
}

/** 看完結果敘述後前進；沒有後續事件就進入對照 */
export function advance(career: Career, s: GameState): GameState {
  if (s.phase === "play") {
    const cleared = { ...s, pendingOutcome: null };
    return nextEventIndex(career, cleared.cursor, cleared.flags) < 0 ? { ...cleared, phase: "compare" } : cleared;
  }
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
  const e = currentEvent(career, s);
  return e ? (toMin(e.time) - start) / (end - start) : 1;
}
