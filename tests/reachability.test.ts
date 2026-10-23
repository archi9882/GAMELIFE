import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { SURPRISE_TAG, CATEGORIES, type Career } from "../content/schema";
import {
  ackExpired,
  advance,
  choose,
  chooseInterrupt,
  clockMinutes,
  currentBadge,
  currentEvent,
  currentInterrupt,
  inspect,
  investigationDone,
  newGame,
  openEvents,
  remainingMinutes,
  selectEvent,
  submitPrediction,
  type GameState,
} from "../src/engine/game";
import { INSPECT_MINUTES, TRAVEL_MINUTES, choiceMinutes, validateCareer } from "../content/schema";
import { buildProfile, compareAllocation } from "../src/engine/scoring";

/** 打開目前事件的資料卡：only = 只開有關的；all = 全部打開 */
function openCards(career: Career, s: GameState, mode: "relevant" | "all"): GameState {
  const e = currentEvent(career, s)!;
  let next = s;
  for (const it of e.investigate?.items ?? []) if (mode === "all" || it.relevant) next = inspect(career, next, it.id);
  return next;
}

/**
 * 窮舉所有玩法（選哪件事先做、選哪個選項）。
 * 以「流程狀態」去重：已完成的事件、旗標、目前選的事件、有沒有遇過意想不到事件；
 * 資源與特質不影響流程，不納入。回傳到過的事件與選項，以及能不能走到結算。
 */
function explore(career: Career) {
  const seenEvents = new Set<string>();
  const seenChoices = new Set<string>();
  const seenExpired = new Set<string>();
  const seenStates = new Set<string>();
  let finished = 0;
  let pathsWithoutSurprise = 0;
  let maxOpen = 1;
  const key = (s: GameState, surprise: boolean) =>
    [s.phase, [...s.done].sort().join(","), [...s.flags].sort().join(","), s.active ?? "", s.pendingOutcome ? `${s.pendingOutcome.eventId}${s.pendingOutcome.interrupt ? "!" : ""}` : "", s.used, s.inspected.length, s.at ?? "", (s.expired ?? []).join("+"), surprise ? 1 : 0].join("|");

  const stack: [GameState, boolean][] = [[submitPrediction(career, newGame(career), newGame(career).prediction), false]];
  while (stack.length) {
    const [s, sawSurprise] = stack.pop()!;
    const k = key(s, sawSurprise);
    if (seenStates.has(k)) continue;
    seenStates.add(k);
    if (seenStates.size > 400000) throw new Error("狀態數過多，可能有無限迴圈");

    if (s.expired?.length) {
      s.expired.forEach((id) => seenExpired.add(id));
      stack.push([ackExpired(s), sawSurprise]);
      continue;
    }
    if (s.phase !== "play") {
      expect(s.phase).toBe("compare");
      const done = advance(career, s);
      expect(done.phase).toBe("result");
      buildProfile(done);
      compareAllocation(career, done);
      finished++;
      if (!sawSurprise) pathsWithoutSurprise++;
      continue;
    }
    const open = openEvents(career, s);
    maxOpen = Math.max(maxOpen, open.length);
    const e = currentEvent(career, s);
    if (!e) {
      // 同時有多件待辦：每一件都可能先做
      expect(open.length).toBeGreaterThan(1);
      for (const o of open) stack.push([selectEvent(career, s, o.id), sawSurprise]);
      continue;
    }
    if (s.pendingOutcome?.interrupt) {
      stack.push([advance(career, s), sawSurprise]);
      continue;
    }
    const it = currentInterrupt(career, s);
    if (it) {
      it.choices.forEach((_, i) => {
        seenChoices.add(`${it.id}#${i}`);
        stack.push([chooseInterrupt(career, s, i), sawSurprise]);
      });
      continue;
    }
    seenEvents.add(e.id);
    const surprise = sawSurprise || e.tags.includes(SURPRISE_TAG);
    // 有查資料的事件：分「只開有關的」與「全部打開」兩種分支（影響倒數）
    const variants = e.investigate && !investigationDone(career, s, e) ? [openCards(career, s, "relevant"), openCards(career, s, "all")] : [s];
    for (const v of variants) {
      e.choices.forEach((_, i) => {
        seenChoices.add(`${e.id}#${i}`);
        stack.push([advance(career, choose(career, v, i)), surprise]);
      });
    }
  }
  return { seenEvents, seenChoices, seenExpired, finished, pathsWithoutSurprise, maxOpen, states: seenStates.size };
}

