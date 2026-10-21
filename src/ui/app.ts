// 畫面渲染：每次狀態改變就整頁重畫（畫面小，簡單優先）。
import { careers, getCareer } from "../../content/index";
import { CATEGORIES, CATEGORY_LABELS, type Career, type Category, type Source, type Stat } from "../../content/schema";
import {
  advance,
  choose,
  currentEvent,
  newGame,
  normalize,
  submitPrediction,
  timelineProgress,
  type GameState,
} from "../engine/game";
import { allocationIsEstimate, buildProfile, compareAllocation } from "../engine/scoring";
import { drawCard } from "./card";
import { load, save } from "./storage";

const DISCLAIMER = "情境為虛構，比例依據見來源。";
const STAT_LABELS: Record<Stat, string> = { energy: "精力", time: "時間", trust: "信任" };

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let root: HTMLElement;
let state: GameState | null = null;
let draft: Record<Category, number> | null = null;

function setState(s: GameState | null): void {
  state = s;
  save(s);
  render();
  window.scrollTo(0, 0);
}

export function mount(el: HTMLElement): void {
  root = el;
  const saved = load();
  state = saved && getCareer(saved.careerId) ? saved : null;
  render();
}

function render(): void {
  if (!state) return renderHome();
  const career = getCareer(state.careerId)!;
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
              <strong>${esc(c.name)}</strong>
              <span>${esc(c.dayStart)}–${esc(c.dayEnd)}</span>
            </button>`,
          )
          .join("")}
      </div>
    </main>`;
  root.querySelectorAll<HTMLButtonElement>(".career").forEach((b) =>
    b.addEventListener("click", () => {
      draft = null;
      setState(newGame(getCareer(b.dataset.id!)!));
    }),
  );
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
      <p>${esc(career.intro)}</p>
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
  root.querySelector("#go")!.addEventListener("click", () => {
    const next = submitPrediction(career, s, d);
    draft = null;
    setState(next);
  });
}

function timelineHtml(career: Career, s: GameState, now: string): string {
  const p = Math.round(timelineProgress(career, s) * 100);
  return `<div class="timeline" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
    <span>${esc(career.dayStart)}</span>
    <div class="track"><div class="fill" style="width:${p}%"></div><div class="dot" style="left:${p}%"></div></div>
    <span>${esc(career.dayEnd)}</span>
  </div>
  <p class="now">${esc(now)}</p>`;
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
  if (!e) return setState(advance(career, s));
  const head = `${backButton()}${timelineHtml(career, s, `${e.time}・${CATEGORY_LABELS[e.category]}`)}${statsHtml(s)}`;
  if (s.pendingOutcome) {
    const ch = e.choices[s.pendingOutcome.choiceIndex];
    root.innerHTML = `
      <main class="screen play">
        ${head}
        <article class="card">
          <p class="kicker">你選了：${esc(ch.label)}</p>
          <p class="outcome">${esc(ch.outcome)}</p>
          <div class="deltas">${deltaHtml(ch.effects)}</div>
        </article>
        <button class="primary" id="next">繼續</button>
      </main>`;
    root.querySelector("#next")!.addEventListener("click", () => setState(advance(career, s)));
    bindBack();
    return;
  }
  root.innerHTML = `
    <main class="screen play">
      ${head}
      <article class="card">
        <h2>${esc(e.title)}</h2>
        <p>${esc(e.body)}</p>
      </article>
      <div class="choices">
        ${e.choices.map((c, i) => `<button class="choice" data-i="${i}">${esc(c.label)}</button>`).join("")}
      </div>
      <details class="src"><summary>這個情境的依據</summary>${sourcesHtml(e.sources)}</details>
    </main>`;
  root.querySelectorAll<HTMLButtonElement>(".choice").forEach((b) =>
    b.addEventListener("click", () => setState(choose(career, s, Number(b.dataset.i)))),
  );
  bindBack();
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
      ${estimate ? `<p class="notice warn">此比例為推估：目前還沒有可直接引用的公開數字，請參考下方來源說明。</p>` : ""}
      <div class="legend"><span class="sw pred"></span>你的預測 <span class="sw act"></span>${estimate ? "推估比例" : "實際比例"}</div>
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
      <div class="actions">
        <a class="primary" id="dl" href="${url}" download="career-day-${career.id}.png">下載結算卡</a>
        <button class="secondary" id="share" hidden>分享</button>
      </div>
      <article class="card">
        <h2>想一想</h2>
        <ul>${career.reflections.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </article>
      <p class="muted">${DISCLAIMER}</p>
      <button class="secondary" id="again">換一份工作</button>
    </main>`;
  const share = root.querySelector<HTMLButtonElement>("#share")!;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], `career-day-${career.id}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      share.hidden = false;
      share.addEventListener("click", () => {
        navigator.share({ files: [file], title: "職場一日" }).catch(() => undefined);
      });
    }
  });
  root.querySelector("#again")!.addEventListener("click", () => setState(null));
}

function backButton(): string {
  return `<button class="link" id="back">← 回到選單</button>`;
}

function bindBack(): void {
  root.querySelector("#back")?.addEventListener("click", () => setState(null));
}
