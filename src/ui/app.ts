// 畫面渲染：每次狀態改變就整頁重畫（畫面小，簡單優先）。
import { careers, getCareer } from "../../content/index";
import {
  CATEGORIES,
  INSPECT_MINUTES,
  CATEGORY_LABELS,
  type Career,
  type Category,
  type GameEvent,
  type GlossaryTerm,
  type Interrupt,
  type Investigation,
  type InvestigationItem,
  type InvestigationKind,
  type Source,
  type Stat,
} from "../../content/schema";
import {
  ackExpired,
  advance,
  choose,
  chooseInterrupt,
  clockMinutes,
  currentBadge,
  deadlineOf,
  currentEvent,
  currentInterrupt,
  formatClock,
  inspect,
  investigationDone,
  newGame,
  openEvents,
  remainingMinutes,
  selectEvent,
  normalize,
  submitPrediction,
  timelineProgress,
  type GameState,
} from "../engine/game";
import { mergeSeen, progress, type Codex } from "../engine/codex";
import { splitPages } from "../engine/text";
import { allocationIsEstimate, buildProfile, compareAllocation } from "../engine/scoring";
import { createScene, hasScene, sceneCast, type SceneHandle } from "../scene";
import { fitTaskRect, type PxRect } from "../scene/fp";
import { drawCard } from "./card";
import { load, loadAutoWalk, loadCodex, loadName, NAME_MAX, save, saveAutoWalk, saveCodex, saveName } from "./storage";

const DISCLAIMER = "情境為虛構，比例依據見來源。";
const NOT_A_TEST = "這不是職業測驗，不會告訴你「適合」什麼。";
const STAT_LABELS: Record<Stat, string> = { energy: "精力", time: "時間", trust: "信任" };

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 名詞比對：ASCII 名詞（PR、CI）要整字比對，避免命中別的單字 */
function termRegex(terms: GlossaryTerm[]): RegExp | null {
  if (!terms.length) return null;
  const parts = [...terms]
    .sort((a, b) => b.term.length - a.term.length)
    .map((t) => {
      const lead = /^[A-Za-z0-9]/.test(t.term) ? "(?<![A-Za-z0-9])" : "";
      const tail = /[A-Za-z0-9]$/.test(t.term) ? "(?![A-Za-z0-9])" : "";
      return `${lead}${escRe(t.term)}${tail}`;
    });
  return new RegExp(parts.join("|"), "g");
}

/** 把文字轉成安全的 HTML，並把名詞包成可點的按鈕 */
function annotate(text: string, career: Career): string {
  const re = termRegex(career.glossary ?? []);
  if (!re) return esc(text);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    out += `<button type="button" class="term" data-term="${esc(m[0])}">${esc(m[0])}</button>`;
    last = m.index! + m[0].length;
  }
  return out + esc(text.slice(last));
}

/** 這些文字裡出現的名詞（依出現順序） */
function termsIn(texts: string[], career: Career): GlossaryTerm[] {
  const re = termRegex(career.glossary ?? []);
  if (!re) return [];
  const seen: string[] = [];
  for (const m of texts.join("\n").matchAll(re)) if (!seen.includes(m[0])) seen.push(m[0]);
  return seen.map((t) => career.glossary!.find((g) => g.term === t)!);
}

/** 這些文字裡出現的名詞：記進圖鑑，並回傳「名詞解釋」折疊區 */
function glossFor(career: Career, texts: string[]): string {
  const terms = termsIn(texts, career);
  const next = mergeSeen(codex, career, terms.map((t) => t.term));
  if (next !== codex) {
    codex = next;
    saveCodex(codex);
  }
  return glossHtml(terms);
}

function glossHtml(terms: GlossaryTerm[]): string {
  if (!terms.length) return "";
  const hint = hintShown ? "" : `<p class="gloss-hint">有虛線的詞可以點，會展開白話解釋。</p>`;
  hintShown = true;
  return `${hint}<details class="gloss"><summary>名詞解釋（${terms.length}）</summary>
    <div class="gloss-list">${terms
      .map(
        (t) => `<details class="gloss-item" data-term="${esc(t.term)}"><summary>${esc(t.term)}</summary><p>${esc(t.meaning)}</p></details>`,
      )
      .join("")}</div></details>`;
}

/** 點內文中的名詞：展開「名詞解釋」並打開對應那一條 */
function bindTerms(): void {
  root.querySelectorAll<HTMLButtonElement>(".term").forEach((b) =>
    b.addEventListener("click", () => {
      const gloss = root.querySelector<HTMLDetailsElement>(".gloss");
      const item = gloss?.querySelector<HTMLDetailsElement>(`.gloss-item[data-term="${CSS.escape(b.dataset.term!)}"]`);
      if (!gloss || !item) return;
      const wasOpen = gloss.open && item.open;
      gloss.open = !wasOpen;
      item.open = !wasOpen;
      if (!wasOpen) item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }),
  );
}

let hintShown = false;
let codex: Codex = {};
let codexOpen = false;
let autoWalk = false;
/** 角色正在走向事件地點 */
let walking = false;
let bodyPage = { eventId: "", index: 0 };
let root: HTMLElement;
let stageEl: HTMLElement;
let stageHost: HTMLElement;
let stageLabel: HTMLElement;
let stageActions: HTMLElement;
let dpadEl: HTMLElement;
let scene: SceneHandle | null = null;
let sceneCareerId: string | null = null;
let state: GameState | null = null;
/** 選單上選中的職業（只在這次開啟期間記住） */
let homeCareerId: string = careers[0].id;
/** 玩家名字（可不填），存在 career-day:name:v1 */
let playerName = "";
let draft: Record<Category, number> | null = null;

function setState(s: GameState | null): void {
  state = s;
  save(s);
  render();
  window.scrollTo(0, 0);
  root.scrollTop = 0;
}

export function mount(el: HTMLElement): void {
  // 「全螢幕」按鈕放在 #ui 之後（不在 #stage 裡），第一人稱的 HUD 蓋在場景上時按鈕仍在最上層
  el.innerHTML = `<div id="stage" hidden><div id="stage-canvas"></div><span id="stage-label" class="stage-label"></span>
    <div id="stage-actions" class="stage-actions"></div>
    <div id="dpad" class="dpad" role="group" aria-label="移動" hidden>
      <button type="button" class="dpad-btn" data-dir="up" aria-label="上">▲</button>
      <button type="button" class="dpad-btn" data-dir="left" aria-label="左">◀</button>
      <button type="button" class="dpad-btn" data-dir="right" aria-label="右">▶</button>
      <button type="button" class="dpad-btn" data-dir="down" aria-label="下">▼</button>
    </div></div><div id="ui"></div>
    <button type="button" id="fs-toggle" class="fs-toggle" aria-pressed="false">全螢幕</button>`;
  stageEl = el.querySelector("#stage")!;
  stageHost = el.querySelector("#stage-canvas")!;
  stageLabel = el.querySelector("#stage-label")!;
  stageActions = el.querySelector("#stage-actions")!;
  dpadEl = el.querySelector("#dpad")!;
  bindDpad();
  bindFullscreen(el.querySelector<HTMLButtonElement>("#fs-toggle")!);
  root = el.querySelector("#ui")!;
  window.addEventListener("resize", () => {
    applyInsets();
    placeTaskScreen();
  });
  codex = loadCodex();
  playerName = loadName();
  autoWalk = loadAutoWalk();
  const saved = load();
  state = saved && getCareer(saved.careerId) && Array.isArray(saved.done) && Array.isArray(saved.inspected) ? saved : null;
  render();
}

type Dir = "up" | "down" | "left" | "right";
const padHeld: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
const keyHeld: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", W: "up", s: "down", S: "down", a: "left", A: "left", d: "right", D: "right",
};

/** 合併螢幕方向鍵與鍵盤，送給場景（畫面相對：右 +x、下 +z） */
function pushMove(): void {
  const h = (d: Dir): number => (padHeld[d] || keyHeld[d] ? 1 : 0);
  scene?.setMove(h("right") - h("left"), h("down") - h("up"));
}

function clearMove(): void {
  for (const d of Object.keys(padHeld) as Dir[]) padHeld[d] = keyHeld[d] = false;
  scene?.setMove(0, 0);
}

function onKeyDown(ev: KeyboardEvent): void {
  const d = KEY_DIR[ev.key];
  const t = ev.target as HTMLElement | null;
  if (!d || ev.ctrlKey || ev.metaKey || ev.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  ev.preventDefault(); // 方向鍵不要捲動頁面
  keyHeld[d] = true;
  pushMove();
}

function onKeyUp(ev: KeyboardEvent): void {
  const d = KEY_DIR[ev.key];
  if (!d) return;
  keyHeld[d] = false;
  pushMove();
}

/** 螢幕方向鍵：按住走、放開停（指標離開按鈕或被取消也停） */
function bindDpad(): void {
  dpadEl.querySelectorAll<HTMLButtonElement>(".dpad-btn").forEach((b) => {
    const dir = b.dataset.dir as Dir;
    const stop = (): void => {
      padHeld[dir] = false;
      pushMove();
    };
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      padHeld[dir] = true;
      pushMove();
    });
    b.addEventListener("pointerup", stop);
    b.addEventListener("pointercancel", stop);
    b.addEventListener("pointerleave", stop);
    b.addEventListener("contextmenu", (ev) => ev.preventDefault());
  });
}

