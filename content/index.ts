import type { Career } from "./schema";
import swe from "./careers/swe.json";

/**
 * 職業登錄表。v0.14 起只有軟體工程師（高中老師 v0.13、水電工 v0.14 依使用者決定刪除）；
 * 保留陣列形式，之後新增職業時不用改呼叫端。
 */
export const careers: Career[] = [swe] as Career[];
export const getCareer = (id: string): Career | undefined => careers.find((c) => c.id === id);
