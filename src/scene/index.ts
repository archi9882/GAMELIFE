// 3D 場景登錄表：職業 id → 場景建構函式。沒登錄的職業退回純卡片介面。
import { createPlumberScene, PLUMBER_PLACE_IDS } from "./plumber";
import { createSweScene, SWE_PLACE_IDS } from "./swe";
import { createTeacherScene, TEACHER_PLACE_IDS } from "./teacher";

export interface SceneHandle {
  /** 把玩家角色移到地點（Career.locations 的 id）；第一次呼叫直接定位 */
  setLocation(id: string | undefined, eventId?: string): void;
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