/** 開關自由走動的操作介面（方向鍵 UI 與鍵盤）；離開遊玩畫面或事件開始時關閉 */
function setWalkUi(on: boolean): void {
  const was = !dpadEl.hidden;
  scene?.setWalkEnabled(on);
  dpadEl.hidden = !on;
  stageEl.classList.toggle("walkable", on);
  if (on) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearMove);
  } else {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearMove);
    if (was) clearMove();
  }
}

/** 第一人稱：左右方向鍵轉頭（不能走動）；在輸入框裡不攔截 */
const turnHeld = { left: false, right: false };
function pushTurn(): void {
  scene?.setTurn((turnHeld.right ? 1 : 0) - (turnHeld.left ? 1 : 0));
}
function onTurnKey(ev: KeyboardEvent): void {
  const side = ev.key === "ArrowLeft" ? "left" : ev.key === "ArrowRight" ? "right" : null;
  const t = ev.target as HTMLElement | null;
  if (!side || ev.ctrlKey || ev.metaKey || ev.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const down = ev.type === "keydown";
  if (down) ev.preventDefault();
  turnHeld[side] = down;
  pushTurn();
}
function clearTurn(): void {
  turnHeld.left = turnHeld.right = false;
  pushTurn();
}
let lookUi = false;
/** 開關第一人稱的鍵盤轉頭 */
function setLookUi(on: boolean): void {
  if (on === lookUi) return;
  lookUi = on;
  if (on) {
    window.addEventListener("keydown", onTurnKey);
    window.addEventListener("keyup", onTurnKey);
    window.addEventListener("blur", clearTurn);
  } else {
    window.removeEventListener("keydown", onTurnKey);
    window.removeEventListener("keyup", onTurnKey);
    window.removeEventListener("blur", clearTurn);
    clearTurn();
  }
}

/** 第一人稱：漸黑傳送到事件的地點，到了再顯示事件（「帶我去」與場景上的「處理：○○」共用） */
function travelTo(career: Career, eventId: string, location: string): void {
  if (!scene || walking) return;
  walking = true;
  void scene.fadeTo(location, { eventId }).then(() => {
    walking = false;
    if (state?.phase === "play" && currentEvent(career, state)?.id === eventId) render();
  });
}

// ── 版面：場景常駐背景＋浮動卡片 ─────────────────────
// 場景一直鋪滿畫面（position: fixed）。選單、預測、對照、結算是「卡片」版面：場景霧化、鏡頭慢慢環繞，
// 卡片在桌機靠左、手機在中央偏下，頁面可捲動。遊玩是「面板」版面：場景清楚可走動，
// 面板在手機是下方可捲動的面板（46dvh）、桌機是左側浮動卡片。
// 「全螢幕」按鈕只切換瀏覽器原生全螢幕；不支援的瀏覽器（例如 iPhone Safari）隱藏按鈕。
type Layout = "card" | "play";
let layout: Layout = "card";
let fsButton: HTMLButtonElement;
/** 場景是為哪個畫面建的：home（選單展示用、狀態乾淨）或 game（遊戲中，角色位置與旗標會變） */
let sceneMode: "home" | "game" | null = null;

const DESKTOP = "(min-width: 900px)";
const isDesktop = (): boolean => window.matchMedia?.(DESKTOP).matches ?? false;
/** 桌機左側卡片／面板的右緣（px），與 CSS 一致：左距 16 + 寬 520 + 間隔 16 */
const DESKTOP_PANEL_EDGE = 552;

/** 依版面告訴場景哪裡被蓋住，讓鏡頭把角色放在看得到的範圍 */
function applyInsets(): void {
  if (!scene) return;
  if (rpg) {
    // 第一人稱文字 RPG：上方 HUD、下方對話框蓋住的高度（量實際的元素）
    const r = rpgRegion();
    root.style.setProperty("--hud-h", `${Math.round(r.y)}px`);
    root.style.setProperty("--dlg-h", `${Math.round(window.innerHeight - r.y - r.h)}px`);
    scene.setInsets({ top: Math.round(r.y), bottom: Math.round(window.innerHeight - r.y - r.h), left: 0 });
    return;
  }
  if (isDesktop()) scene.setInsets({ left: DESKTOP_PANEL_EDGE, bottom: 0 });
  else if (layout === "play") scene.setInsets({ bottom: Math.round(window.innerHeight * 0.46), left: 0 });
  else scene.setInsets({ bottom: Math.round(window.innerHeight * 0.6), left: 0 });
}

function setLayout(next: Layout): void {
  layout = next;
  const hasStage = !stageEl.hidden;
  if (next !== "play" || !hasStage) setRpg(false);
  document.body.classList.toggle("layout-play", next === "play" && hasStage && !rpg);
  document.body.classList.toggle("layout-rpg", next === "play" && hasStage && rpg);
  document.body.classList.toggle("layout-card", !(next === "play" && hasStage));
  document.body.classList.toggle("has-scene", hasStage);
  applyInsets();
}

const fsSupported = (): boolean => !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;

function syncFsButton(): void {
  const on = !!document.fullscreenElement;
  fsButton.textContent = on ? "結束全螢幕" : "全螢幕";
  fsButton.setAttribute("aria-pressed", String(on));
}

function bindFullscreen(btn: HTMLButtonElement): void {
  fsButton = btn;
  if (!fsSupported()) {
    btn.hidden = true;
    return;
  }
  document.body.classList.add("fs-ok"); // HUD 右上角留位置給全螢幕按鈕
  btn.addEventListener("click", () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
      else document.documentElement.requestFullscreen?.().catch(() => undefined);
    } catch {
      /* 不支援就略過 */
    }
  });
  document.addEventListener("fullscreenchange", syncFsButton);
  syncFsButton();
}

function exitFullscreen(): void {
  try {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  } catch {
    /* 略過 */
  }
}

function disposeScene(): void {
  walking = false;
  setRpg(false);
  setWalkUi(false);
  setLookUi(false);
  scene?.dispose();
  scene = null;
  sceneCareerId = null;
  sceneMode = null;
}

/**
 * 取得這個職業的場景：職業不同就換；從遊戲回到選單時重建（遊戲中的位置與旗標不帶回選單）。
 * 選單建好的場景還沒被動過，開始這一天時直接沿用。
 */
function ensureScene(careerId: string, mode: "home" | "game"): SceneHandle | null {
  const reusable = scene && sceneCareerId === careerId && (sceneMode === mode || (sceneMode === "home" && mode === "game"));
  if (reusable) {
    sceneMode = mode;
    return scene;
  }
  if (sceneCareerId !== null || scene) disposeScene();
  if (!hasScene(careerId)) return null;
  scene = createScene(careerId, stageHost);
  sceneCareerId = careerId;
  sceneMode = mode;
  scene?.setPlayerName(playerName);
  return scene;
}

/** 卡片畫面的背景：同一個職業的場景，霧化＋展示模式；沒有場景時退回純卡片 */
function showBackdrop(career: Career, mode: "home" | "game", progress: number): void {
  setWalkUi(false);
  setLookUi(false);
  stageActions.replaceChildren();
  stageLabel.textContent = "";
  exitFullscreen();
  const sc = ensureScene(career.id, mode);
  stageEl.hidden = !sc;
  if (sc) {
    sc.setActive(true);
    sc.setShowcase(true);
    sc.setGoals([]);
    sc.setFlags(state && mode === "game" ? state.flags : []);
    sc.setProgress(progress);
    const first = career.events[0];
    if (first?.location) sc.place(first.location);
  }
  setLayout("card");
}

