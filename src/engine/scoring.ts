// 對照與結算：只描述「節奏偏好與價值取向」，不輸出「你適合 X」。
import { CATEGORIES, STATS, type Career, type Category, type Stat } from "../../content/schema";
import { INITIAL_STATS, type GameState } from "./game";

export interface GapRow {
  category: Category;
  predicted: number;
  actual: number;
  gap: number; // actual - predicted
}

export function compareAllocation(career: Career, s: GameState): { rows: GapRow[]; biggest: GapRow } {
  const rows = CATEGORIES.map((c) => ({
    category: c,
    predicted: s.prediction[c],
    actual: career.actualAllocation[c],
    gap: career.actualAllocation[c] - s.prediction[c],
  }));
  const biggest = rows.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a));
  return { rows, biggest };
}

/** 只要有一個 fiction 來源，就在對照畫面標示「此比例為推估」 */
export const allocationIsEstimate = (career: Career): boolean =>
  career.allocationSources.some((src) => src.type === "fiction");

export interface Profile {
  pace: { score: number; label: string };
  social: { score: number; label: string };
  achieve: { key: "people" | "solve" | "make"; label: string; scores: Record<"people" | "solve" | "make", number> };
  pressure: { stat: Stat; label: string; drop: number };
}

const ACHIEVE_LABELS = { people: "看到人的改變", solve: "解決問題", make: "做出實體成果" } as const;
const PRESSURE_LABELS: Record<Stat, string> = { time: "時間壓力", trust: "人際壓力", energy: "體力與安全壓力" };

function axisLabel(score: number, neg: string, pos: string): string {
  if (score >= 2) return `偏向${pos}`;
  if (score <= -2) return `偏向${neg}`;
  return `${neg}與${pos}之間`;
}

export function buildProfile(s: GameState): Profile {
  const scores = {
    people: s.traits.achieve_people,
    solve: s.traits.achieve_solve,
    make: s.traits.achieve_make,
  };
  // 平手時依固定順序，確保結果可重現
  const key = (Object.keys(scores) as (keyof typeof scores)[]).reduce((a, b) => (scores[b] > scores[a] ? b : a));
  const stat = STATS.reduce((a, b) =>
    INITIAL_STATS[b] - s.stats[b] > INITIAL_STATS[a] - s.stats[a] ? b : a,
  );
  return {
    pace: { score: s.traits.pace, label: axisLabel(s.traits.pace, "穩定規律", "突發應變") },
    social: { score: s.traits.social, label: axisLabel(s.traits.social, "獨立專注", "與人協作") },
    achieve: { key, label: ACHIEVE_LABELS[key], scores },
    pressure: { stat, label: PRESSURE_LABELS[stat], drop: INITIAL_STATS[stat] - s.stats[stat] },
  };
}
