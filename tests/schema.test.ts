import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { validateCareer, type Career } from "../content/schema";
import { hasScene, sceneLocations } from "../src/scene";

describe("劇本格式驗證", () => {
  it.each(careers.map((c) => [c.id, c] as const))("%s 通過 schema 驗證", (_id, career) => {
    expect(validateCareer(career)).toEqual([]);
  });

  it("包含第一版三個職業", () => {
    expect(careers.map((c) => c.id).sort()).toEqual(["plumber", "swe", "teacher"]);
  });

  it("能抓到明顯正解與無代價選項", () => {
    const bad = structuredClone(careers[0]) as Career;
    bad.events[0].choices = [
      { label: "好", effects: { energy: 5 }, traits: {}, outcome: "好" },
      { label: "壞", effects: { energy: -5 }, traits: {}, outcome: "壞" },
    ];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("明顯正解"))).toBe(true);
    expect(errors.some((e) => e.includes("代價"))).toBe(true);
  });

  it("能抓到比例加總錯誤與未定義的前置旗標", () => {
    const bad = structuredClone(careers[0]) as Career;
    bad.actualAllocation.core += 1;
    bad.events[0].requires = ["nope"];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("加總"))).toBe(true);
    expect(errors.some((e) => e.includes("nope"))).toBe(true);
  });

  it("名詞必須出現在文字中、解釋不可為空或過長", () => {
    const bad = structuredClone(careers[2]) as Career;
    bad.glossary = [
      { term: "不存在的詞", meaning: "x" },
      { term: "報價", meaning: "" },
      { term: "學徒", meaning: "字".repeat(81) },
    ];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("不存在的詞") && e.includes("沒有出現"))).toBe(true);
    expect(errors.some((e) => e.includes("報價") && e.includes("meaning"))).toBe(true);
    expect(errors.some((e) => e.includes("學徒") && e.includes("meaning"))).toBe(true);
  });

  it("有 locations 的職業，每個事件都要有合法 location", () => {
    const plumber = careers.find((c) => c.id === "plumber")!;
    expect(plumber.locations?.length).toBeGreaterThan(0);
    const bad = structuredClone(plumber) as Career;
    bad.events[0].location = "mars";
    delete bad.events[1].location;
    const errors = validateCareer(bad);
    expect(errors.filter((e) => e.includes("location")).length).toBe(2);
  });

  it("三個職業都有名詞折疊", () => {
    for (const c of careers) expect(c.glossary?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("狀態徽章：旗標必須存在、預設規則放最後", () => {
    const bad = structuredClone(careers[2]) as Career;
    bad.statusBadges = [
      { label: "預設", tone: "ok" },
      { label: "鬼旗標", tone: "alert", flags: ["no_such_flag"] },
      { label: "這個標籤實在是太長了超過上限", tone: "info", flags: ["found_leak"] },
    ];
    const errors = validateCareer(bad);
    expect(errors.some((e) => e.includes("no_such_flag"))).toBe(true);
    expect(errors.some((e) => e.includes("預設規則必須放在最後"))).toBe(true);
    expect(errors.some((e) => e.includes("label"))).toBe(true);
    expect(errors.some((e) => e.includes("最後一條必須是無條件"))).toBe(true);
  });

  it("有 3D 場景的職業：劇本地點與場景地點完全一致", () => {
    for (const c of careers) {
      if (!hasScene(c.id)) continue;
      const scene = [...sceneLocations[c.id]].sort();
      expect((c.locations ?? []).map((l) => l.id).sort()).toEqual(scene);
      for (const e of c.events) expect(scene).toContain(e.location);
    }
  });

  it("三個職業都有 3D 場景", () => {
    expect(careers.filter((c) => hasScene(c.id)).length).toBe(3);
  });

  it("入口標籤：水電工標示待優化，過長或空白會被擋下", () => {
    expect(careers.find((c) => c.id === "plumber")!.entryTag).toBe("待優化");
    const bad = structuredClone(careers[0]) as Career;
    bad.entryTag = "這個標籤太長了吧";
    expect(validateCareer(bad).some((e) => e.includes("entryTag"))).toBe(true);
    bad.entryTag = "";
    expect(validateCareer(bad).some((e) => e.includes("entryTag"))).toBe(true);
  });

  it("群組：必須相鄰、時間相同、至少 2 個事件", () => {
    const base = careers.find((c) => c.id === "teacher")!;
    const apart = structuredClone(base) as Career;
    apart.events[0].group = "x"; // t-morning
    apart.events[3].group = "x"; // t-prep：中間隔了別的事件
    expect(validateCareer(apart).some((e) => e.includes("必須相鄰"))).toBe(true);

    const diffTime = structuredClone(base) as Career;
    diffTime.events[3].time = "09:30"; // t-prep 與同組的 t-form 時間不同
    expect(validateCareer(diffTime).some((e) => e.includes("time 必須相同"))).toBe(true);

    const lonely = structuredClone(base) as Career;
    lonely.events[0].group = "solo";
    expect(validateCareer(lonely).some((e) => e.includes("至少要 2 個"))).toBe(true);
  });

  it("三個職業都有至少一個同時開放的群組", () => {
    for (const c of careers) expect(c.events.some((e) => e.group)).toBe(true);
  });

  describe("打斷事件與倒數計時的驗證", () => {
    const fresh = () => structuredClone(careers.find((c) => c.id === "teacher")!) as Career;

    it("打斷事件：during 必須存在、剛好 2 個選項、caller 不可過長、兩個選項都有代價且互不全面優於", () => {
      const c = fresh();
      c.interrupts![0].during = "nope";
      c.interrupts![0].caller = "這個來電者的名稱實在是太長太長了";
      c.interrupts![0].choices.push(structuredClone(c.interrupts![0].choices[0]));
      const errors = validateCareer(c);
      expect(errors.some((e) => e.includes("during"))).toBe(true);
      expect(errors.some((e) => e.includes("caller"))).toBe(true);
      expect(errors.some((e) => e.includes("選項需 2 個"))).toBe(true);

      const d = fresh();
      d.interrupts![0].choices = [
        { label: "好", effects: { trust: 5, time: -5 }, traits: {}, outcome: "好" },
        { label: "壞", effects: { trust: -5, time: -10 }, traits: {}, outcome: "壞" },
      ];
      expect(validateCareer(d).some((e) => e.includes("明顯正解"))).toBe(true);
    });

    it("打斷事件的 id 不可與事件重複，且必須有來源", () => {
      const c = fresh();
      c.interrupts![0].id = c.events[0].id;
      c.interrupts![0].sources = [];
      const errors = validateCareer(c);
      expect(errors.some((e) => e.includes("id 與其他事件或打斷重複"))).toBe(true);
      expect(errors.some((e) => e.includes("sources"))).toBe(true);
    });

    it("時限：太緊（做不完）或太鬆（沒壓力）都會被擋下", () => {
      const tight = fresh();
      tight.deadlines!["office-morning"] = 30;
      expect(validateCareer(tight).some((e) => e.includes("太緊"))).toBe(true);
      const loose = fresh();
      loose.deadlines!["office-morning"] = 150;
      expect(validateCareer(loose).some((e) => e.includes("太鬆"))).toBe(true);
    });

    it("時限指向不存在的群組會被擋下", () => {
      const c = fresh();
      c.deadlines!["ghost"] = 40;
      expect(validateCareer(c).some((e) => e.includes("沒有任何事件屬於這個 group"))).toBe(true);
    });

    it("有時限的群組必須有 expire；沒有時限的群組不該有；expire 要有代價", () => {
      const missing = fresh();
      delete missing.events.find((e) => e.id === "t-prep")!.expire;
      expect(validateCareer(missing).some((e) => e.includes("必須有 expire"))).toBe(true);

      const extra = fresh();
      extra.events[0].expire = { effects: { trust: -5 }, outcome: "x" };
      expect(validateCareer(extra).some((e) => e.includes("不該有 expire"))).toBe(true);

      const free = fresh();
      free.events.find((e) => e.id === "t-prep")!.expire = { effects: { trust: 5 }, outcome: "沒代價" };
      expect(validateCareer(free).some((e) => e.includes("expire 至少要有一項資源為負"))).toBe(true);
    });

    it("三個職業都有打斷事件與至少一個有時限的群組", () => {
      for (const c of careers) {
        expect(c.interrupts?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(Object.keys(c.deadlines ?? {}).length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("查資料", () => {
    const withInv = (mutate: (inv: NonNullable<Career["events"][number]["investigate"]>) => void) => {
      const bad = structuredClone(careers.find((c) => c.id === "swe")!) as Career;
      mutate(bad.events.find((e) => e.id === "s-alert")!.investigate!);
      return validateCareer(bad).filter((e) => e.includes("查資料"));
    };

    it("張數太少或太多會被擋下", () => {
      expect(withInv((inv) => (inv.items = inv.items.slice(0, 3))).some((e) => e.includes("資料卡需"))).toBe(true);
      expect(withInv((inv) => inv.items.push(...inv.items.slice(0, 2).map((it, i) => ({ ...it, id: `x${i}` })))).some((e) => e.includes("資料卡需"))).toBe(true);
    });

    it("有關張數不是 2–3 張會被擋下", () => {
      expect(withInv((inv) => inv.items.forEach((it) => (it.relevant = false))).some((e) => e.includes("有關的資料卡"))).toBe(true);
      expect(withInv((inv) => inv.items.forEach((it) => (it.relevant = true))).some((e) => e.includes("有關的資料卡"))).toBe(true);
    });

    it("過長的文字與重複 id 會被擋下", () => {
      expect(withInv((inv) => (inv.prompt = "字".repeat(41))).some((e) => e.includes("prompt"))).toBe(true);
      expect(withInv((inv) => (inv.items[0].label = "字".repeat(13))).some((e) => e.includes("label"))).toBe(true);
      expect(withInv((inv) => (inv.items[0].detail = "字".repeat(61))).some((e) => e.includes("detail"))).toBe(true);
      expect(withInv((inv) => (inv.items[1].id = inv.items[0].id)).some((e) => e.includes("id 重複"))).toBe(true);
    });
  });
});
