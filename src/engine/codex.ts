// 圖鑑：記錄玩家在遊戲中「看過」的名詞，跨局保存。純函式，方便測試。
import type { Career } from "../../content/schema";

/** 職業 id → 已收集的名詞 */
export type Codex = Record<string, string[]>;

/** 加入新看到的名詞（不重複、只收該職業詞庫裡有的）；沒有變化時回傳原物件 */
export function mergeSeen(codex: Codex, career: Career, terms: readonly string[]): Codex {
  const valid = new Set((career.glossary ?? []).map((g) => g.term));
  const have = new Set(codex[career.id] ?? []);
  const fresh = [...new Set(terms)].filter((t) => valid.has(t) && !have.has(t));
  if (fresh.length === 0) return codex;
  return { ...codex, [career.id]: [...(codex[career.id] ?? []), ...fresh] };
}

export interface CodexProgress {
  collected: number;
  total: number;
}

export function progress(codex: Codex, careers: readonly Career[]): { all: CodexProgress; byCareer: Record<string, CodexProgress> } {
  const byCareer: Record<string, CodexProgress> = {};
  let collected = 0;
  let total = 0;
  for (const c of careers) {
    const valid = new Set((c.glossary ?? []).map((g) => g.term));
    const got = (codex[c.id] ?? []).filter((t) => valid.has(t)).length;
    byCareer[c.id] = { collected: got, total: valid.size };
    collected += got;
    total += valid.size;
  }
  return { all: { collected, total }, byCareer };
}
