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

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
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