/** 遊玩畫面上方的 3D 場景；沒有場景或不支援 WebGL 時隱藏，退回純卡片 */
function updateStage(career: Career, s: GameState, e: GameEvent | null, walk = true): void {
  ensureScene(career.id, "game");
  stageEl.hidden = !scene;
  if (!scene) {
    setWalkUi(false);
    setLookUi(false);
    stageActions.replaceChildren();
    setLayout("card");
    return;
  }
  setLayout("play");
  scene.setShowcase(false);
  // 軟體工程師：遊玩時第一人稱（從展示畫面進來時先漸黑）
  const fp = scene.hasFirstPerson();
  if (fp) scene.setViewMode("first");
  setLookUi(fp);
  // 第一人稱：文字 RPG 版面（場景鋪滿、上方 HUD、下方對話框）
  setRpg(fp && scene.viewMode() === "first");
  setLayout("play");
  const open = openEvents(career, s);
  const shown = new Set(open.map((o) => o.id));
  if (e) shown.add(e.id);
  scene.setActive(true);
  scene.setFlags(s.flags);
  scene.setProgress(timelineProgress(career, s));
  scene.setEvents([...shown], e?.id);
  const first = e ?? open[0];
  if (first?.location) scene.place(first.location);

  // 「！」標記：選事件時，每個有待辦、而且角色不在那裡的地點各一個（可以點）；走去處理某件事時，只標那一個
  const placeName = (id: string | undefined) => career.locations?.find((l) => l.id === id)?.name;
  const pool = e ? (!s.pendingOutcome && e.location && !scene.at(e.location) ? [e] : []) : open;
  const byPlace = new Map<string, GameEvent[]>();
  for (const o of pool) if (o.location && !scene.at(o.location)) byPlace.set(o.location, [...(byPlace.get(o.location) ?? []), o]);
  scene.setGoals(
    [...byPlace].map(([id, list]) => ({ id, name: placeName(id), count: list.length })),
    e ? undefined : (placeId) => {
      const target = byPlace.get(placeId)?.[0];
      if (!target || !state) return;
      if (rpg) pickQuest(career, target);
      else setState(selectEvent(career, state, target.id));
    },
  );
  // 自由走動：只在選事件（任務板）與前往途中開放；事件內容顯示時不能走開
  const canMove = walk && scene.canWalk() && (e ? !s.pendingOutcome && !!e.location && !scene.at(e.location) : true);
  setWalkUi(canMove);
  scene.onNearbyChange(() => {
    if (state?.phase === "play") render();
  });
  // 第一人稱：事件就在這裡時，鏡頭轉向事件的人或物件
  if (fp && e?.location && scene.at(e.location)) void scene.fadeTo(e.location, { eventId: e.id });
  // 任務板：走到有待辦的地點附近，場景右下角出現「處理：○○」
  stageActions.replaceChildren();
  // 文字 RPG 版面：待辦清單在對話框裡，不另外放「處理：○○」按鈕
  if (!e && (canMove || fp) && !rpg) {
    const near = new Set(scene.nearby());
    // 第一人稱：不能走動，所以別處的事也列出來（這裡的排前面），按了就漸黑傳送過去
    const here = fp
      ? walking
        ? []
        : [...open.filter((o) => o.location && near.has(o.location)), ...open.filter((o) => o.location && !near.has(o.location))]
      : open.filter((o) => o.location && near.has(o.location));
    for (const o of here.slice(0, 2)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stage-action";
      b.textContent = `處理：${o.title}`;
      b.addEventListener("click", () => {
        if (!state || walking) return;
        const elsewhere = fp && !!o.location && !near.has(o.location);
        if (elsewhere) walking = true; // 先標記，避免「之後自動帶我去」重複觸發
        setState(selectEvent(career, state, o.id));
        if (elsewhere && scene) {
          walking = false;
          travelTo(career, o.id, o.location!);
          render();
        }
      });
      stageActions.appendChild(b);
    }
    if (here.length > 2) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "stage-action more";
      more.textContent = `還有 ${here.length - 2} 件`;
      more.addEventListener("click", () => {
        const q = root.querySelector<HTMLElement>(".quest");
        q?.scrollIntoView({ block: "center", behavior: "smooth" });
        q?.focus();
      });
      stageActions.appendChild(more);
    }
  }
  stageLabel.textContent = e ? `${timeLabel(career, s, e.time)}${placeName(e.location) ? `・${placeName(e.location)}` : ""}` : `${open[0] ? timeLabel(career, s, open[0].time) : ""}・${open.length} 件待辦`;
}

const homeCareer = (): Career => getCareer(homeCareerId) ?? careers[0];

function render(): void {
  if (!state) {
    showBackdrop(homeCareer(), "home", 0);
    return codexOpen ? renderCodex() : renderHome();
  }
  const career = getCareer(state.careerId)!;
  if (state.phase !== "play") showBackdrop(career, "game", timelineProgress(career, state));
  if (state.expired?.length && (state.phase === "play" || state.phase === "compare")) return renderExpired(career, state);
  switch (state.phase) {
    case "predict":
      return renderPredict(career, state);
    case "play":
      return renderPlay(career, state);
    case "compare":
      return renderCompare(career, state);
    case "result":
      return renderResult(career, state);
  }
}

function sourcesHtml(sources: Source[]): string {
  const typeLabel: Record<Source["type"], string> = {
    public_data: "公開資料",
    public_report: "公開報告",
    news: "新聞",
    fiction: "推估／虛構",
  };
  return `<ul class="sources">${sources
    .map(
      (s) =>
        `<li><span class="tag">${typeLabel[s.type]}</span> ${
          s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)
        }${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}</li>`,
    )
    .join("")}</ul>`;
}

function renderHome(): void {
  const career = homeCareer();
  const first = career.events[0];
  const cast = sceneCast[career.id] ?? [];
  const p = progress(codex, careers);
  const walkHint = !scene
    ? ""
    : scene.hasFirstPerson()
      ? `<p class="muted home-hint">第一人稱視角：拖曳畫面（或按左右方向鍵）環顧四周，用「帶我去」移動</p>`
      : scene.canWalk()
      ? `<p class="muted home-hint">走動：方向鍵、WASD 或點地板</p>`
      : `<p class="muted home-hint">這個場景用「帶我去」移動</p>`;
  root.innerHTML = `
    <main class="screen home">
      <p class="status-strip" aria-label="今天第一件事：${esc(first?.time ?? "")} ${esc(first?.title ?? "")}">
        <span class="status-dot" aria-hidden="true">●</span> ${esc(first?.time ?? career.dayStart)} ${esc(first?.title ?? "")} <span class="status-you">▸ 你</span>
      </p>
      <header class="home-title">
        <h1>GAMELIFE</h1>
        <p class="home-sub">${esc(career.name)}的一天</p>
      </header>
      <div class="career-switch" role="group" aria-label="選擇職業">
        ${careers
          .map(
            (c) => `<button type="button" class="career" data-id="${esc(c.id)}" aria-pressed="${c.id === career.id}">
              <span class="career-name">${esc(c.name)}</span>${c.entryTag ? `<span class="entry-tag">${esc(c.entryTag)}</span>` : ""}
            </button>`,
          )
          .join("")}
      </div>
      <label class="name-field">
        <span>你的名字（可不填）</span>
        <input type="text" id="player-name" maxlength="${NAME_MAX}" autocomplete="nickname" value="${esc(playerName)}" placeholder="顯示在名牌與結算卡上" />
      </label>
      ${
        cast.length
          ? `<section class="cast" aria-label="今天會遇到的人">
        <h2>今天會遇到的人</h2>
        <ul>${cast
          .map((m) => {
            const [who, role] = m.label.split("｜");
            return `<li><span class="cast-dot" style="background:${esc(m.color)}" aria-hidden="true"></span><strong>${esc(who)}</strong>${role ? `<span class="muted">${esc(role)}</span>` : ""}</li>`;
          })
          .join("")}</ul>
      </section>`
          : ""
      }
      <button type="button" class="primary" id="start">開始這一天</button>
      <p class="muted home-hint">跟著頭上有「！」的地方走，或按「帶我去」。</p>
      ${walkHint}
      <nav class="home-links">
        <button type="button" class="link" id="codex">名詞圖鑑與資料來源（${p.all.collected} / ${p.all.total}）</button>
        <details class="about">
          <summary>關於</summary>
          <p>先猜猜看一份工作的一天怎麼分配，再實際過一天，看看想像和現實差多少。10–15 分鐘、免登入。</p>
          <p class="notice">${DISCLAIMER}${NOT_A_TEST}</p>
        </details>
      </nav>
      <p class="muted home-disclaimer">${DISCLAIMER}</p>
    </main>`;
  root.querySelector("#codex")!.addEventListener("click", () => {
    codexOpen = true;
    render();
    window.scrollTo(0, 0);
  });
  root.querySelectorAll<HTMLButtonElement>(".career").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.id === homeCareerId) return;
      homeCareerId = b.dataset.id!;
      render();
      root.querySelector<HTMLButtonElement>(`.career[data-id="${CSS.escape(homeCareerId)}"]`)?.focus();
    }),
  );
  const nameInput = root.querySelector<HTMLInputElement>("#player-name")!;
  nameInput.addEventListener("input", () => {
    playerName = nameInput.value.trim().slice(0, NAME_MAX);
    saveName(playerName);
    scene?.setPlayerName(playerName);
  });
  root.querySelector("#start")!.addEventListener("click", () => {
    draft = null;
    setState(newGame(career));
  });
}

