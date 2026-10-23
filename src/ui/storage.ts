// localStorage 包 try/catch：無痕模式或被封鎖時遊戲照樣能玩。
import type { Codex } from "../engine/codex";
import type { GameState } from "../engine/game";

const KEY = "career-day:v3";

export function save(s: GameState | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* 無法儲存就略過 */
  }
}

/**
 * 解析存檔：壞掉的 JSON、缺欄位、或 careerId 已不存在（例如 v0.13 刪除的高中老師 "teacher"、v0.14 刪除的水電工 "plumber"）都視為沒有存檔。
 * 純函式，方便測試。
 */
export function parseSave(raw: string | null, isKnownCareer: (id: string) => boolean): GameState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<GameState> | null;
    if (!s || typeof s !== "object" || typeof s.careerId !== "string" || !isKnownCareer(s.careerId)) return null;
    return Array.isArray(s.done) && Array.isArray(s.inspected) ? (s as GameState) : null;
  } catch {
    return null;
  }
}

export function load(isKnownCareer: (id: string) => boolean): GameState | null {
  try {
    return parseSave(localStorage.getItem(KEY), isKnownCareer);
  } catch {
    return null;
  }
}

const CODEX_KEY = "career-day:codex:v1";

export function loadCodex(): Codex {
  try {
    const raw = localStorage.getItem(CODEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Codex = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCodex(codex: Codex): void {
  try {
    localStorage.setItem(CODEX_KEY, JSON.stringify(codex));
  } catch {
    /* 無法儲存就略過 */
  }
}

const AUTOWALK_KEY = "career-day:autowalk:v1";

export function loadAutoWalk(): boolean {
  try {
    return localStorage.getItem(AUTOWALK_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAutoWalk(on: boolean): void {
  try {
    localStorage.setItem(AUTOWALK_KEY, on ? "1" : "0");
  } catch {
    /* 無法儲存就略過 */
  }
}

const NAME_KEY = "career-day:name:v1";
/** 名字最多幾個字（名牌與結算卡放得下） */
export const NAME_MAX = 12;

/** 玩家名字（可不填）：只存在這台裝置 */
export function loadName(): string {
  try {
    const v = localStorage.getItem(NAME_KEY);
    return typeof v === "string" ? v.slice(0, NAME_MAX) : "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    const v = name.trim().slice(0, NAME_MAX);
    if (v) localStorage.setItem(NAME_KEY, v);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* 無法儲存就略過 */
  }
}
