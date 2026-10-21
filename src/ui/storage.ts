// localStorage 包 try/catch：無痕模式或被封鎖時遊戲照樣能玩。
import type { GameState } from "../engine/game";

const KEY = "career-day:v1";

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
