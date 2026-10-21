// 劇本格式合約（SPEC §2）。由主代理維護；修改需同步更新 SPEC。
// v0.1 之外新增的欄位都是選填：categoryNotes、practitionerFeedback。

export const CATEGORIES = ["core", "communicate", "admin", "wait", "learn"] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATS = ["energy", "time", "trust"] as const;
export type Stat = (typeof STATS)[number];

export const TRAITS = ["pace", "social", "achieve_people", "achieve_solve", "achieve_make"] as const;
export type Trait = (typeof TRAITS)[number];

export interface Source {
  type: "public_data" | "public_report" | "news" | "fiction";
  title: string;
  url?: string;
  note?: string;
}

export interface Choice {
  label: string;
  effects: Partial<Record<Stat, number>>;
  traits: Partial<Record<Trait, number>>;
  outcome: string;
  setFlags?: string[];
}

export interface GlossaryTerm {
  term: string;
  meaning: string;
  note?: string;
}

export interface Location {
  id: string;
  name: string;
}

export interface GameEvent {
  id: string;
  time: string;
  category: Category;
  title: string;
  body: string;
  choices: Choice[];
  tags: string[];
  sources: Source[];
  requires?: string[];
  /** 3D 場景中的地點（Career.locations 的 id） */
  location?: string;
}

export interface PractitionerFeedback {
  date: string;
  summary: string;
}

export interface Career {
  id: string;
  name: string;
  intro: string;
  dayStart: string;
  dayEnd: string;
  actualAllocation: Record<Category, number>;
  allocationSources: Source[];
  events: GameEvent[];
  reflections: string[];
  /** 對照畫面：落差最大的一類要顯示的說明（選填，v0.1 擴充） */
  categoryNotes?: Partial<Record<Category, string>>;
  /** 名詞折疊：工作中的專有名詞與一般性解釋 */
  glossary?: GlossaryTerm[];
  /** 3D 場景地點；有場景的職業必填 */
  locations?: Location[];
  /** 從業者回饋預留欄位（SPEC §3.4） */
  practitionerFeedback?: PractitionerFeedback[];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  core: "專業核心工作",
  communicate: "溝通協調",
  admin: "文書行政",
  wait: "等待／移動／零碎",
  learn: "學習與準備",
};

/** 「我以為這份工作不用做這個」事件的標籤 */
export const SURPRISE_TAG = "意想不到";
export const ACHIEVEMENT_TAG = "成就感";

export const LIMITS = {
  eventsMin: 8,
  eventsMax: 12,
  bodyMax: 80,
  labelMax: 20,
  outcomeMax: 60,
  effectAbsMax: 30,
  achievementMin: 2,
  glossaryMax: 80,
} as const;

/** 以 code point 計字數（中文一字算一） */
export const charLen = (s: string): number => [...s].length;

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function checkSources(sources: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push(`${where}: sources 必填且不可為空`);
    return;
  }
  for (const s of sources as Source[]) {
    if (!["public_data", "public_report", "news", "fiction"].includes(s.type)) {
      errors.push(`${where}: 來源 type 不合法 (${s.type})`);
    }
    if (!s.title) errors.push(`${where}: 來源缺 title`);
  }
}