function renderCodex(): void {
  const p = progress(codex, careers);
  root.innerHTML = `
    <main class="screen">
      <button class="link" id="back">← 回到選單</button>
      <p class="kicker">名詞圖鑑</p>
      <h1>已收集 ${p.all.collected} / ${p.all.total}</h1>
      <p class="notice">玩的時候看到的名詞會自動收進來。還沒遇到的先顯示「？？？」。解釋是一般性說明，不含具體數字或法規條文。</p>
      ${careers
        .filter((c) => (c.glossary?.length ?? 0) > 0)
        .map((c) => {
          const got = new Set(codex[c.id] ?? []);
          const cp = p.byCareer[c.id];
          return `<section class="codex-group">
            <h2>${esc(c.name)} <span class="muted">${cp.collected} / ${cp.total}</span></h2>
            ${c
              .glossary!.filter((g) => got.has(g.term))
              .map((g) => `<details class="gloss-item"><summary>${esc(g.term)}</summary><p>${esc(g.meaning)}</p></details>`)
              .join("")}
            ${
              cp.total > cp.collected
                ? `<div class="codex-locked-row" aria-label="還有 ${cp.total - cp.collected} 個尚未收集">${Array.from({ length: cp.total - cp.collected }, () => `<span class="codex-locked">？？？</span>`).join("")}</div>`
                : ""
            }
          </section>`;
        })
        .join("")}
      <h2 class="codex-sources-title">資料來源</h2>
      <p class="muted">各職業時間分配比例的依據；每個情境的來源在遊戲中「這個情境的依據」可以看到。</p>
      ${careers
        .map(
          (c) => `<details class="codex-group src"><summary>${esc(c.name)}${allocationIsEstimate(c) ? "（比例為推估）" : ""}</summary>${sourcesHtml(c.allocationSources)}</details>`,
        )
        .join("")}
    </main>`;
  root.querySelector("#back")!.addEventListener("click", () => {
    codexOpen = false;
    render();
    window.scrollTo(0, 0);
  });
}

function renderPredict(career: Career, s: GameState): void {
  draft ??= { ...s.prediction };
  const d = draft;
  const pct = normalize(d);
  root.innerHTML = `
    <main class="screen">
      ${backButton()}
      <p class="kicker">第 1 步・預測</p>
      <h1>${esc(career.name)}</h1>
      <p>${annotate(career.intro, career)}</p>
      ${glossFor(career, [career.intro])}
      <p class="notice">你覺得這份工作一天的時間，大概怎麼分配？拉動滑桿，系統會自動換算成百分比。</p>
      <div class="sliders">
        ${CATEGORIES.map(
          (c) => `<label class="slider">
            <span class="slider-head"><span>${CATEGORY_LABELS[c]}</span><output data-out="${c}">${pct[c]}%</output></span>
            <input type="range" min="0" max="100" step="1" value="${d[c]}" data-cat="${c}" aria-label="${CATEGORY_LABELS[c]}" />
          </label>`,
        ).join("")}
      </div>
      <button class="primary" id="go">開始上班</button>
    </main>`;
  root.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((input) =>
    input.addEventListener("input", () => {
      d[input.dataset.cat as Category] = Number(input.value);
      const p = normalize(d);
      for (const c of CATEGORIES) root.querySelector(`[data-out="${c}"]`)!.textContent = `${p[c]}%`;
    }),
  );
  bindBack();
  bindTerms();
  root.querySelector("#go")!.addEventListener("click", () => {
    const next = submitPrediction(career, s, d);
    draft = null;
    setState(next);
  });
}

/** 畫面上的時間：有時限的群組是「群組起始 + 已花費分鐘」，否則是事件原本的時間 */
function timeLabel(career: Career, s: GameState, fallback: string): string {
  const c = clockMinutes(career, s);
  return c === null ? fallback : formatClock(c);
}

function timerChip(career: Career, s: GameState): string {
  const left = remainingMinutes(career, s);
  if (left === null) return "";
  const shown = Math.max(0, left);
  return `<span class="badge ${left <= 15 ? "alert" : "info"}" role="timer" aria-label="剩 ${shown} 分鐘">剩 ${shown} 分</span>`;
}

function timelineHtml(career: Career, s: GameState, now: string): string {
  const p = Math.round(timelineProgress(career, s) * 100);
  const badge = currentBadge(career, s.flags);
  const chip = badge ? `<span class="badge ${badge.tone}">${esc(badge.label)}</span>` : "";
  return `<div class="timeline" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
    <span>${esc(career.dayStart)}</span>
    <div class="track"><div class="fill" style="width:${p}%"></div><div class="dot" style="left:${p}%"></div></div>
    <span>${esc(career.dayEnd)}</span>
  </div>
  <p class="now">${esc(now)}${timerChip(career, s)}${chip}</p>`;
}

function statsHtml(s: GameState): string {
  return `<div class="stats">${(Object.keys(STAT_LABELS) as Stat[])
    .map(
      (k) => `<div class="stat"><span>${STAT_LABELS[k]}</span>
        <div class="bar"><div style="width:${s.stats[k]}%"></div></div><b>${s.stats[k]}</b></div>`,
    )
    .join("")}</div>`;
}

function deltaHtml(effects: Partial<Record<Stat, number>>): string {
  return (Object.keys(STAT_LABELS) as Stat[])
    .filter((k) => effects[k])
    .map((k) => {
      const v = effects[k]!;
      return `<span class="delta ${v > 0 ? "up" : "down"}">${STAT_LABELS[k]} ${v > 0 ? "+" : ""}${v}</span>`;
    })
    .join("");
}

function renderPlay(career: Career, s: GameState): void {
  const e = currentEvent(career, s);
  if (!e) {
    const open = openEvents(career, s);
    if (open.length === 0) return setState(advance(career, s));
    return renderQuestBoard(career, s, open);
  }
  updateStage(career, s, e);
  if (rpg) return renderRpgEvent(career, s, e);
  const head = `${backButton()}${timelineHtml(career, s, `${timeLabel(career, s, e.time)}・${CATEGORY_LABELS[e.category]}`)}${statsHtml(s)}`;
  if (!s.pendingOutcome && scene && e.location && !scene.at(e.location)) return renderTravel(career, s, e, head);
  const itr = currentInterrupt(career, s);
  if (itr) return renderInterrupt(career, s, itr, head);
  if (s.pendingOutcome) {
    const ch = e.choices[s.pendingOutcome.choiceIndex];
    root.innerHTML = `
      <main class="screen play">
        ${head}
        <article class="card">
          <p class="kicker">你選了：${esc(ch.label)}</p>
          <p class="outcome">${annotate(ch.outcome, career)}</p>
          <div class="deltas">${deltaHtml(ch.effects)}</div>
        </article>
        ${glossFor(career, [ch.label, ch.outcome])}
        <button class="primary" id="next">繼續</button>
      </main>`;
    root.querySelector("#next")!.addEventListener("click", () => setState(advance(career, s)));
    bindBack();
    bindTerms();
    return;
  }
  // 已經開始查資料的事件（例如重新整理後），直接回到最後一頁的查資料面板
  if (bodyPage.eventId !== e.id) {
    const started = s.inspected.some((k) => k.startsWith(`${e.id}:`));
    bodyPage = { eventId: e.id, index: started ? splitPages(e.body).length - 1 : 0 };
  }
  const pages = splitPages(e.body);
  const last = bodyPage.index >= pages.length - 1;
  const inv = e.investigate;
  const investigating = last && !!inv && !investigationDone(career, s, e);
  const showChoices = last && !investigating;
  const opened = inv ? inv.items.filter((it) => s.inspected.includes(`${e.id}:${it.id}`)) : [];
  const visible = [
    e.title,
    pages[bodyPage.index],
    ...(last && inv
      ? [
          inv.prompt,
          ...(inv.kind === "review" ? [] : inv.items.map((it) => it.label)),
          ...opened.flatMap((it) => [it.detail, it.why ?? ""]),
          !investigating ? (inv.tip ?? "") : "",
        ]
      : []),
    ...(showChoices ? e.choices.map((c) => c.label) : []),
  ];
  root.innerHTML = `
    <main class="screen play">
      ${head}
      <article class="card">
        <h2>${annotate(e.title, career)}</h2>
        <p>${annotate(pages[bodyPage.index], career)}</p>
        ${
          last
            ? ""
            : `<div class="pager"><span class="muted">${bodyPage.index + 1} / ${pages.length}</span><button class="primary" id="page-next">繼續</button></div>`
        }
      </article>
      ${last && inv ? investigationHtml(career, s, e, inv, investigating) : ""}
      ${
        showChoices
          ? `<div class="choices">${e.choices.map((c, i) => `<button class="choice" data-i="${i}">${esc(c.label)}</button>`).join("")}</div>`
          : ""
      }
      ${glossFor(career, visible)}
      <details class="src"><summary>這個情境的依據</summary>${sourcesHtml(e.sources)}</details>
    </main>`;
  root.querySelectorAll<HTMLButtonElement>(".choice").forEach((b) =>
    b.addEventListener("click", () => setState(choose(career, s, Number(b.dataset.i)))),
  );
  root.querySelectorAll<HTMLButtonElement>(".inv-card").forEach((b) =>
    b.addEventListener("click", () => setState(inspect(career, s, b.dataset.id!))),
  );
  root.querySelector("#page-next")?.addEventListener("click", () => {
    bodyPage = { eventId: e.id, index: bodyPage.index + 1 };
    render();
  });
  bindBack();
  bindTerms();
}

// ── 第一人稱文字 RPG 版面（v0.12，軟體工程師遊玩時）────────────
// 場景鋪滿畫面；上方 HUD（時鐘、倒數、徽章、三個小條、回到選單；全螢幕按鈕在右上角，HUD 留位置），
// 下方半透明深色對話框（名牌＝說話者、內文分頁、回應列表）。小遊戲與查資料顯示在場景裡的螢幕上：
// 鏡頭推近座位的電腦螢幕，任務介面是對齊螢幕投影位置的 DOM 疊層；做完（選了選項）鏡頭拉回。

