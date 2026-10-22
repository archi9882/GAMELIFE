// 3D 場景登錄表：職業 id → 場景建構函式。沒登錄的職業退回純卡片介面。
import { createPlumberScene, PLUMBER_PLACE_IDS } from "./plumber";
import { createSweScene, SWE_PLACE_IDS } from "./swe";
import { createTeacherScene, TEACHER_PLACE_IDS } from "./teacher";

export interface SceneHandle {
  /** 目前開放的事件 id 與正在處理的事件 id：等在各處的角色依此出現 */
  setEvents(open: readonly string[], active?: string): void;
  /** 第一次把角色放到地點（已經放過就不動） */
  place(id: string): void;
  /** 有待辦的地點：每個地點一個黃色「！」（count>1 顯示數量），可以點 */
  setGoals(goals: { id: string; name?: string; count: number }[], onPick?: (placeId: string) => void): void;
  /** 讓角色走到地點，到達時呼叫 onArrive（已在該處或減少動態時立刻呼叫） */
  goTo(id: string, onArrive?: () => void): void;
  /** 角色是否已經站在該地點（走路途中為 false） */
  at(id: string | undefined): boolean;
  setFlags(flags: readonly string[]): void;
  /** 一天的進度 0–1，控制光線 */
  setProgress(p: number): void;
  /** false 時暫停渲染（不在遊玩畫面時） */
  setActive(active: boolean): void;
  dispose(): void;
}

const builders: Record<string, (host: HTMLElement) => SceneHandle | null> = {
  plumber: createPlumberScene,
  teacher: createTeacherScene,
  swe: createSweScene,
};

/** 各場景實際有的地點 id（測試用：劇本的 location 必須對得上） */
export const sceneLocations: Record<string, string[]> = {
  plumber: PLUMBER_PLACE_IDS,
  teacher: TEACHER_PLACE_IDS,
  swe: SWE_PLACE_IDS,
};

export const hasScene = (careerId: string): boolean => careerId in builders;

/** 沒有 WebGL 時回傳 null */
export function createScene(careerId: string, host: HTMLElement): SceneHandle | null {
  return builders[careerId]?.(host) ?? null;
}