/** 選項 a 是否在所有資源上都不差於 b，且至少一項更好（= 明顯正解） */
function dominates(a: Choice, b: Choice): boolean {
  let strictlyBetter = false;
  for (const s of STATS) {
    const av = a.effects[s] ?? 0;
    const bv = b.effects[s] ?? 0;
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** 驗證一份劇本，回傳錯誤訊息（空陣列 = 通過） */
export function validateCareer(c: Career): string[] {
  const errors: string[] = [];
  const at = (s: string) => `[${c.id}] ${s}`;

  for (const k of ["id", "name", "intro", "dayStart", "dayEnd"] as const) {
    if (typeof c[k] !== "string" || !c[k]) errors.push(at(`${k} 必填`));
  }
  if (!TIME_RE.test(c.dayStart) || !TIME_RE.test(c.dayEnd)) errors.push(at("dayStart/dayEnd 格式需為 HH:MM"));
  else if (toMinutes(c.dayStart) >= toMinutes(c.dayEnd)) errors.push(at("dayStart 需早於 dayEnd"));

  const alloc = c.actualAllocation ?? ({} as Record<Category, number>);
  const keys = Object.keys(alloc);
  if (keys.length !== CATEGORIES.length || !CATEGORIES.every((k) => typeof alloc[k] === "number" && alloc[k] >= 0)) {
    errors.push(at("actualAllocation 需剛好包含 5 個分類且皆為非負數"));
  }
  const sum = CATEGORIES.reduce((a, k) => a + (alloc[k] ?? 0), 0);
  if (sum !== 100) errors.push(at(`actualAllocation 加總需為 100（目前 ${sum}）`));
  checkSources(c.allocationSources, at("allocationSources"), errors);

  if (!Array.isArray(c.reflections) || c.reflections.length < 1 || c.reflections.length > 2) {
    errors.push(at("reflections 需 1–2 題"));
  }

  const events = c.events ?? [];
  if (events.length < LIMITS.eventsMin || events.length > LIMITS.eventsMax) {
    errors.push(at(`事件數需 ${LIMITS.eventsMin}–${LIMITS.eventsMax}（目前 ${events.length}）`));
  }
  const achievement = events.filter((e) => e.tags?.includes(ACHIEVEMENT_TAG)).length;
  if (achievement < LIMITS.achievementMin) errors.push(at(`「${ACHIEVEMENT_TAG}」事件至少 ${LIMITS.achievementMin} 個（目前 ${achievement}）`));

  const allText = [
    c.intro,
    ...events.flatMap((e) => [e.title, e.body, ...(e.choices ?? []).flatMap((ch) => [ch.label, ch.outcome])]),
  ].join("\n");
  const seenTerms = new Set<string>();
  for (const g of c.glossary ?? []) {
    const w = at(`名詞 ${g.term}`);
    if (!g.term) errors.push(at("glossary 有空白的 term"));
    if (seenTerms.has(g.term)) errors.push(`${w}: term 重複`);
    seenTerms.add(g.term);
    if (!g.meaning || charLen(g.meaning) > LIMITS.glossaryMax) errors.push(`${w}: meaning 需 1–${LIMITS.glossaryMax} 字（${charLen(g.meaning ?? "")}）`);
    if (g.term && !allText.includes(g.term)) errors.push(`${w}: 沒有出現在簡介或任何事件文字中`);
  }
  const locationIds = new Set((c.locations ?? []).map((l) => l.id));
  if (locationIds.size !== (c.locations ?? []).length) errors.push(at("locations 的 id 重複"));

  const ids = new Set<string>();
  const flagsSetBefore = new Set<string>();
  let prevTime = -1;
  for (const e of events) {
    const w = at(`事件 ${e.id}`);
    if (ids.has(e.id)) errors.push(`${w}: id 重複`);
    ids.add(e.id);
    if (!CATEGORIES.includes(e.category)) errors.push(`${w}: category 不合法`);
    if (!TIME_RE.test(e.time)) errors.push(`${w}: time 格式錯誤`);
    else {
      const t = toMinutes(e.time);
      if (t < toMinutes(c.dayStart) || t > toMinutes(c.dayEnd)) errors.push(`${w}: time 超出上下班時間`);
      if (t < prevTime) errors.push(`${w}: 事件需依時間排序`);
      prevTime = t;
    }
    if (!e.title) errors.push(`${w}: title 必填`);
    if (locationIds.size > 0 && (!e.location || !locationIds.has(e.location))) errors.push(`${w}: location 必須是 locations 其中之一（目前 ${e.location ?? "未填"}）`);
    if (locationIds.size === 0 && e.location) errors.push(`${w}: 有 location 但職業沒有定義 locations`);
    if (charLen(e.body ?? "") > LIMITS.bodyMax) errors.push(`${w}: body 超過 ${LIMITS.bodyMax} 字（${charLen(e.body)}）`);
    if (!Array.isArray(e.tags)) errors.push(`${w}: tags 必填`);
    checkSources(e.sources, w, errors);
    for (const f of e.requires ?? []) {
      if (!flagsSetBefore.has(f)) errors.push(`${w}: requires 的旗標 "${f}" 沒有被更早的選項設定`);
    }

    const choices = e.choices ?? [];
    if (choices.length < 2 || choices.length > 3) errors.push(`${w}: 選項需 2–3 個`);
    choices.forEach((ch, i) => {
      const cw = `${w} 選項${i + 1}`;
      if (charLen(ch.label ?? "") > LIMITS.labelMax || !ch.label) errors.push(`${cw}: label 需 1–${LIMITS.labelMax} 字`);
      if (charLen(ch.outcome ?? "") > LIMITS.outcomeMax || !ch.outcome) errors.push(`${cw}: outcome 需 1–${LIMITS.outcomeMax} 字（${charLen(ch.outcome ?? "")}）`);
      for (const [k, v] of Object.entries(ch.effects ?? {})) {
        if (!STATS.includes(k as Stat)) errors.push(`${cw}: 未知資源 ${k}`);
        if (Math.abs(v as number) > LIMITS.effectAbsMax) errors.push(`${cw}: effects.${k} 超出 ±${LIMITS.effectAbsMax}`);
      }
      for (const k of Object.keys(ch.traits ?? {})) {
        if (!TRAITS.includes(k as Trait)) errors.push(`${cw}: 未知特質 ${k}`);
      }
      if (!Object.values(ch.effects ?? {}).some((v) => (v as number) < 0)) errors.push(`${cw}: 每個選項都要有代價（至少一項資源為負）`);
    });
    for (const a of choices) {
      for (const b of choices) {
        if (a !== b && dominates(a, b)) errors.push(`${w}: 「${a.label}」全面優於「${b.label}」，形成明顯正解`);
      }
    }
    for (const ch of choices) for (const f of ch.setFlags ?? []) flagsSetBefore.add(f);
  }
  return errors;
}