/** 文字 RPG 版面是否開啟（遊玩畫面 + 第一人稱） */
let rpg = false;
/** 目前要推近的螢幕、推近是否完成、螢幕投影在畫面上的矩形 */
let wantScreen: string | null = null;
let focusReady = false;
let taskRect: PxRect | null = null;

function setRpg(on: boolean): void {
  if (on === rpg) return;
  rpg = on;
  if (on) {
    window.addEventListener("keydown", onRpgKey);
    scene?.onScreenRect((r) => {
      taskRect = r;
      placeTaskScreen();
    });
  } else {
    window.removeEventListener("keydown", onRpgKey);
    scene?.onScreenRect(undefined);
    wantScreen = null;
    focusReady = false;
    taskRect = null;
    root?.style.removeProperty("--hud-h");
    root?.style.removeProperty("--dlg-h");
  }
}

/** 可見範圍：HUD 下緣到對話框上緣（視窗座標） */
function rpgRegion(): PxRect {
  const hud = root.querySelector(".hud")?.getBoundingClientRect();
  const dlg = root.querySelector(".dlg")?.getBoundingClientRect();
  const top = hud ? hud.bottom : 0;
  const bottom = dlg ? dlg.top : window.innerHeight;
  return { x: 0, y: top, w: window.innerWidth, h: Math.max(0, bottom - top) };
}

/** 推近（或拉回）螢幕；同一個螢幕不重複推近 */
function syncScreen(want: string | null): void {
  if (!scene) return;
  if (want === wantScreen) return placeTaskScreen();
  wantScreen = want;
  focusReady = false;
  taskRect = null;
  const mine = want;
  void scene.focusScreen(want).then(() => {
    if (wantScreen !== mine) return;
    focusReady = true;
    placeTaskScreen();
  });
}

/**
 * 把螢幕上的任務疊層放到螢幕投影的位置（與可見範圍的交集）；推近還沒完成時先隱藏。
 * 投影不在畫面上時放在可見範圍中央；會議室的投影片疊層是裝飾，對不準時就不顯示。
 */
function placeTaskScreen(): void {
  if (!rpg) return;
  const el = root.querySelector<HTMLElement>(".task-screen[data-bind]");
  if (!el) return;
  if (!focusReady) {
    el.style.visibility = "hidden";
    el.dataset.fit = "pending";
    return;
  }
  const { rect, fit } = fitTaskRect(taskRect, rpgRegion());
  const decorative = el.classList.contains("slide");
  el.style.left = `${rect.x.toFixed(1)}px`;
  el.style.top = `${rect.y.toFixed(1)}px`;
  el.style.width = `${rect.w.toFixed(1)}px`;
  el.style.height = `${rect.h.toFixed(1)}px`;
  el.style.visibility = decorative && fit === "fallback" ? "hidden" : "visible";
  el.dataset.fit = fit;
}

/** 選一件待辦：就在這裡直接顯示；在別的地點就漸黑傳送過去 */
function pickQuest(career: Career, o: GameEvent): void {
  if (!state || walking) return;
  const elsewhere = !!scene && !!o.location && !scene.at(o.location);
  if (elsewhere) walking = true; // 先標記，避免「之後自動帶我去」重複觸發
  setState(selectEvent(career, state, o.id));
  if (elsewhere) {
    walking = false;
    travelTo(career, o.id, o.location!);
    render();
  }
}

/** 鍵盤：Enter／空白鍵 = 繼續（或「帶我去」），數字鍵 1–9 選回應、待辦或螢幕上的卡片；焦點在按鈕上時交給瀏覽器 */
function onRpgKey(ev: KeyboardEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
  const t = ev.target as HTMLElement | null;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const onControl = !!t && t !== document.body && !!t.closest("button, a, summary, label");
  if (ev.key === "Enter" || ev.key === " ") {
    if (onControl || ev.repeat) return;
    const btn = root.querySelector<HTMLButtonElement>("#page-next, #next, #ack-expired, #go-there:not([disabled])");
    if (btn) {
      ev.preventDefault();
      btn.click();
    }
    return;
  }
  if (/^[1-9]$/.test(ev.key) && !ev.repeat) {
    const list = [...root.querySelectorAll<HTMLButtonElement>(".dlg .choice, .dlg .quest")];
    const pool = list.length ? list : [...root.querySelectorAll<HTMLButtonElement>(".task-screen .inv-card")];
    const b = pool[Number(ev.key) - 1];
    if (b && !b.disabled) {
      ev.preventDefault();
      b.click();
    }
  }
}

const keyHint = (i: number): string => (i < 9 ? `<span class="k" aria-hidden="true">${i + 1}</span>` : "");

/** 上方 HUD：回到選單、時鐘與地點、倒數、徽章、三個小條、一天的進度 */
function hudHtml(career: Career, s: GameState, now: string): string {
  const p = Math.round(timelineProgress(career, s) * 100);
  const badge = currentBadge(career, s.flags);
  const chip = badge ? `<span class="badge ${badge.tone}">${esc(badge.label)}</span>` : "";
  return `<header class="hud">
    <div class="hud-top">
      <button class="link hud-back" id="back">← 回到選單</button>
      <p class="now">${esc(now)}${timerChip(career, s)}${chip}</p>
    </div>
    ${statsHtml(s)}
    <div class="hud-day" role="progressbar" aria-label="一天的進度 ${esc(career.dayStart)}–${esc(career.dayEnd)}" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><div style="width:${p}%"></div></div>
  </header>`;
}

/** 下方對話框：有說話者時顯示名牌（沒有就是旁白，不顯示名牌） */
function dlgHtml(speaker: string | undefined, body: string): string {
  return `<section class="dlg${speaker ? " has-name" : ""}" aria-label="${speaker ? `${esc(speaker)}說` : "對話框"}">
    ${speaker ? `<p class="dlg-name">${esc(speaker)}</p>` : ""}
    <div class="dlg-scroll">${body}</div>
  </section>`;
}

/** 回應列表（▸ 選項），數字鍵對應順序 */
function choiceListHtml(labels: string[]): string {
  return `<div class="choices" role="group" aria-label="你的回應">${labels
    .map((l, i) => `<button class="choice" data-i="${i}">${keyHint(i)}<span class="choice-label">${esc(l)}</span></button>`)
    .join("")}</div>`;
}

function rpgScreen(career: Career, s: GameState, now: string, parts: { overlay?: string; dlg: string }): void {
  root.innerHTML = `<main class="screen play rpg">${hudHtml(career, s, now)}${parts.overlay ?? ""}${parts.dlg}</main>`;
  applyInsets();
  placeTaskScreen();
  bindBack();
  bindTerms();
}

const placeOf = (career: Career, id: string | undefined): string | undefined => career.locations?.find((l) => l.id === id)?.name;

