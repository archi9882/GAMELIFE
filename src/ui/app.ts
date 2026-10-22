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
import { createScene, hasScene, type SceneHandle } from "../scene";
import { drawCard } from "./card";
import { load, loadAutoWalk, loadCodex, save, saveAutoWalk, saveCodex } from "./storage";

const DISCLAIMER = "情境為虛構，比例依據見來源。";
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
let scene: SceneHandle | null = null;
let sceneCareerId: string | null = null;
let state: GameState | null = null;
let draft: Record<Category, number> | null = null;

function setState(s: GameState | null): void {
  state = s;
  save(s);
  render();
  window.scrollTo(0, 0);
}

export function mount(el: HTMLElement): void {
  el.innerHTML = `<div id="stage" hidden><div id="stage-canvas"></div><span id="stage-label" class="stage-label"></span></div><div id="ui"></div>`;
  stageEl = el.querySelector("#stage")!;
  stageHost = el.querySelector("#stage-canvas")!;
  stageLabel = el.querySelector("#stage-label")!;
  root = el.querySelector("#ui")!;
  codex = loadCodex();
  autoWalk = loadAutoWalk();
  const saved = load();
  state = saved && getCareer(saved.careerId) && Array.isArray(saved.done) && Array.isArray(saved.inspected) ? saved : null;
  render();
}

function leaveStage(dispose: boolean): void {
  stageEl.hidden = true;
  scene?.setActive(false);
  if (dispose) {
    walking = false;
    scene?.dispose();
    scene = null;
    sceneCareerId = null;
  }
}

/** 遊玩畫面上方的 3D 場景；沒有場景或不支援 WebGL 時隱藏，退回純卡片 */
function updateStage(career: Career, s: GameState, e: GameEvent | null): void {
  if (!hasScene(career.id)) return leaveStage(false);
  stageEl.hidden = false;
  if (!scene || sceneCareerId !== career.id) {
    scene?.dispose();
    scene = createScene(career.id, stageHost);
    sceneCareerId = career.id;
  }
  if (!scene) {
    stageEl.hidden = true;
    return;
  }
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
      if (target && state) setState(selectEvent(career, state, target.id));
    },
  );
  stageLabel.textContent = e ? `${timeLabel(career, s, e.time)}${placeName(e.location) ? `・${placeName(e.location)}` : ""}` : `${open[0] ? timeLabel(career, s, open[0].time) : ""}・${open.length} 件待辦`;
}

