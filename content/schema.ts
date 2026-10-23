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

export const BADGE_TONES = ["alert", "ok", "info"] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

/** 狀態徽章：由旗標決定，依序比對，第一個符合者顯示。沒有條件的規則放最後當預設。 */
export interface StatusBadge {
  label: string;
  tone: BadgeTone;
  /** 這些旗標都已設定時才符合 */
  flags?: string[];
}

/** 來不及處理時的後果（倒數計時到了、事件還開著） */
export interface Expire {
  effects: Partial<Record<Stat, number>>;
  traits?: Partial<Record<Trait, number>>;
  outcome: string;
  setFlags?: string[];
}

/** 事件進行中跳出來的插入事件（來電、訊息），剛好 2 個選項 */
export interface Interrupt {
  id: string;
  /** 被打斷的事件 id：該事件到了畫面上時出現 */
  during: string;
  caller: string;
  /** 怎麼找上你：call＝來電（預設）、visit＝有人走過來 */
  via?: "call" | "visit";
  title: string;
  body: string;
  choices: Choice[];
  tags: string[];
  sources: Source[];
  requires?: string[];
}

/** 查資料的外觀（引擎判定相同）：資料卡、程式碼審查、除錯、單元測試 */
export const INVESTIGATION_KINDS = ["info", "review", "debug", "test"] as const;
export type InvestigationKind = (typeof INVESTIGATION_KINDS)[number];

/** 除錯線索的標籤 */
export const DEBUG_TAGS = ["錯誤訊息", "程式碼", "環境"] as const;
export type DebugTag = (typeof DEBUG_TAGS)[number];

/** 查資料小遊戲的一張資料卡 */
export interface InvestigationItem {
  id: string;
  /** 卡片標題（打開前就看得到）；kind 為 review 時是一行程式碼 */
  label: string;
  /** 打開後的內容 */
  detail: string;
  /** 是否與任務有關；有關的卡都打開了才算查完 */
  relevant: boolean;
  /** 打開後的白話說明：為什麼有關或無關（選填） */
  why?: string;
  /** 除錯線索的標籤（只用在 kind 為 debug） */
  tag?: DebugTag;
}

/** 查資料：顯示選項前先從多張資料卡中找出有關的 */
export interface Investigation {
  prompt: string;
  items: InvestigationItem[];
  /** 外觀，預設 info */
  kind?: InvestigationKind;
  /** 查完後顯示的「小知識」 */
  tip?: string;
  /** 內容尚待從業者審查：面板顯示徽章 */
  reviewPending?: boolean;
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
  /** 這些旗標任一個已設定才出現（OR）；與 requires 同時使用時兩者都要符合 */
  requiresAny?: string[];
  /** 3D 場景中的地點（Career.locations 的 id） */
  location?: string;
  /** 同一個 group 的事件（需相鄰、time 相同）會同時開放，由玩家決定處理順序 */
  group?: string;
  /** 有時限的群組裡必填：來不及處理的後果 */
  expire?: Expire;
  /** 查資料：找齊有關的資料卡，才會出現選項 */
  investigate?: Investigation;
  /** 說話的人（例如「產品經理」）：第一人稱對話框的名牌；沒填時以旁白呈現（不顯示名牌） */
  speaker?: string;
}

/** 群組時限：基本分鐘數，加上條件事件「這局有出現」時的加時 */
export interface DeadlineSpec {
  base: number;
  /** { 事件 id: 加時分鐘 }：該事件這局有出現（前置旗標已符合）才加 */
  extra?: Record<string, number>;
}
export type Deadline = number | DeadlineSpec;

/** 把時限統一成 { base, extra } */
export const deadlineSpec = (d: Deadline): { base: number; extra: Record<string, number> } =>
  typeof d === "number" ? { base: d, extra: {} } : { base: d.base, extra: d.extra ?? {} };