/** 事件（前往、打斷、結果、內文分頁、查資料、回應）的文字 RPG 畫面 */
function renderRpgEvent(career: Career, s: GameState, e: GameEvent): void {
  const now = `${timeLabel(career, s, e.time)}・${placeOf(career, e.location) ?? CATEGORY_LABELS[e.category]}`;
  // 前往別的地點：對話框顯示「下一步」，按「帶我去」（或 Enter）漸黑過去
  if (!s.pendingOutcome && scene && e.location && !scene.at(e.location)) {
    syncScreen(null);
    const place = placeOf(career, e.location) ?? "下一個地點";
    rpgScreen(career, s, now, {
      dlg: dlgHtml(
        undefined,
        `<article class="guide">
          <p class="kicker">下一步</p>
          <h2>前往：${esc(place)}</h2>
          <p class="muted">${esc(e.time)}・${CATEGORY_LABELS[e.category]}，有事情需要你處理。</p>
          ${walking ? `<p class="dlg-wait" role="status">前往${esc(place)}…</p>` : `<button class="primary" id="go-there">帶我去</button>`}
          <label class="auto-walk"><input type="checkbox" id="auto-walk" ${autoWalk ? "checked" : ""} /> 之後自動帶我去</label>
        </article>`,
      ),
    });
    const go = (): void => {
      if (walking || !scene) return;
      travelTo(career, e.id, e.location!);
      if (walking) render();
    };
    root.querySelector("#go-there")?.addEventListener("click", go);
    root.querySelector<HTMLInputElement>("#auto-walk")!.addEventListener("change", (ev) => {
      autoWalk = (ev.target as HTMLInputElement).checked;
      saveAutoWalk(autoWalk);
      if (autoWalk) go();
    });
    if (autoWalk && !walking) go();
    return;
  }
  const itr = currentInterrupt(career, s);
  if (itr) return renderRpgInterrupt(career, s, itr, now);
  if (s.pendingOutcome) {
    syncScreen(null);
    const ch = e.choices[s.pendingOutcome.choiceIndex];
    rpgScreen(career, s, now, {
      dlg: dlgHtml(
        e.speaker,
        `<article class="card">
          <p class="kicker">你選了：${esc(ch.label)}</p>
          <p class="outcome">${annotate(ch.outcome, career)}</p>
          <div class="deltas">${deltaHtml(ch.effects)}</div>
        </article>
        <button class="primary" id="next">繼續</button>
        ${glossFor(career, [ch.label, ch.outcome])}`,
      ),
    });
    root.querySelector("#next")!.addEventListener("click", () => setState(advance(career, s)));
    return;
  }
  // 內文分頁；已經開始查資料的事件（例如重新整理後）直接回到最後一頁
  if (bodyPage.eventId !== e.id) {
    const started = s.inspected.some((k) => k.startsWith(`${e.id}:`));
    bodyPage = { eventId: e.id, index: started ? splitPages(e.body).length - 1 : 0 };
  }
  const pages = splitPages(e.body);
  const last = bodyPage.index >= pages.length - 1;
  const inv = e.investigate;
  const investigating = last && !!inv && !investigationDone(career, s, e);
  const showChoices = last && !investigating;
  const opened = inv ? inv.items.filter((it) => s.inspected.includes(`${e.id}:${it.id}`)) : [];
  // 畫面內任務：在座位查資料 → 推近電腦螢幕；技術分享會 → 會議室大螢幕；其他地點的查資料 → 上方的文件疊層
  const screen = scene?.screenFor(e.location, e.id, last && !!inv) ?? null;
  syncScreen(screen);
  let overlay = "";
  if (last && inv) {
    const panel = investigationHtml(career, s, e, inv, investigating);
    overlay = screen
      ? `<div class="task-screen monitor" data-bind data-screen="${esc(screen)}" style="visibility:hidden">${panel}</div>`
      : `<div class="task-screen doc">${panel}</div>`;
  } else if (screen) {
    overlay = `<div class="task-screen slide" data-bind data-screen="${esc(screen)}" aria-hidden="true" style="visibility:hidden">
      <p class="slide-kicker">${esc(placeOf(career, e.location) ?? "")}・${esc(e.time)}</p>
      <p class="slide-title">${esc(e.title)}</p>
      <p class="slide-sub">${CATEGORY_LABELS[e.category]}</p>
    </div>`;
  }
  // 查資料時，對話框跟著說明最新打開的那一張（完整內容留在螢幕上）
  const t = inv ? KIND_TEXT[inv.kind ?? "info"] : null;
  const latestKey = [...s.inspected].reverse().find((k) => k.startsWith(`${e.id}:`));
  const latest = inv && latestKey ? inv.items.find((it) => `${e.id}:${it.id}` === latestKey) : undefined;
  const found = inv ? opened.filter((it) => it.relevant).length : 0;
  const total = inv ? inv.items.filter((it) => it.relevant).length : 0;
  const latestHtml =
    latest && t
      ? `<p class="dlg-find"><strong>${inv!.kind === "review" ? `第 ${inv!.items.indexOf(latest) + 1} 行` : annotate(latest.label, career)}</strong>：<span class="inv-mark ${latest.relevant ? "yes" : "no"}">${latest.relevant ? t.yes : t.no}</span>${latest.why ? ` ${annotate(latest.why, career)}` : ""}</p>`
      : "";
  const where = screen ? "螢幕上" : "上方";
  const taskHint =
    last && inv && t
      ? investigating
        ? `<p class="dlg-task">在${where}找出 ${total} ${esc(t.unit)}（已找到 ${found}）。${deadlineOf(career, s) !== null ? `${t.each}花 ${INSPECT_MINUTES} 分鐘。` : ""}</p>`
        : `<p class="dlg-task done">都找到了（${found} / ${total}）。要怎麼做？</p>`
      : "";
  const visible = [
    e.title,
    pages[bodyPage.index],
    ...(last && inv
      ? [
          inv.prompt,
          ...(inv.kind === "review" ? [] : inv.items.map((it) => it.label)),
          ...opened.flatMap((it) => [it.detail, it.why ?? ""]),
          !investigating ? (inv.tip ?? "") : "",
        ]
      : []),
    ...(showChoices ? e.choices.map((c) => c.label) : []),
  ];
  rpgScreen(career, s, now, {
    overlay,
    dlg: dlgHtml(
      e.speaker,
      `<h2>${annotate(e.title, career)}</h2>
      <p>${annotate(pages[bodyPage.index], career)}</p>
      ${last ? "" : `<div class="pager"><span class="muted">${bodyPage.index + 1} / ${pages.length}</span><button class="primary" id="page-next">繼續</button></div>`}
      ${taskHint}${latestHtml}
      ${showChoices ? choiceListHtml(e.choices.map((c) => c.label)) : ""}
      ${glossFor(career, visible)}
      <details class="src"><summary>這個情境的依據</summary>${sourcesHtml(e.sources)}</details>`,
    ),
  });
  root.querySelectorAll<HTMLButtonElement>(".choice").forEach((b) => b.addEventListener("click", () => setState(choose(career, s, Number(b.dataset.i)))));
  root.querySelectorAll<HTMLButtonElement>(".inv-card").forEach((b) => b.addEventListener("click", () => setState(inspect(career, s, b.dataset.id!))));
  root.querySelector("#page-next")?.addEventListener("click", () => {
    bodyPage = { eventId: e.id, index: bodyPage.index + 1 };
    render();
  });
  // 查完資料、回應列表剛出現：捲到看得到回應
  if (showChoices && inv && opened.length) root.querySelector(".dlg .choices")?.scrollIntoView({ block: "nearest" });
}

/** 打斷：來電是畫面上方的手機來電卡（回應在對話框），有人走過來是對話框（名牌是來的人） */
function renderRpgInterrupt(career: Career, s: GameState, itr: Interrupt, now: string): void {
  syncScreen(null);
  const visit = itr.via === "visit";
  const po = s.pendingOutcome;
  const outcome = po?.interrupt ? itr.choices[po.choiceIndex] : null;
  let overlay = "";
  if (!visit) {
    overlay = outcome
      ? `<article class="card call phone done" aria-label="通話結束">
          <p class="kicker">通話結束・${esc(itr.caller)}</p>
        </article>`
      : `<article class="card call phone" role="alertdialog" aria-label="來電：${esc(itr.caller)}">
          <p class="kicker"><span class="ring" aria-hidden="true"></span>來電</p>
          <p class="phone-caller">${esc(itr.caller)}</p>
          <h2>${annotate(itr.title, career)}</h2>
          <p>${annotate(itr.body, career)}</p>
        </article>`;
  }
  let body: string;
  if (outcome) {
    body = `<article class="card${visit ? " call done" : ""}">
        <p class="kicker">你選了：${esc(outcome.label)}</p>
        <p class="outcome">${annotate(outcome.outcome, career)}</p>
        <div class="deltas">${deltaHtml(outcome.effects)}</div>
      </article>
      <button class="primary" id="next">繼續</button>
      ${glossFor(career, [outcome.label, outcome.outcome])}`;
  } else {
    const head = visit
      ? `<article class="card call visit">
          <p class="kicker">有人找你・${esc(itr.caller)}</p>
          <h2>${annotate(itr.title, career)}</h2>
          <p>${annotate(itr.body, career)}</p>
        </article>`
      : `<p class="muted">電話響了，對方在等你回答。</p>`;
    body = `${head}${choiceListHtml(itr.choices.map((c) => c.label))}
      ${glossFor(career, [itr.title, itr.body, ...itr.choices.map((c) => c.label)])}
      <details class="src"><summary>這個情境的依據</summary>${sourcesHtml(itr.sources)}</details>`;
  }
  rpgScreen(career, s, now, { overlay, dlg: dlgHtml(itr.caller, body) });
  root.querySelector("#next")?.addEventListener("click", () => setState(advance(career, s)));
  root.querySelectorAll<HTMLButtonElement>(".choice").forEach((b) => b.addEventListener("click", () => setState(chooseInterrupt(career, s, Number(b.dataset.i)))));
}

/** 今天要處理的事：同時有好幾件時，對話框列出清單；別的地點的事標上地點，按下去就漸黑過去 */
function renderRpgBoard(career: Career, s: GameState, open: GameEvent[]): void {
  syncScreen(null);
  const timed = deadlineOf(career, s) !== null;
  rpgScreen(career, s, `${timeLabel(career, s, open[0].time)}・${open.length} 件待辦`, {
    dlg: dlgHtml(
      undefined,
      `<article class="guide">
        <p class="kicker">同時有 ${open.length} 件事</p>
        <h2>今天要處理的事</h2>
        <div class="quests">
          ${open
            .map((o, i) => {
              const here = !!scene && !!o.location && scene.at(o.location);
              const place = placeOf(career, o.location);
              return `<button class="quest" data-id="${esc(o.id)}">
                ${keyHint(i)}<span class="q-mark" aria-hidden="true">！</span>
                <span class="q-main"><strong>${esc(o.title)}</strong><span class="muted">${CATEGORY_LABELS[o.category]}</span></span>
                ${place ? `<span class="q-place${here ? " here" : ""}">${here ? "這裡" : `→ ${esc(place)}`}</span>` : ""}
              </button>`;
            })
            .join("")}
        </div>
        <p class="muted">順序由你決定，也可以點場景裡的「！」。別的地點的事，按下去就會過去${timed ? "（換地點多花 5 分鐘）" : ""}。</p>
      </article>`,
    ),
  });
  root.querySelectorAll<HTMLButtonElement>(".quest").forEach((b) =>
    b.addEventListener("click", () => {
      const o = open.find((x) => x.id === b.dataset.id);
      if (o) pickQuest(career, o);
    }),
  );
}