function render(): void {
  if (!state) {
    leaveStage(true);
    return codexOpen ? renderCodex() : renderHome();
  }
  const career = getCareer(state.careerId)!;
  if (state.phase !== "play") leaveStage(false);
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
  root.innerHTML = `
    <main class="screen">
      <header class="hero">
        <p class="kicker">10–15 分鐘・免登入</p>
        <h1>職場一日</h1>
        <p>先猜猜看一份工作的一天怎麼分配，再實際過一天，看看想像和現實差多少。</p>
      </header>
      <p class="notice">${DISCLAIMER}這不是職業測驗，不會告訴你「適合」什麼。</p>
      <h2>選一份工作</h2>
      <div class="career-list">
        ${careers
          .map(
            (c) => `<button class="career" data-id="${c.id}">
              <span class="career-name"><strong>${esc(c.name)}</strong>${c.entryTag ? `<span class="entry-tag">${esc(c.entryTag)}</span>` : ""}</span>
              <span>${esc(c.dayStart)}–${esc(c.dayEnd)}</span>
            </button>`,
          )
          .join("")}
      </div>
      <button class="secondary" id="codex">名詞圖鑑（已收集 ${progress(codex, careers).all.collected} / ${progress(codex, careers).all.total}）</button>
    </main>`;
  root.querySelector("#codex")!.addEventListener("click", () => {
    codexOpen = true;
    render();
    window.scrollTo(0, 0);
  });
  root.querySelectorAll<HTMLButtonElement>(".career").forEach((b) =>
    b.addEventListener("click", () => {
      draft = null;
      setState(newGame(getCareer(b.dataset.id!)!));
    }),
  );
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
    ...(last && inv ? [inv.prompt, ...inv.items.map((it) => it.label), ...opened.map((it) => it.detail)] : []),
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

/** 查資料面板：任務說明、進度、資料卡；打開過的卡留著內容。查完後只剩已打開的內容 */
function investigationHtml(career: Career, s: GameState, e: GameEvent, inv: Investigation, active: boolean): string {
  const isOpen = (it: Investigation["items"][number]) => s.inspected.includes(`${e.id}:${it.id}`);
  const opened = inv.items.filter(isOpen);
  const total = inv.items.filter((it) => it.relevant).length;
  const found = opened.filter((it) => it.relevant).length;
  const cards = inv.items
    .map((it) => {
      const o = isOpen(it);
      const mark = o ? `<span class="inv-mark ${it.relevant ? "yes" : "no"}">${it.relevant ? "有關 ✓" : "無關"}</span>` : "";
      return `<button type="button" class="inv-card ${o ? (it.relevant ? "yes" : "no") : ""}" data-id="${esc(it.id)}" ${o || !active ? "disabled" : ""}><span class="inv-label">${esc(it.label)}</span>${mark}</button>`;
    })
    .join("");
  const hint = active && deadlineOf(career, s) !== null ? `<p class="muted inv-hint">每查一份資料花 ${INSPECT_MINUTES} 分鐘</p>` : "";
  return `<section class="card inv" aria-label="查資料">
    <p class="kicker">查資料</p>
    <p class="inv-prompt">${annotate(inv.prompt, career)}</p>
    <p class="inv-progress">已找到 ${found} / ${total} 份有關資料</p>
    <div class="inv-grid">${cards}</div>
    ${hint}
    ${opened.length ? `<ul class="inv-details">${opened.map((it) => `<li><strong>${annotate(it.label, career)}</strong>：${annotate(it.detail, career)}</li>`).join("")}</ul>` : ""}
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
          <p class="kicker">來電・${esc(itr.caller)}</p>
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
        <p class="kicker"><span class="ring" aria-hidden="true"></span>來電・${esc(itr.caller)}</p>
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
  if (s.phase === "play") updateStage(career, s, null);
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
        <button class="primary" id="go-there" ${walking ? "disabled" : ""}>${walking ? "走過去中…" : "帶我去"}</button>
        <label class="auto-walk"><input type="checkbox" id="auto-walk" ${autoWalk ? "checked" : ""} /> 之後自動帶我去</label>
      </article>
    </main>`;
  bindBack();
  const go = (): void => {
    if (walking || !scene) return;
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
      <button class="primary" id="next">看結算</button>
    </main>`;
  root.querySelector("#next")!.addEventListener("click", () => setState(advance(career, s)));
}

function renderResult(career: Career, s: GameState): void {
  const p = buildProfile(s);
  const gapText = biggestGapText(career, s);
  const canvas = drawCard(career, p, allocationIsEstimate(career) ? `${gapText}（比例為推估）` : gapText);
  const url = canvas.toDataURL("image/png");
  root.innerHTML = `
    <main class="screen">
      <p class="kicker">第 4 步・結算</p>
      <h1>今天的你</h1>
      <p class="notice">這張卡描述的是你今天做選擇時的節奏偏好與價值取向，不是「你適合當${esc(career.name)}」。</p>
      <img class="result-card" src="${url}" alt="結算卡：節奏${esc(p.pace.label)}，互動${esc(p.social.label)}，成就來源${esc(p.achieve.label)}，壓力類型${esc(p.pressure.label)}" />
      <p class="muted save-hint">長按上方結算卡圖片，選「加入照片」或「儲存圖片」即可存到手機，再分享給朋友。</p>
      <article class="card">
        <h2>想一想</h2>
        <ul>${career.reflections.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </article>
      <p class="muted">${DISCLAIMER}</p>
      <button class="secondary" id="again">換一份工作</button>
    </main>`;
  root.querySelector("#again")!.addEventListener("click", () => setState(null));
}

function backButton(): string {
  return `<button class="link" id="back">← 回到選單</button>`;
}

function bindBack(): void {
  root.querySelector("#back")?.addEventListener("click", () => setState(null));
}
