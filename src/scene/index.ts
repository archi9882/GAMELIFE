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
  /** 這個場景是否支援自由走動（點地板、方向鍵）；水電工只能「帶我去」 */
  canWalk(): boolean;
  /** false 時忽略點地板與方向輸入（事件內容顯示時關閉）；預設 true */
  setWalkEnabled(on: boolean): void;
  /** 方向輸入，螢幕相對：dx 右 +1／左 -1，dz 下（朝向鏡頭）+1／上（遠離鏡頭）-1；(0,0) 停下。帶我去走路中會被忽略 */
  setMove(dx: number, dz: number): void;
  /** 角色附近（半徑 1.5、沒在走）的地點 id；走路途中為空 */
  nearby(): string[];
  /** nearby() 的集合改變時呼叫（包含停下來的時候）；只保留最後一個 callback */
  onNearbyChange(cb: (() => void) | undefined): void;
  setFlags(flags: readonly string[]): void;
  /** 一天的進度 0–1，控制光線 */
  setProgress(p: number): void;
  /** false 時暫停渲染（不在遊玩畫面時） */
  setActive(active: boolean): void;
  /** 畫面下方被面板蓋住的高度（px，全螢幕沉浸模式用）；0 表示沒有 */
  setBottomInset(px: number): void;
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
