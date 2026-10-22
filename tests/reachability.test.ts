import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { SURPRISE_TAG, CATEGORIES, type Career } from "../content/schema";
import { advance, choose, currentBadge, currentEvent, newGame, openEvents, selectEvent, submitPrediction, type GameState } from "../src/engine/game";
import { buildProfile, compareAllocation } from "../src/engine/scoring";

/**
 * 窮舉所有玩法（選哪件事先做、選哪個選項）。
 * 以「流程狀態」去重：已完成的事件、旗標、目前選的事件、有沒有遇過意想不到事件；
 * 資源與特質不影響流程，不納入。回傳到過的事件與選項，以及能不能走到結算。
 */
function explore(career: Career) {
  const seenEvents = new Set<string>();
  const seenChoices = new Set<string>();
  const seenStates = new Set<string>();
  let finished = 0;
  let pathsWithoutSurprise = 0;
  let maxOpen = 1;
  const key = (s: GameState, surprise: boolean) =>
    [s.phase, [...s.done].sort().join(","), [...s.flags].sort().join(","), s.active ?? "", s.pendingOutcome?.eventId ?? "", surprise ? 1 : 0].join("|");

  const stack: [GameState, boolean][] = [[submitPrediction(career, newGame(career), newGame(career).prediction), false]];
  while (stack.length) {
    const [s, sawSurprise] = stack.pop()!;
    const k = key(s, sawSurprise);
    if (seenStates.has(k)) continue;
    seenStates.add(k);
    if (seenStates.size > 200000) throw new Error("狀態數過多，可能有無限迴圈");

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
    seenEvents.add(e.id);
    const surprise = sawSurprise || e.tags.includes(SURPRISE_TAG);
    e.choices.forEach((_, i) => {
      seenChoices.add(`${e.id}#${i}`);
      stack.push([advance(career, choose(career, s, i)), surprise]);
    });
  }
  return { seenEvents, seenChoices, finished, pathsWithoutSurprise, maxOpen, states: seenStates.size };
}

describe.each(careers.map((c) => [c.id, c] as const))("%s 全路線可達", (_id, career) => {
  const r = explore(career);

  it("每個事件都至少在一條路線上出現", () => {
    expect([...r.seenEvents].sort()).toEqual(career.events.map((e) => e.id).sort());
  });

  it("每個選項都能被選到", () => {
    const total = career.events.reduce((a, e) => a + e.choices.length, 0);
    expect(r.seenChoices.size).toBe(total);
  });

  it("所有路線都能走到結算", () => {
    expect(r.finished).toBeGreaterThan(0);
  });

  it(`每條路線至少出現一個「${SURPRISE_TAG}」事件`, () => {
    expect(r.pathsWithoutSurprise).toBe(0);
  });
});

/** 玩完一場：沒選事件時先做第一件；choiceFor 決定每個事件選第幾個選項 */
function playThrough(career: Career, choiceFor: (eventId: string) => number = () => 0) {
  let s = submitPrediction(career, newGame(career), newGame(career).prediction);
  const order: string[] = [];
  while (s.phase === "play") {
    if (!currentEvent(career, s)) s = selectEvent(career, s, openEvents(career, s)[0].id);
    const e = currentEvent(career, s)!;
    order.push(e.id);
    s = advance(career, choose(career, s, choiceFor(e.id)));
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
    const { order } = playThrough(career, (id) => (id === "t-parent-call" ? 2 : 0));
    expect(order).not.toContain("t-parent-meeting");
    expect(playThrough(career, (id) => (id === "t-parent-call" ? 1 : 0)).order).toContain("t-parent-meeting");
  });
});

describe("同時多個待辦（group）", () => {
  const teacher = careers.find((c) => c.id === "teacher")!;
  const toGroup = () => {
    let s = submitPrediction(teacher, newGame(teacher), newGame(teacher).prediction);
    while (!openEvents(teacher, s).some((e) => e.group === "office-morning")) {
      s = advance(teacher, choose(teacher, s, 0));
    }
    return s;
  };

  it("群組開始時，同組事件同時開放，且不會自動選一件", () => {
    const s = toGroup();
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-form", "t-prep", "t-parent-call"]);
    expect(currentEvent(teacher, s)).toBeNull();
  });

  it("做完一件後，其餘仍開放；做過的不會再出現", () => {
    let s = toGroup();
    s = advance(teacher, choose(teacher, selectEvent(teacher, s, "t-prep"), 0));
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-form", "t-parent-call"]);
    expect(s.done).toContain("t-prep");
  });

  it("只剩一件時自動成為目前事件，不需要再選", () => {
    let s = toGroup();
    for (const id of ["t-form", "t-parent-call"]) s = advance(teacher, choose(teacher, selectEvent(teacher, s, id), 0));
    expect(currentEvent(teacher, s)?.id).toBe("t-prep");
  });

  it("群組全做完才進入下一個群組", () => {
    let s = toGroup();
    for (const id of ["t-form", "t-prep", "t-parent-call"]) s = advance(teacher, choose(teacher, selectEvent(teacher, s, id), 0));
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-lunch-talk"]);
  });

  it("不能選已做過或現在不能做的事件，也不能在看結果時換事件", () => {
    const s = toGroup();
    expect(() => selectEvent(teacher, s, "t-class")).toThrow();
    const picked = choose(teacher, selectEvent(teacher, s, "t-form"), 0);
    expect(() => selectEvent(teacher, picked, "t-prep")).toThrow();
  });

  it("同組事件的前置旗標會隨處理順序動態開放", () => {
    // 午休群組：t-parent-meeting 需要 parent_meeting；先前選約面談才會出現
    const withFlag = { ...toGroup(), flags: ["parent_meeting"] };
    let s = withFlag;
    for (const id of ["t-form", "t-prep", "t-parent-call"]) s = advance(teacher, choose(teacher, selectEvent(teacher, s, id), 0));
    expect(openEvents(teacher, s).map((e) => e.id)).toEqual(["t-lunch-talk", "t-parent-meeting"]);
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