/** 時間到：對話框逐件說明來不及的後果 */
function renderRpgExpired(career: Career, s: GameState): void {
  syncScreen(null);
  const items = (s.expired ?? []).map((id) => career.events.find((e) => e.id === id)).filter((e): e is GameEvent => !!e);
  rpgScreen(career, s, `${timeLabel(career, s, items[0]?.time ?? "")}・時間到`, {
    dlg: dlgHtml(
      undefined,
      `<p class="kicker">時間到</p>
      <h2>有 ${items.length} 件事來不及</h2>
      <p class="muted">同時有太多事，沒辦法每件都處理。</p>
      ${items
        .map(
          (e) => `<article class="card expired">
            <h3>${esc(e.title)}</h3>
            <p>${esc(e.expire?.outcome ?? "")}</p>
            <div class="deltas">${deltaHtml(e.expire?.effects ?? {})}</div>
          </article>`,
        )
        .join("")}
      <button class="primary" id="ack-expired">繼續</button>`,
    ),
  });
  root.querySelector("#ack-expired")!.addEventListener("click", () => setState(ackExpired(s)));
}

/** 各種查資料外觀的用字：面板標題、進度單位、打開後的標示、扣時間提示 */
const KIND_TEXT: Record<InvestigationKind, { kicker: string; unit: string; yes: string; no: string; each: string }> = {
  info: { kicker: "查資料", unit: "份有關資料", yes: "有關 ✓", no: "無關", each: "每查一份資料" },
  review: { kicker: "Code review", unit: "行可能有問題", yes: "有問題 ✓", no: "沒問題", each: "每看一行" },
  debug: { kicker: "除錯", unit: "條有關線索", yes: "有關 ✓", no: "無關", each: "每看一條線索" },
  test: { kicker: "寫測試", unit: "個該測的情況", yes: "該測 ✓", no: "不用測", each: "每考慮一個情況" },
};

/** 查資料面板：任務說明、進度、資料卡；打開過的卡留著內容與白話說明。外觀依 kind 而不同，判定相同 */
function investigationHtml(career: Career, s: GameState, e: GameEvent, inv: Investigation, active: boolean): string {
  const kind: InvestigationKind = inv.kind ?? "info";
  const t = KIND_TEXT[kind];
  const isOpen = (it: InvestigationItem) => s.inspected.includes(`${e.id}:${it.id}`);
  const opened = inv.items.filter(isOpen);
  const total = inv.items.filter((it) => it.relevant).length;
  const found = opened.filter((it) => it.relevant).length;
  const mark = (it: InvestigationItem) => (isOpen(it) ? `<span class="inv-mark ${it.relevant ? "yes" : "no"}">${it.relevant ? t.yes : t.no}</span>` : "");
  const cls = (it: InvestigationItem) => `inv-card inv-${kind} ${isOpen(it) ? (it.relevant ? "yes" : "no") : ""}`;
  const attrs = (it: InvestigationItem) => `type="button" data-id="${esc(it.id)}" ${isOpen(it) || !active ? "disabled" : ""}`;
  const lineNo = (it: InvestigationItem) => inv.items.indexOf(it) + 1;
  let cards: string;
  if (kind === "review") {
    cards = `<div class="inv-code">${inv.items
      .map((it) => `<button ${attrs(it)} class="${cls(it)}"><span class="ln">${lineNo(it)}</span><code class="inv-label">${esc(it.label)}</code>${mark(it)}</button>`)
      .join("")}</div>`;
  } else if (kind === "test") {
    cards = `<div class="inv-list">${inv.items
      .map((it) => `<button ${attrs(it)} class="${cls(it)}"><span class="box" aria-hidden="true">${isOpen(it) ? (it.relevant ? "☑" : "☒") : "☐"}</span><span class="inv-label">${esc(it.label)}</span>${mark(it)}</button>`)
      .join("")}</div>`;
  } else {
    const tag = (it: InvestigationItem) => (kind === "debug" && it.tag ? `<span class="inv-tag">${esc(it.tag)}</span>` : "");
    cards = `<div class="inv-grid">${inv.items
      .map((it) => `<button ${attrs(it)} class="${cls(it)}">${tag(it)}<span class="inv-label">${esc(it.label)}</span>${mark(it)}</button>`)
      .join("")}</div>`;
  }
  const hint = active && deadlineOf(career, s) !== null ? `<p class="muted inv-hint">${t.each}花 ${INSPECT_MINUTES} 分鐘</p>` : "";
  const why = (it: InvestigationItem) => (it.why ? `<span class="inv-why">${annotate(it.why, career)}</span>` : "");
  const detail = (it: InvestigationItem) => {
    if (kind === "review") return `<li><strong>第 ${lineNo(it)} 行</strong>：${annotate(it.detail, career)}${why(it)}</li>`;
    if (kind === "debug") return `<li><strong>${annotate(it.label, career)}</strong><code class="inv-term">${esc(it.detail)}</code>${why(it)}</li>`;
    return `<li><strong>${annotate(it.label, career)}</strong>：${annotate(it.detail, career)}${why(it)}</li>`;
  };
  const tip = !active && inv.tip ? `<p class="inv-tip"><strong>小知識：</strong>${annotate(inv.tip, career)}</p>` : "";
  const pending = inv.reviewPending ? `<span class="inv-pending">內容待從業者審查</span>` : "";
  return `<section class="card inv inv-kind-${kind}" aria-label="${t.kicker}">
    <div class="inv-head"><p class="kicker">${t.kicker}</p>${pending}</div>
    <p class="inv-prompt">${annotate(inv.prompt, career)}</p>
    <p class="inv-progress">已找到 ${found} / ${total} ${t.unit}</p>
    ${cards}
    ${hint}
    ${opened.length ? `<ul class="inv-details">${opened.map(detail).join("")}</ul>` : ""}
    ${tip}
  </section>`;
}

/** 打斷事件（來電、訊息）：事件到了畫面上時先跳出來，回應完才回到原本的事件 */
function renderInterrupt(career: Career, s: GameState, itr: Interrupt, head: string): void {
  const po = s.pendingOutcome;
  if (po?.interrupt) {
    const ch = itr.choices[po.choiceIndex];
    root.innerHTML = `
      <main class="screen play">
        ${head}
        <article class="card call done">
          <p class="kicker">${itr.via === "visit" ? "有人找你" : "來電"}・${esc(itr.caller)}</p>
          <p class="muted">你選了：${esc(ch.label)}</p>
          <p class="outcome">${annotate(ch.outcome, career)}</p>
          <div class="deltas">${deltaHtml(ch.effects)}</div>
        </article>
        ${glossFor(career, [ch.label, ch.outcome])}
        <button class="primary" id="next">繼續</button>
      </main>`;
    root.querySelector("#next")!.addEventListener("click", () => setState(advance(career, s)));
    bindBack();
    bindTerms();
    return;
  }
  root.innerHTML = `
    <main class="screen play">
      ${head}
      <article class="card call">
        <p class="kicker"><span class="ring" aria-hidden="true"></span>${itr.via === "visit" ? "有人找你" : "來電"}・${esc(itr.caller)}</p>
        <h2>${annotate(itr.title, career)}</h2>
        <p>${annotate(itr.body, career)}</p>
      </article>
      <div class="choices">
        ${itr.choices.map((c, i) => `<button class="choice" data-i="${i}">${esc(c.label)}</button>`).join("")}
      </div>
      ${glossFor(career, [itr.title, itr.body, ...itr.choices.map((c) => c.label)])}
      <details class="src"><summary>這個情境的依據</summary>${sourcesHtml(itr.sources)}</details>
    </main>`;
  root.querySelectorAll<HTMLButtonElement>(".choice").forEach((b) =>
    b.addEventListener("click", () => setState(chooseInterrupt(career, s, Number(b.dataset.i)))),
  );
  bindBack();
  bindTerms();
}

/** 時間到：其餘還開著的事件來不及處理，逐件說明後果 */
function renderExpired(career: Career, s: GameState): void {
  if (s.phase === "play") updateStage(career, s, null, false);
  if (rpg && s.phase === "play") return renderRpgExpired(career, s);
  const items = (s.expired ?? []).map((id) => career.events.find((e) => e.id === id)).filter((e): e is GameEvent => !!e);
  root.innerHTML = `
    <main class="screen play">
      ${backButton()}
      <p class="kicker">時間到</p>
      <h1>有 ${items.length} 件事來不及</h1>
      <p class="muted">同時有太多事，沒辦法每件都處理。</p>
      ${items
        .map(
          (e) => `<article class="card expired">
            <h2>${esc(e.title)}</h2>
            <p>${esc(e.expire?.outcome ?? "")}</p>
            <div class="deltas">${deltaHtml(e.expire?.effects ?? {})}</div>
          </article>`,
        )
        .join("")}
      ${statsHtml(s)}
      <button class="primary" id="ack-expired">繼續</button>
    </main>`;
  bindBack();
  root.querySelector("#ack-expired")!.addEventListener("click", () => setState(ackExpired(s)));
}