describe.each(careers.map((c) => [c.id, c] as const))("%s 全路線可達", (_id, career) => {
  const r = explore(career);

  it("每個事件都至少在一條路線上出現", () => {
    expect([...r.seenEvents].sort()).toEqual(career.events.map((e) => e.id).sort());
  });

  it("每個選項（含打斷事件的選項）都能被選到", () => {
    const total = career.events.reduce((a, e) => a + e.choices.length, 0) + (career.interrupts ?? []).reduce((a, i) => a + i.choices.length, 0);
    expect(r.seenChoices.size).toBe(total);
  });

  it("每個有時限的群組，至少有一件事在某條路線上會來不及（時限有壓力）", () => {
    for (const g of Object.keys(career.deadlines ?? {})) {
      const members = career.events.filter((e) => e.group === g).map((e) => e.id);
      expect(members.some((id) => r.seenExpired.has(id))).toBe(true);
    }
    // 來不及的只可能是有 expire 的事件
    for (const id of r.seenExpired) expect(career.events.find((e) => e.id === id)?.expire).toBeDefined();
  });

  it("所有路線都能走到結算", () => {
    expect(r.finished).toBeGreaterThan(0);
  });

  it(`每條路線至少出現一個「${SURPRISE_TAG}」事件`, () => {
    expect(r.pathsWithoutSurprise).toBe(0);
  });
});

/** 往前推一步：處理「時間到」、結果、打斷、選事件、選選項，依序一個一個來 */
function autoStep(career: Career, s: GameState, choiceFor: (eventId: string) => number = () => 0): GameState {
  if (s.expired?.length) return ackExpired(s);
  if (s.phase === "compare") return advance(career, s);
  if (s.pendingOutcome) return advance(career, s);
  if (currentInterrupt(career, s)) return chooseInterrupt(career, s, 0);
  const t = currentEvent(career, s) ? s : selectEvent(career, s, openEvents(career, s)[0].id);
  return choose(career, openCards(career, t, "relevant"), choiceFor(currentEvent(career, t)!.id));
}

/** 玩完一場：沒選事件時先做第一件；choiceFor 決定每個事件選第幾個選項 */
function playThrough(career: Career, choiceFor: (eventId: string) => number = () => 0) {
  let s = submitPrediction(career, newGame(career), newGame(career).prediction);
  const order: string[] = [];
  for (let guard = 0; s.phase === "play" || s.expired?.length; guard++) {
    if (guard > 500) throw new Error("玩不完");
    const e = !s.pendingOutcome && !s.expired?.length ? currentEvent(career, s) : null;
    if (e && !currentInterrupt(career, s)) order.push(e.id);
    s = autoStep(career, s, choiceFor);
  }
  return { s, order };
}