/** 事件這局是否會出現：requires 全部符合，且 requiresAny（若有）至少一個符合 */
export function isAvailable(e: Pick<GameEvent, "requires" | "requiresAny">, flags: readonly string[]): boolean {
  const all = (e.requires ?? []).every((f) => flags.includes(f));
  const any = !e.requiresAny?.length || e.requiresAny.some((f) => flags.includes(f));
  return all && any;
}

/** 事件是否為條件事件（有前置旗標） */
export const isConditional = (e: GameEvent): boolean => !!(e.requires?.length || e.requiresAny?.length);

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
  /**
   * 群組時限（分鐘）：{ group id: 分鐘 } 或 { group id: { base, extra: { 事件 id: 加時 } } }。
   * 有時限的群組，所有事件都要有 expire。
   */
  deadlines?: Record<string, Deadline>;
  /** 打斷事件（來電、訊息） */
  interrupts?: Interrupt[];
  /** 首頁職業入口上的小標籤（例如「待優化」），選填 */
  entryTag?: string;
  /** 名詞折疊：工作中的專有名詞與一般性解釋 */
  glossary?: GlossaryTerm[];
  /** 狀態徽章規則（選填）；最後一條應無條件，當預設 */
  statusBadges?: StatusBadge[];
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

export const BASE_MINUTES = 10;
export const TRAVEL_MINUTES = 5;
/** 打開一張資料卡花掉的遊戲分鐘（只在有時限的群組才扣） */
export const INSPECT_MINUTES = 5;
/** 一個選項花掉的遊戲分鐘：基本 10 分鐘，加上 time 扣分 */
export const choiceMinutes = (c: Choice): number => BASE_MINUTES + Math.max(0, -(c.effects.time ?? 0));