/** 同時有好幾件待辦：由玩家決定先做哪一件 */
function renderQuestBoard(career: Career, s: GameState, open: GameEvent[]): void {
  updateStage(career, s, null);
  if (rpg) return renderRpgBoard(career, s, open);
  const placeName = (id: string | undefined) => career.locations?.find((l) => l.id === id)?.name;
  const head = `${backButton()}${timelineHtml(career, s, `${timeLabel(career, s, open[0].time)}・${open.length} 件待辦`)}${statsHtml(s)}`;
  root.innerHTML = `
    <main class="screen play">
      ${head}
      <article class="card guide">
        <p class="kicker">同時有 ${open.length} 件事</p>
        <h2>先處理哪一件？</h2>
        <div class="quests">
          ${open
            .map(
              (o) => `<button class="quest" data-id="${esc(o.id)}">
                <span class="q-mark" aria-hidden="true">！</span>
                <span class="q-main"><strong>${esc(o.title)}</strong>
                <span class="muted">${esc(placeName(o.location) ?? "")}${placeName(o.location) ? "・" : ""}${CATEGORY_LABELS[o.category]}</span></span>
              </button>`,
            )
            .join("")}
        </div>
        <p class="muted">順序由你決定，也可以直接點場景裡的「！」。處理完一件，剩下的還在。</p>
      </article>
    </main>`;
  bindBack();
  root.querySelectorAll<HTMLButtonElement>(".quest").forEach((b) =>
    b.addEventListener("click", () => setState(selectEvent(career, s, b.dataset.id!))),
  );
}

/** 事件在別的地點：先出現「下一步」引導，按「帶我去」角色才走過去，到了才顯示事件 */
function renderTravel(career: Career, s: GameState, e: GameEvent, head: string): void {
  const place = career.locations?.find((l) => l.id === e.location)?.name ?? "下一個地點";
  root.innerHTML = `
    <main class="screen play">
      ${head}
      <article class="card guide">
        <p class="kicker">下一步</p>
        <h2>前往：${esc(place)}</h2>
        <p class="muted">${esc(e.time)}・${CATEGORY_LABELS[e.category]}，有事情需要你處理。看場景裡的「！」標記。</p>
        <button class="primary" id="go-there" ${walking ? "disabled" : ""}>${walking ? (scene?.viewMode() === "first" ? "前往中…" : "走過去中…") : "帶我去"}</button>
        ${scene?.canWalk() ? `<p class="muted walk-hint">也可以自己走過去（點地板或用方向鍵）</p>` : ""}
        <label class="auto-walk"><input type="checkbox" id="auto-walk" ${autoWalk ? "checked" : ""} /> 之後自動帶我去</label>
      </article>
    </main>`;
  bindBack();
  const go = (): void => {
    if (walking || !scene) return;
    if (scene.viewMode() === "first") {
      travelTo(career, e.id, e.location!);
      if (walking) render();
      return;
    }
    walking = true;
    scene.goTo(e.location!, () => {
      walking = false;
      if (state && currentEvent(career, state)?.id === e.id) render();
    });
    if (walking) render();
  };
  root.querySelector("#go-there")!.addEventListener("click", go);
  root.querySelector<HTMLInputElement>("#auto-walk")!.addEventListener("change", (ev) => {
    autoWalk = (ev.target as HTMLInputElement).checked;
    saveAutoWalk(autoWalk);
    if (autoWalk) go();
  });
  if (autoWalk && !walking) go();
}

function biggestGapText(career: Career, s: GameState): string {
  const { biggest } = compareAllocation(career, s);
  const dir = biggest.gap > 0 ? "比你想的多" : "比你想的少";
  return `「${CATEGORY_LABELS[biggest.category]}」${dir} ${Math.abs(biggest.gap)} 個百分點`;
}

/** 從業者回饋：有紀錄時在對照畫面的來源區顯示一行，展開可看摘要 */
function feedbackHtml(career: Career): string {
  const list = career.practitionerFeedback ?? [];
  if (list.length === 0) return "";
  const dates = list.map((f) => f.date).sort();
  return `<details class="src feedback"><summary>已參考從業者回饋（${esc(dates.join("、"))}）</summary>${list
    .map((f) => `<p class="muted">${esc(f.date)}：${esc(f.summary)}</p>`)
    .join("")}</details>`;
}

function renderCompare(career: Career, s: GameState): void {
  const { rows, biggest } = compareAllocation(career, s);
  const estimate = allocationIsEstimate(career);
  root.innerHTML = `
    <main class="screen">
      <p class="kicker">第 3 步・對照</p>
      <h1>想像 vs 實際</h1>
      ${estimate ? `<p class="notice warn">此比例為推估：目前還沒有可直接引用的公開數字，請參考下方來源說明。</p>` : `<p class="notice">此比例由公開調查換算而來，換算方式與限制見下方「比例來源」。</p>`}
      <div class="legend"><span class="sw pred"></span>你的預測 <span class="sw act"></span>${estimate ? "推估比例" : "公開資料換算"}</div>
      <div class="compare">
        ${rows
          .map(
            (r) => `<div class="row ${r.category === biggest.category ? "hl" : ""}">
              <div class="row-head"><span>${CATEGORY_LABELS[r.category]}</span>
                <span class="muted">${r.predicted}% → ${r.actual}%</span></div>
              <div class="pair"><div class="b pred" style="width:${r.predicted}%"></div></div>
              <div class="pair"><div class="b act" style="width:${r.actual}%"></div></div>
            </div>`,
          )
          .join("")}
      </div>
      <article class="card">
        <h2>落差最大：${esc(biggestGapText(career, s))}</h2>
        <p>${esc(career.categoryNotes?.[biggest.category] ?? "")}</p>
      </article>
      <details class="src"><summary>比例來源</summary>${sourcesHtml(career.allocationSources)}</details>
      ${feedbackHtml(career)}
      <button class="primary" id="next">看結算</button>
    </main>`;
  root.querySelector("#next")!.addEventListener("click", () => setState(advance(career, s)));
}

function renderResult(career: Career, s: GameState): void {
  const p = buildProfile(s);
  const gapText = biggestGapText(career, s);
  const canvas = drawCard(career, p, allocationIsEstimate(career) ? `${gapText}（比例為推估）` : gapText, playerName);
  const url = canvas.toDataURL("image/png");
  root.innerHTML = `
    <main class="screen">
      <p class="kicker">第 4 步・結算</p>
      <h1>今天的${playerName ? esc(playerName) : "你"}</h1>
      <p class="notice">這張卡描述的是你今天做選擇時的節奏偏好與價值取向，不是「你適合當${esc(career.name)}」。</p>
      <img class="result-card" src="${url}" alt="結算卡：節奏${esc(p.pace.label)}，互動${esc(p.social.label)}，成就來源${esc(p.achieve.label)}，壓力類型${esc(p.pressure.label)}" />
      <p class="muted save-hint">長按上方結算卡圖片，選「加入照片」或「儲存圖片」即可存到手機，再分享給朋友。</p>
      <article class="card">
        <h2>想一想</h2>
        <ul>${career.reflections.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </article>
      <article class="card next-steps">
        <h2>接下來</h2>
        <p>同一個人、不同的工作：換一份工作再過一天，比較兩張結算卡，看看你的選擇會不會一樣。</p>
        <div class="next-actions">
          ${careers
            .filter((c) => c.id !== career.id)
            .map(
              (c) =>
                `<button class="secondary switch-career" data-id="${c.id}">換成${esc(c.name)}${c.entryTag ? `<span class="entry-tag">${esc(c.entryTag)}</span>` : ""}</button>`,
            )
            .join("")}
          <button class="secondary" id="replay">再玩一次${esc(career.name)}</button>
        </div>
      </article>
      <p class="muted">${DISCLAIMER}</p>
      <button class="link" id="again">← 回到選單</button>
    </main>`;
  root.querySelector("#again")!.addEventListener("click", () => setState(null));
  const start = (c: Career): void => {
    homeCareerId = c.id;
    draft = null;
    setState(newGame(c));
    window.scrollTo(0, 0);
  };
  root.querySelector("#replay")!.addEventListener("click", () => start(career));
  root.querySelectorAll<HTMLButtonElement>(".switch-career").forEach((b) =>
    b.addEventListener("click", () => start(getCareer(b.dataset.id!)!)),
  );
}

function backButton(): string {
  return `<button class="link" id="back">← 回到選單</button>`;
}

function bindBack(): void {
  root.querySelector("#back")?.addEventListener("click", () => setState(null));
}