describe("引擎行為", () => {
  const career = careers[0];

  it("預測會正規化為加總 100", () => {
    const s = submitPrediction(career, newGame(career), { core: 3, communicate: 1, admin: 1, wait: 0, learn: 1 });
    expect(CATEGORIES.reduce((a, c) => a + s.prediction[c], 0)).toBe(100);
  });

  it("資源被限制在 0–100", () => {
    const { s } = playThrough(career);
    for (const v of Object.values(s.stats)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("沒選前置旗標時，分支事件不會出現", () => {
    // 老師：家長來電選第 3 項（不約面談）→ 不應出現 t-parent-meeting
    // （t-form、t-lunch-talk 選省時的選項，才不會因為時間用光而讓後面的事來不及）
    const pick = (call: number) => (id: string) => (id === "t-parent-call" ? call : id === "t-form" || id === "t-lunch-talk" ? 1 : 0);
    expect(playThrough(career, pick(2)).order).not.toContain("t-parent-meeting");
    expect(playThrough(career, pick(1)).order).toContain("t-parent-meeting");
  });
});

describe("同時多個待辦（group）", () => {
  const teacher = careers.find((c) => c.id === "teacher")!;
  const toGroup = (): GameState => {
    let s = submitPrediction(teacher, newGame(teacher), newGame(teacher).prediction);
    for (let guard = 0; guard < 50; guard++) {
      if (!s.pendingOutcome && openEvents(teacher, s).some((e) => e.group === "office-morning")) return s;
      s = autoStep(teacher, s);
    }
    throw new Error("沒有走到群組");
  };
  const doEvent = (s: GameState, id: string, choice = 0) => advance(teacher, choose(teacher, openCards(teacher, selectEvent(teacher, s, id), "relevant"), choice));

  it("群組開始時，同組事件同時開放，且不會自動選一件", () => {
    const s = toGroup();
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-form", "t-prep", "t-parent-call"]);
    expect(currentEvent(teacher, s)).toBeNull();
  });

  it("做完一件後，其餘仍開放；做過的不會再出現", () => {
    const s = doEvent(toGroup(), "t-prep");
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-form", "t-parent-call"]);
    expect(s.done).toContain("t-prep");
  });

  it("只剩一件時自動成為目前事件，不需要再選", () => {
    let s = toGroup();
    for (const id of ["t-form", "t-parent-call"]) s = doEvent(s, id, id === "t-form" ? 1 : 2); // 選最省時的
    expect(currentEvent(teacher, s)?.id).toBe("t-prep");
  });

  it("群組全做完才進入下一個群組，已花時間歸零", () => {
    let s = toGroup();
    for (const id of ["t-form", "t-prep", "t-parent-call"]) s = doEvent(s, id, id === "t-prep" ? 0 : id === "t-form" ? 1 : 2);
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-lunch-talk"]);
    expect(s.used).toBe(0);
  });

  it("不能選已做過或現在不能做的事件，也不能在看結果時換事件", () => {
    const s = toGroup();
    expect(() => selectEvent(teacher, s, "t-class")).toThrow();
    const picked = choose(teacher, selectEvent(teacher, s, "t-form"), 0);
    expect(() => selectEvent(teacher, picked, "t-prep")).toThrow();
  });

  it("同組事件的前置旗標會隨處理順序動態開放", () => {
    // 午休群組：t-parent-meeting 需要 parent_meeting；先前選約面談才會出現
    let s: GameState = { ...toGroup(), flags: ["parent_meeting"] };
    for (const id of ["t-form", "t-prep", "t-parent-call"]) s = doEvent(s, id, id === "t-prep" ? 0 : id === "t-form" ? 1 : 2);
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-lunch-talk", "t-parent-meeting"]);
  });
});

describe("打斷事件", () => {
  const teacher = careers.find((c) => c.id === "teacher")!;
  /** 走到 t-class 到了畫面上（還沒選） */
  const atClass = (): GameState => {
    let s = submitPrediction(teacher, newGame(teacher), newGame(teacher).prediction);
    s = autoStep(teacher, s); // t-morning
    s = autoStep(teacher, s); // 結果
    expect(currentEvent(teacher, s)?.id).toBe("t-class");
    return s;
  };

  it("事件到了畫面上時，先出現打斷；回應前不能選事件的選項", () => {
    const s = atClass();
    expect(currentInterrupt(teacher, s)?.id).toBe("i-t-attendance");
    expect(() => choose(teacher, s, 0)).toThrow(/打斷/);
  });

  it("回應打斷會套用代價、顯示結果，看完回到原本的事件，且不會再出現", () => {
    let s = atClass();
    const before = s.stats;
    s = chooseInterrupt(teacher, s, 0); // 接電話：time -10、trust +5、energy -5
    expect(s.stats.time).toBe(before.time - 10);
    expect(s.stats.trust).toBe(before.trust + 5);
    expect(currentInterrupt(teacher, s)?.id).toBe("i-t-attendance"); // 正在顯示結果
    s = advance(teacher, s);
    expect(currentInterrupt(teacher, s)).toBeNull();
    expect(currentEvent(teacher, s)?.id).toBe("t-class");
    expect(s.done).toContain("i-t-attendance");
  });

  it("兩個選項會導向不同的資源結果（沒有明顯正解）", () => {
    const a = chooseInterrupt(teacher, atClass(), 0).stats;
    const b = chooseInterrupt(teacher, atClass(), 1).stats;
    expect(a).not.toEqual(b);
    expect(a.trust).toBeGreaterThan(b.trust);
    expect(a.time).toBeLessThan(b.time);
  });
});

describe("倒數計時", () => {
  const teacher = careers.find((c) => c.id === "teacher")!;
  const toGroup = (): GameState => {
    let s = submitPrediction(teacher, newGame(teacher), newGame(teacher).prediction);
    for (let guard = 0; guard < 50; guard++) {
      if (!s.pendingOutcome && openEvents(teacher, s).some((e) => e.group === "office-morning")) return s;
      s = autoStep(teacher, s);
    }
    throw new Error("沒有走到群組");
  };
  const doEvent = (s: GameState, id: string, choice: number) => advance(teacher, choose(teacher, openCards(teacher, selectEvent(teacher, s, id), "relevant"), choice));

  it("沒有時限的事件不累計時間", () => {
    const s = submitPrediction(teacher, newGame(teacher), newGame(teacher).prediction);
    expect(remainingMinutes(teacher, s)).toBeNull();
    expect(s.used).toBe(0);
  });

  it("有時限的群組：時間 = 選項的分鐘數；同群組內換地點才加移動時間", () => {
    const s0 = toGroup();
    expect(remainingMinutes(teacher, s0)).toBe(60);
    expect(clockMinutes(teacher, s0)).toBe(9 * 60 + 20);
    const form = teacher.events.find((e) => e.id === "t-form")!;
    const s1 = choose(teacher, selectEvent(teacher, s0, "t-form"), 1); // time -5 → 15 分鐘；群組第一件，不算移動
    expect(s1.used).toBe(choiceMinutes(form.choices[1]));
    expect(remainingMinutes(teacher, advance(teacher, s1))).toBe(60 - s1.used);
  });

  it("移動時間：午休群組先在辦公室、再到輔導室，才加 5 分鐘", () => {
    let s = toGroup();
    for (const id of ["t-form", "t-prep", "t-parent-call"]) s = doEvent(s, id, id === "t-prep" ? 0 : id === "t-form" ? 1 : 2);
    s = { ...s, flags: [...s.flags, "parent_meeting"] }; // 確保午休群組有兩件
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-lunch-talk", "t-parent-meeting"]);
    const lunch = teacher.events.find((e) => e.id === "t-lunch-talk")!;
    const meeting = teacher.events.find((e) => e.id === "t-parent-meeting")!;
    const afterLunch = choose(teacher, selectEvent(teacher, s, "t-lunch-talk"), 1);
    expect(afterLunch.used).toBe(choiceMinutes(lunch.choices[1]));
    const afterMeeting = choose(teacher, selectEvent(teacher, advance(teacher, afterLunch), "t-parent-meeting"), 1);
    expect(afterMeeting.used).toBe(choiceMinutes(lunch.choices[1]) + TRAVEL_MINUTES + choiceMinutes(meeting.choices[1]));
  });

  it("時間到：其餘還開著的事件全部來不及，依 expire 結算並進入下一段", () => {
    let s = toGroup();
    s = doEvent(s, "t-form", 0); // 30 分鐘
    s = doEvent(s, "t-parent-call", 1); // 25 分鐘 + 查資料 15 分鐘 → 30 + 40 = 70 ≥ 60，時間用盡
    expect(s.expired).toEqual(["t-prep"]);
    expect(s.done).toContain("t-prep");
    expect(s.log[s.log.length - 1]).toEqual({ eventId: "t-prep", choiceIndex: -1 });
    // 已進入下一個群組（t-parent-call 的第 2 個選項會約面談，所以午休群組有兩件）
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-lunch-talk", "t-parent-meeting"]);
    expect(s.used).toBe(0);
    expect(ackExpired(s).expired).toBeNull();
  });

  it("來不及的後果會扣資源", () => {
    let s = toGroup();
    s = doEvent(s, "t-form", 0);
    const before = s.stats;
    s = doEvent(s, "t-parent-call", 1);
    // t-parent-call 本身的效果 + t-prep 的 expire（trust -5、energy -5）
    expect(s.stats.energy).toBeLessThan(before.energy);
    expect(s.stats.trust).toBeLessThanOrEqual(before.trust + 10 - 5);
  });

  it("用最省時的選項可以全部做完，不會有任何事來不及", () => {
    let s = toGroup();
    s = doEvent(s, "t-form", 1); // 15
    s = doEvent(s, "t-parent-call", 2); // 10 + 查資料 15 = 25
    s = doEvent(s, "t-prep", 0); // 20（共 60 ≤ 60）
    expect(s.expired).toBeNull();
  });
});

describe("狀態徽章", () => {
  it("每個職業在任何旗標組合下都有徽章（有無條件預設）", () => {
    for (const c of careers) expect(currentBadge(c, [])).not.toBeNull();
  });

  it("依序比對，先符合者優先", () => {
    const plumber = careers.find((c) => c.id === "plumber")!;
    expect(currentBadge(plumber, [])?.label).toBe("漏水待查");
    expect(currentBadge(plumber, ["found_leak"])?.label).toBe("已找到漏點");
    expect(currentBadge(plumber, ["found_leak", "tested"])?.tone).toBe("ok");
  });

  it("水電工 p-test 的兩個選項會設定不同結果旗標", () => {
    const plumber = careers.find((c) => c.id === "plumber")!;
    const e = plumber.events.find((x) => x.id === "p-test")!;
    expect(e.choices.map((ch) => ch.setFlags?.[0])).toEqual(["tested", "rushed"]);
  });
});

describe("查資料", () => {
  const teacher = careers.find((c) => c.id === "teacher")!;
  const swe = careers.find((c) => c.id === "swe")!;
  /** 走到指定事件到了畫面上（還沒查資料、也沒選） */
  const toEvent = (career: Career, id: string): GameState => {
    let s = submitPrediction(career, newGame(career), newGame(career).prediction);
    for (let guard = 0; guard < 80; guard++) {
      if (!s.pendingOutcome && !s.expired?.length) {
        if (openEvents(career, s).some((e) => e.id === id)) {
          s = currentEvent(career, s) ? s : selectEvent(career, s, id);
          if (currentEvent(career, s)?.id === id) return currentInterrupt(career, s) ? advance(career, chooseInterrupt(career, s, 0)) : s;
        }
      }
      s = autoStep(career, s);
    }
    throw new Error("沒有走到事件");
  };
  const callEvent = teacher.events.find((e) => e.id === "t-parent-call")!;
  const relevantIds = callEvent.investigate!.items.filter((it) => it.relevant).map((it) => it.id);
  const irrelevantId = callEvent.investigate!.items.find((it) => !it.relevant)!.id;

  it("有時限的群組：每打開一張卡扣 5 分鐘；沒有時限則不扣", () => {
    const s = toEvent(teacher, "t-parent-call");
    expect(inspect(teacher, s, relevantIds[0]).used).toBe(s.used + INSPECT_MINUTES);
    const free = toEvent(swe, "s-alert");
    expect(remainingMinutes(swe, free)).toBeNull();
    const cardId = swe.events.find((e) => e.id === "s-alert")!.investigate!.items[0].id;
    expect(inspect(swe, free, cardId).used).toBe(free.used);
    expect(inspect(swe, free, cardId).inspected).toEqual([`s-alert:${cardId}`]);
  });

  it("同一張卡不能打開兩次，也不能打開不存在的卡", () => {
    const s = inspect(teacher, toEvent(teacher, "t-parent-call"), relevantIds[0]);
    expect(() => inspect(teacher, s, relevantIds[0])).toThrow();
    expect(() => inspect(teacher, s, "nope")).toThrow();
  });

  it("查完資料前不能選；有關的卡都打開後即完成，無關的不必打開", () => {
    let s = toEvent(teacher, "t-parent-call");
    expect(investigationDone(teacher, s, callEvent)).toBe(false);
    expect(() => choose(teacher, s, 0)).toThrow(/查完資料/);
    for (const id of relevantIds.slice(0, -1)) s = inspect(teacher, s, id);
    expect(investigationDone(teacher, s, callEvent)).toBe(false);
    s = inspect(teacher, s, relevantIds[relevantIds.length - 1]);
    expect(investigationDone(teacher, s, callEvent)).toBe(true);
    expect(s.inspected).not.toContain(`t-parent-call:${irrelevantId}`);
    expect(() => choose(teacher, s, 0)).not.toThrow();
  });

  it("全部打開比只開有關的多花時間", () => {
    const s = toEvent(teacher, "t-parent-call");
    const all = openCards(teacher, s, "all");
    const rel = openCards(teacher, s, "relevant");
    expect(all.used - rel.used).toBe((callEvent.investigate!.items.length - relevantIds.length) * INSPECT_MINUTES);
  });

  it("沒有查資料的事件視為已完成", () => {
    const e = teacher.events.find((x) => x.id === "t-form")!;
    expect(investigationDone(teacher, newGame(teacher), e)).toBe(true);
  });

  it("專業小遊戲沿用同一套規則：review 在有時限的群組扣 5 分鐘，除錯不在群組不扣", () => {
    const review = toEvent(swe, "s-review");
    expect(remainingMinutes(swe, review)).not.toBeNull();
    expect(inspect(swe, review, "l3").used).toBe(review.used + INSPECT_MINUTES);
    const debug = toEvent(swe, "s-deepwork");
    expect(remainingMinutes(swe, debug)).toBeNull();
    expect(inspect(swe, debug, "msg").used).toBe(debug.used);
  });

  it("驗證器把最少查資料時間算進「做得完」", () => {
    const bad = structuredClone(teacher) as Career;
    bad.deadlines!["office-morning"] = 50; // 最省 45 分 + 查資料 15 分 = 60 > 50
    expect(validateCareer(bad).some((e) => e.includes("太緊"))).toBe(true);
  });
});

describe("軟體工程師 ticket 主線", () => {
  const swe = careers.find((c) => c.id === "swe")!;
  /** 依 picks（事件 id → 選項）玩到傍晚群組開始，回傳狀態與走過的事件 */
  const toEvening = (picks: Record<string, number>) => {
    let s = submitPrediction(swe, newGame(swe), newGame(swe).prediction);
    const order: string[] = [];
    for (let guard = 0; guard < 300; guard++) {
      if (!s.pendingOutcome && !s.expired?.length && swe.events[s.cursor]?.group === "evening") return { s, order };
      const e = !s.pendingOutcome && !s.expired?.length ? currentEvent(swe, s) : null;
      if (e && !currentInterrupt(swe, s)) order.push(e.id);
      s = autoStep(swe, s, (id) => picks[id] ?? (swe.events.find((x) => x.id === id)!.choices.length - 1));
    }
    throw new Error("沒有走到傍晚");
  };
  const careful = { "s-standup": 0, "s-unittest": 0 };

  it("寫單元測試每局都會出現，並帶著單元測試小遊戲", () => {
    const e = swe.events.find((x) => x.id === "s-unittest")!;
    expect(e.requires ?? e.requiresAny).toBeUndefined();
    expect(e.investigate?.kind).toBe("test");
    expect(toEvening(careful).order).toContain("s-unittest");
  });

  it("主管退回：開發先求能動或只測正常情況，任一個就會出現；兩個都沒選就不出現", () => {
    expect(toEvening(careful).order).not.toContain("s-returned");
    expect(toEvening({ "s-standup": 1, "s-unittest": 0 }).order).toContain("s-returned");
    expect(toEvening({ "s-standup": 0, "s-unittest": 1 }).order).toContain("s-returned");
    expect(toEvening({ "s-standup": 1, "s-unittest": 1 }).order).toContain("s-returned");
  });

  it("傍晚時限 = 基本值 + 測試環境出錯有出現時的加時", () => {
    const spec = swe.deadlines!.evening as { base: number; extra: Record<string, number> };
    const noBug = toEvening({ ...careful, "s-review": 0 }).s;
    expect(noBug.flags).not.toContain("rubber_stamp");
    expect(openEvents(swe, noBug).map((e) => e.id)).not.toContain("s-bug-found");
    expect(remainingMinutes(swe, noBug)).toBe(spec.base);
    const bug = toEvening({ ...careful, "s-review": 2 }).s;
    expect(openEvents(swe, bug).map((e) => e.id)).toContain("s-bug-found");
    expect(remainingMinutes(swe, bug)).toBe(spec.base + spec.extra["s-bug-found"]);
  });

  it("條件時限用最省時的選項可以全部做完（有無測試環境出錯皆然）", () => {
    for (const review of [0, 2]) {
      let s = toEvening({ ...careful, "s-review": review }).s;
      const cheapest = (id: string) => {
        const ch = swe.events.find((e) => e.id === id)!.choices.map(choiceMinutes);
        return ch.indexOf(Math.min(...ch));
      };
      // 同地點的先做完，再走去新人座位
      const order = openEvents(swe, s).map((e) => e.id).sort((a, b) => (a === "s-mentor" ? 1 : b === "s-mentor" ? -1 : 0));
      for (const id of order) s = advance(swe, choose(swe, selectEvent(swe, s, id), cheapest(id)));
      expect(s.expired).toBeNull();
    }
  });
});