export const LIMITS = {
  eventsMin: 8,
  eventsMax: 14,
  bodyMax: 80,
  labelMax: 20,
  outcomeMax: 60,
  effectAbsMax: 30,
  achievementMin: 2,
  glossaryMax: 80,
  badgeMax: 10,
  entryTagMax: 6,
  callerMax: 12,
  /** 事件說話者（對話框名牌）的字數上限 */
  speakerMax: 12,
  deadlineMin: 15,
  deadlineMax: 180,
  promptMax: 40,
  itemLabelMax: 12,
  /** kind 為 review 時，label 是一行程式碼（含註解） */
  codeLineMax: 60,
  itemDetailMax: 60,
  whyMax: 60,
  tipMax: 60,
  itemsMin: 4,
  itemsMax: 6,
  relevantMin: 2,
  relevantMax: 3,
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

function checkChoices(choices: Choice[], w: string, errors: string[], exact?: number): void {
  if (exact ? choices.length !== exact : choices.length < 2 || choices.length > 3) {
    errors.push(`${w}: 選項需 ${exact ?? "2–3"} 個`);
  }
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
  for (const a of choices) for (const b of choices) if (a !== b && dominates(a, b)) errors.push(`${w}: 「${a.label}」全面優於「${b.label}」，形成明顯正解`);
}

/** 查資料的欄位、字數、張數與有關張數 */
function checkInvestigation(inv: Investigation, w: string, errors: string[]): void {
  const iw = `${w} 查資料`;
  if (!inv.prompt || charLen(inv.prompt) > LIMITS.promptMax) errors.push(`${iw}: prompt 需 1–${LIMITS.promptMax} 字`);
  const items = inv.items ?? [];
  if (items.length < LIMITS.itemsMin || items.length > LIMITS.itemsMax) errors.push(`${iw}: 資料卡需 ${LIMITS.itemsMin}–${LIMITS.itemsMax} 張（目前 ${items.length}）`);
  const relevant = items.filter((it) => it.relevant).length;
  if (relevant < LIMITS.relevantMin || relevant > LIMITS.relevantMax) errors.push(`${iw}: 有關的資料卡需 ${LIMITS.relevantMin}–${LIMITS.relevantMax} 張（目前 ${relevant}）`);
  if (new Set(items.map((it) => it.id)).size !== items.length) errors.push(`${iw}: 資料卡 id 重複`);
  const kind = inv.kind ?? "info";
  if (!INVESTIGATION_KINDS.includes(kind)) errors.push(`${iw}: kind 不合法 (${kind})`);
  if (inv.tip !== undefined && (!inv.tip || charLen(inv.tip) > LIMITS.tipMax)) errors.push(`${iw}: tip 需 1–${LIMITS.tipMax} 字（${charLen(inv.tip ?? "")}）`);
  if (inv.reviewPending !== undefined && typeof inv.reviewPending !== "boolean") errors.push(`${iw}: reviewPending 需為 true 或 false`);
  const labelMax = kind === "review" ? LIMITS.codeLineMax : LIMITS.itemLabelMax;
  for (const it of items) {
    if (!it.id) errors.push(`${iw}: 資料卡缺 id`);
    if (!it.label || charLen(it.label) > labelMax) errors.push(`${iw}: 資料卡「${it.id}」label 需 1–${labelMax} 字（${charLen(it.label ?? "")}）`);
    if (!it.detail || charLen(it.detail) > LIMITS.itemDetailMax) errors.push(`${iw}: 資料卡「${it.id}」detail 需 1–${LIMITS.itemDetailMax} 字（${charLen(it.detail ?? "")}）`);
    if (it.why !== undefined && (!it.why || charLen(it.why) > LIMITS.whyMax)) errors.push(`${iw}: 資料卡「${it.id}」why 需 1–${LIMITS.whyMax} 字（${charLen(it.why ?? "")}）`);
    if (it.tag !== undefined && kind !== "debug") errors.push(`${iw}: 資料卡「${it.id}」只有 debug 才能有 tag`);
    if (it.tag !== undefined && !DEBUG_TAGS.includes(it.tag)) errors.push(`${iw}: 資料卡「${it.id}」tag 不合法 (${it.tag})`);
  }
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

  if (c.entryTag !== undefined && (!c.entryTag || charLen(c.entryTag) > LIMITS.entryTagMax)) errors.push(at(`entryTag 需 1–${LIMITS.entryTagMax} 字`));

  const allText = [
    c.intro,
    ...(c.interrupts ?? []).flatMap((i) => [i.title, i.body, ...(i.choices ?? []).flatMap((ch) => [ch.label, ch.outcome])]),
    ...events.map((e) => e.expire?.outcome ?? ""),
    ...events.flatMap((e) =>
      e.investigate ? [e.investigate.prompt, e.investigate.tip ?? "", ...(e.investigate.items ?? []).flatMap((it) => [it.label, it.detail, it.why ?? ""])] : [],
    ),
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

  const allSetFlags = new Set(events.flatMap((e) => (e.choices ?? []).flatMap((ch) => ch.setFlags ?? [])));
  const badges = c.statusBadges ?? [];
  badges.forEach((b, i) => {
    const w = at(`statusBadges[${i}]`);
    if (!b.label || charLen(b.label) > LIMITS.badgeMax) errors.push(`${w}: label 需 1–${LIMITS.badgeMax} 字`);
    if (!BADGE_TONES.includes(b.tone)) errors.push(`${w}: tone 不合法 (${b.tone})`);
    for (const f of b.flags ?? []) if (!allSetFlags.has(f)) errors.push(`${w}: 旗標 "${f}" 沒有任何選項會設定`);
    if (i < badges.length - 1 && !(b.flags && b.flags.length)) errors.push(`${w}: 無條件的預設規則必須放在最後`);
  });
  if (badges.length > 0 && badges[badges.length - 1].flags?.length) errors.push(at("statusBadges 最後一條必須是無條件的預設規則"));

  const ids = new Set<string>();
  const flagsSetBefore = new Set<string>();
  let prevTime = -1;
  const groupSize = new Map<string, number>();
  const closedGroups = new Set<string>();
  let prevEvent: GameEvent | undefined;
  for (const e of events) {
    const w = at(`事件 ${e.id}`);
    if (e.group) {
      groupSize.set(e.group, (groupSize.get(e.group) ?? 0) + 1);
      if (closedGroups.has(e.group)) errors.push(`${w}: group "${e.group}" 的事件必須相鄰`);
      if (prevEvent?.group === e.group && prevEvent.time !== e.time) errors.push(`${w}: 同一個 group 的 time 必須相同（${prevEvent.time} ≠ ${e.time}）`);
    }
    if (prevEvent?.group && prevEvent.group !== e.group) closedGroups.add(prevEvent.group);
    prevEvent = e;
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
    if (e.requiresAny !== undefined) {
      if (!Array.isArray(e.requiresAny) || e.requiresAny.length < 2) errors.push(`${w}: requiresAny 至少要 2 個旗標（只有 1 個請用 requires）`);
      for (const f of e.requiresAny ?? []) {
        if (!flagsSetBefore.has(f)) errors.push(`${w}: requiresAny 的旗標 "${f}" 沒有被更早的選項設定`);
      }
    }

    if (e.speaker !== undefined && (typeof e.speaker !== "string" || !e.speaker.trim() || charLen(e.speaker) > LIMITS.speakerMax)) {
      errors.push(`${w}: speaker 需 1–${LIMITS.speakerMax} 字（${typeof e.speaker === "string" ? charLen(e.speaker) : "不是文字"}）`);
    }
    if (e.investigate) checkInvestigation(e.investigate, w, errors);
    const choices = e.choices ?? [];
    checkChoices(choices, w, errors);
    for (const ch of choices) for (const f of ch.setFlags ?? []) flagsSetBefore.add(f);
  }
  // 打斷事件
  const interruptIds = new Set<string>();
  for (const i of c.interrupts ?? []) {
    const w = at(`打斷 ${i.id}`);
    if (ids.has(i.id) || interruptIds.has(i.id)) errors.push(`${w}: id 與其他事件或打斷重複`);
    interruptIds.add(i.id);
    if (!events.some((e) => e.id === i.during)) errors.push(`${w}: during "${i.during}" 不是存在的事件`);
    if (i.via !== undefined && i.via !== "call" && i.via !== "visit") errors.push(`${w}: via 需為 call 或 visit`);
    if (!i.caller || charLen(i.caller) > LIMITS.callerMax) errors.push(`${w}: caller 需 1–${LIMITS.callerMax} 字`);
    if (!i.title) errors.push(`${w}: title 必填`);
    if (charLen(i.body ?? "") > LIMITS.bodyMax) errors.push(`${w}: body 超過 ${LIMITS.bodyMax} 字（${charLen(i.body)}）`);
    checkSources(i.sources, w, errors);
    checkChoices(i.choices ?? [], w, errors, 2);
    for (const f of i.requires ?? []) if (!allSetFlags.has(f)) errors.push(`${w}: requires 的旗標 "${f}" 沒有任何選項會設定`);
  }

  // 倒數計時：時限、expire、平衡
  const deadlines = c.deadlines ?? {};
  for (const [g, raw] of Object.entries(deadlines)) {
    const w = at(`deadlines.${g}`);
    const members = events.filter((e) => e.group === g);
    if (members.length === 0) {
      errors.push(`${w}: 沒有任何事件屬於這個 group`);
      continue;
    }
    const isSpec = typeof raw === "object" && raw !== null;
    if (!isSpec && typeof raw !== "number") {
      errors.push(`${w}: 需為分鐘數或 { base, extra }`);
      continue;
    }
    const { base, extra } = deadlineSpec(raw);
    const okMinutes = (m: number) => Number.isInteger(m) && m >= LIMITS.deadlineMin && m <= LIMITS.deadlineMax;
    for (const [id, add] of Object.entries(extra)) {
      const target = members.find((e) => e.id === id);
      if (!target) errors.push(`${w}: extra 的事件 "${id}" 不在這個 group`);
      else if (!isConditional(target)) errors.push(`${w}: extra 的事件 "${id}" 不是條件事件（每局都會出現，請直接加進 base）`);
      if (!Number.isInteger(add) || add <= 0) errors.push(`${w}: extra.${id} 需為正整數分鐘`);
    }
    const cost = (e: GameEvent) => (e.choices ?? []).map(choiceMinutes);
    // 查資料：最少要打開所有有關的卡；最多全部打開
    const inspectMin = (e: GameEvent) => (e.investigate?.items ?? []).filter((it) => it.relevant).length * INSPECT_MINUTES;
    const inspectMax = (e: GameEvent) => (e.investigate?.items ?? []).length * INSPECT_MINUTES;
    // 條件事件可能出現或不出現：每一種組合都要「做得完、有壓力」
    const conditional = members.filter(isConditional);
    if (conditional.length > 6) errors.push(`${w}: 條件事件太多（${conditional.length}），組合數過多`);
    for (let mask = 0; mask < 1 << Math.min(conditional.length, 6); mask++) {
      const present = members.filter((e) => !isConditional(e) || (mask >> conditional.indexOf(e)) & 1);
      if (present.length === 0) continue;
      const minutes = base + present.reduce((a, e) => a + (extra[e.id] ?? 0), 0);
      const combo = conditional.length ? `（條件事件：${conditional.map((e) => `${e.id}${present.includes(e) ? "有" : "無"}`).join("、")}）` : "";
      if (!okMinutes(minutes)) {
        errors.push(`${w}: 需為 ${LIMITS.deadlineMin}–${LIMITS.deadlineMax} 的整數分鐘${combo}`);
        continue;
      }
      const minSum = present.reduce((a, e) => a + Math.min(...cost(e)) + inspectMin(e), 0);
      const maxSum = present.reduce((a, e) => a + Math.max(...cost(e)) + inspectMax(e), 0);
      // 移動只算同一群組內從一個地點走到另一個地點；同地點的事排在一起最省，所以最少要走（地點數 − 1）趟
      const places = new Set(present.map((e) => e.location ?? ""));
      const minTravel = TRAVEL_MINUTES * (places.size - 1);
      const maxTravel = TRAVEL_MINUTES * (present.length - 1);
      if (minSum + minTravel > minutes) errors.push(`${w}: 太緊：最省時的選項加移動共需 ${minSum + minTravel} 分鐘，超過時限 ${minutes}（要有辦法做完）${combo}`);
      // 只剩一件事時不會有事來不及，不檢查壓力
      if (present.length >= 2 && maxSum + maxTravel <= minutes) errors.push(`${w}: 太鬆：最耗時的選項加移動最多 ${maxSum + maxTravel} 分鐘，沒超過時限 ${minutes}（要有壓力）${combo}`);
    }
  }
  for (const e of events) {
    const w = at(`事件 ${e.id}`);
    const timed = !!e.group && e.group in deadlines;
    if (timed && !e.expire) errors.push(`${w}: 所在群組有時限，必須有 expire`);
    if (!timed && e.expire) errors.push(`${w}: 所在群組沒有時限，不該有 expire`);
    if (e.expire) {
      if (!e.expire.outcome || charLen(e.expire.outcome) > LIMITS.outcomeMax) errors.push(`${w}: expire.outcome 需 1–${LIMITS.outcomeMax} 字`);
      for (const [k, v] of Object.entries(e.expire.effects ?? {})) {
        if (!STATS.includes(k as Stat)) errors.push(`${w}: expire 未知資源 ${k}`);
        if (Math.abs(v as number) > LIMITS.effectAbsMax) errors.push(`${w}: expire.effects.${k} 超出 ±${LIMITS.effectAbsMax}`);
      }
      if (!Object.values(e.expire.effects ?? {}).some((v) => (v as number) < 0)) errors.push(`${w}: expire 至少要有一項資源為負`);
    }
  }

  for (const [g, n] of groupSize) if (n < 2) errors.push(at(`group "${g}" 只有 ${n} 個事件，至少要 2 個`));
  return errors;
}
