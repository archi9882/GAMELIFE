import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { SURPRISE_TAG, CATEGORIES, type Career } from "../content/schema";
import { advance, choose, currentBadge, currentEvent, newGame, submitPrediction, type GameState } from "../src/engine/game";
import { buildProfile, compareAllocation } from "../src/engine/scoring";

/** 窮舉所有選擇路線（以 狀態 cursor+flags 去重），回傳每條走到結算的路線 */
function explore(career: Career) {
  const seenEvents = new Set<string>();
  const seenChoices = new Set<string>();
  let finished = 0;
  let pathsWithoutSurprise = 0;
  const visit = (s: GameState, sawSurprise: boolean, depth: number) => {
    if (depth > 50) throw new Error("路線過長，可能有無限迴圈");
    if (s.phase !== "play") {
      expect(s.phase).toBe("compare");
      const done = advance(career, s);
      expect(done.phase).toBe("result");
      buildProfile(done);
      compareAllocation(career, done);
      finished++;
      if (!sawSurprise) pathsWithoutSurprise++;
      return;
    }
    const e = currentEvent(career, s);
    if (!e) throw new Error("play 階段卻沒有事件");
    seenEvents.add(e.id);
    const surprise = sawSurprise || e.tags.includes(SURPRISE_TAG);
    e.choices.forEach((_, i) => {
      seenChoices.add(`${e.id}#${i}`);
      visit(advance(career, choose(career, s, i)), surprise, depth + 1);
    });
  };
  visit(submitPrediction(career, newGame(career), newGame(career).prediction), false, 0);
  return { seenEvents, seenChoices, finished, pathsWithoutSurprise };
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

describe("引擎行為", () => {
  const career = careers[0];

  it("預測會正規化為加總 100", () => {
    const s = submitPrediction(career, newGame(career), { core: 3, communicate: 1, admin: 1, wait: 0, learn: 1 });
    expect(CATEGORIES.reduce((a, c) => a + s.prediction[c], 0)).toBe(100);
  });

  it("資源被限制在 0–100", () => {
    let s = submitPrediction(career, newGame(career), newGame(career).prediction);
    while (s.phase === "play") s = advance(career, choose(career, s, 0));
    for (const v of Object.values(s.stats)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("沒選前置旗標時，分支事件不會出現", () => {
    // 老師：家長來電選第 3 項（不約面談）→ 不應出現 t-parent-meeting
    let s = submitPrediction(career, newGame(career), newGame(career).prediction);
    const ids: string[] = [];
    while (s.phase === "play") {
      const e = currentEvent(career, s)!;
      ids.push(e.id);
      s = advance(career, choose(career, s, e.id === "t-parent-call" ? 2 : 0));
    }
    expect(ids).not.toContain("t-parent-meeting");
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
