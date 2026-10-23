// 3D 場景登錄表：職業 id → 場景建構函式。沒登錄的職業退回純卡片介面。
import type { CastMember, ViewMode } from "./kit";
import { createPlumberScene, PLUMBER_CAST, PLUMBER_PLACE_IDS } from "./plumber";
import { createSweScene, SWE_CAST, SWE_PLACE_IDS } from "./swe";
import { createTeacherScene, TEACHER_CAST, TEACHER_PLACE_IDS } from "./teacher";

export type { CastMember, ViewMode };

export interface SceneHandle {
  /** 目前開放的事件 id 與正在處理的事件 id：等在各處的角色依此出現 */
  setEvents(open: readonly string[], active?: string): void;
  /** 第一次把角色放到地點（已經放過就不動） */
  place(id: string): void;
  /** 有待辦的地點：每個地點一個黃色「！」（count>1 顯示數量），可以點 */
  setGoals(goals: { id: string; name?: string; count: number }[], onPick?: (placeId: string) => void): void;
  /** 讓角色走到地點，到達時呼叫 onArrive（已在該處或減少動態時立刻呼叫） */
  goTo(id: string, onArrive?: () => void): void;
  /** 角色是否已經站在該地點（走路途中為 false；第一人稱時漸黑傳送完成、到了新地點就是 true） */
  at(id: string | undefined): boolean;
  /** 這個場景是否支援自由走動（點地板、方向鍵）；水電工只能「帶我去」，第一人稱的場景（軟體工程師）也不行 */
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
  /**
   * 被面板蓋住的區域（px）：手機是下方面板高度，桌機是左側卡片的右緣；鏡頭偏移讓場景置中在可見範圍。
   * top：第一人稱文字 RPG 版面上方 HUD 的高度（v0.12）。
   */
  setInsets(insets: { bottom?: number; left?: number; top?: number }): void;
  /**
   * 畫面內任務（v0.12）：這件事要顯示在哪個螢幕（螢幕 id），沒有就回傳 null。
   * investigating：正在查資料／玩小遊戲（在座位查資料 → 座位的電腦螢幕）；某些事件固定用某個螢幕（技術分享會 → 茶水間電視）。
   */
  screenFor(location: string | undefined, eventId: string | undefined, investigating: boolean): string | null;
  /**
   * 第一人稱：鏡頭推近螢幕（id）或拉回原本的視點（null），動畫完成時 resolve；減少動態時直接切換。
   * 推近時不能環顧、不顯示名牌。漸黑傳送後若仍要推近，直接定位在螢幕前。
   */
  focusScreen(id: string | null): Promise<void>;
  /** 目前推近（或正在推近）的螢幕 id */
  focusedScreen(): string | null;
  /** 推近完成後，螢幕投影到畫面上的矩形（CSS px，相對視窗）；改變時（含視窗大小、遮蓋範圍改變）呼叫，沒有推近時為 null */
  onScreenRect(cb: ((rect: { x: number; y: number; w: number; h: number } | null) => void) | undefined): void;
  /** 展示模式（選單、預測、對照、結算的背景）：鏡頭慢慢環繞、不能走動、不顯示「！」；減少動態時靜止 */
  setShowcase(on: boolean): void;
  /** 這個場景遊玩時是否用第一人稱（軟體工程師） */
  hasFirstPerson(): boolean;
  /**
   * 視角："iso" 俯瞰（展示與老師、水電工）；"first" 第一人稱（眼睛高度，看不到自己）。
   * 切到第一人稱時先漸黑再切換；切回俯瞰立即生效。setShowcase(true) 也會切回俯瞰。沒有第一人稱的場景忽略 "first"。
   */
  setViewMode(mode: ViewMode): void;
  viewMode(): ViewMode;
  /**
   * 第一人稱：漸黑約 0.4 秒 → 傳送到地點（面向 eventId 的人或物件；省略時用目前正在處理的事件）→ 漸亮，全部完成時 resolve。
   * 傳送完成（還在漸亮）時 at(id) 就是 true。已在該地點時只轉向事件。減少動態時直接切換。俯瞰時等同 goTo。
   */
  fadeTo(id: string, opts?: { eventId?: string }): Promise<void>;
  /** 第一人稱：方向鍵轉頭，-1 左、+1 右、0 停；俯瞰時忽略 */
  setTurn(dir: number): void;
  /** 玩家名牌：把「你｜導師」的「你」換成名字；空字串還原 */
  setPlayerName(name: string): void;
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

/** 各職業「今天會遇到的人」（場景 npc 的名牌與衣服顏色） */
export const sceneCast: Record<string, CastMember[]> = {
  plumber: PLUMBER_CAST,
  teacher: TEACHER_CAST,
  swe: SWE_CAST,
};

export const hasScene = (careerId: string): boolean => careerId in builders;

/** 沒有 WebGL 時回傳 null */
export function createScene(careerId: string, host: HTMLElement): SceneHandle | null {
  return builders[careerId]?.(host) ?? null;
}
