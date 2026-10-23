import { describe, expect, it } from "vitest";
import { careers } from "../content/index";
import { LIMITS, validateCareer, type Career } from "../content/schema";
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

  describe("專業小遊戲（查資料的 kind）", () => {
    const swe = careers.find((c) => c.id === "swe")!;
    const errsFor = (eventId: string, mutate: (inv: NonNullable<Career["events"][number]["investigate"]>) => void) => {
      const bad = structuredClone(swe) as Career;
      mutate(bad.events.find((e) => e.id === eventId)!.investigate!);
      return validateCareer(bad).filter((e) => e.includes("查資料"));
    };

    it("軟體工程師三個小遊戲各用一種 kind；已參考從業者回饋，不再標示待審查", () => {
      const kinds = Object.fromEntries(swe.events.filter((e) => e.investigate?.kind).map((e) => [e.id, e.investigate!.kind]));
      expect(kinds).toEqual({ "s-review": "review", "s-unittest": "test", "s-deepwork": "debug" });
      expect(swe.practitionerFeedback?.[0]?.date).toBe("2026-10-22");
      for (const id of Object.keys(kinds)) {
        const inv = swe.events.find((e) => e.id === id)!.investigate!;
        expect(inv.reviewPending).toBeUndefined();
        expect(inv.tip).toBeTruthy();
        expect(inv.items.every((it) => !!it.why)).toBe(true);
      }
    });

    it("kind 必須是 info、review、debug、test 之一", () => {
      expect(errsFor("s-review", (inv) => ((inv as { kind: string }).kind = "quiz")).some((e) => e.includes("kind 不合法"))).toBe(true);
    });

    it("review 的 label 是程式碼行，上限放寬到 codeLineMax；其他 kind 維持 itemLabelMax", () => {
      expect(errsFor("s-review", (inv) => (inv.items[0].label = "x".repeat(LIMITS.codeLineMax)))).toEqual([]);
      expect(errsFor("s-review", (inv) => (inv.items[0].label = "x".repeat(LIMITS.codeLineMax + 1))).some((e) => e.includes("label"))).toBe(true);
      expect(errsFor("s-unittest", (inv) => (inv.items[0].label = "x".repeat(LIMITS.itemLabelMax + 1))).some((e) => e.includes("label"))).toBe(true);
    });

    it("why、tip 過長或空白會被擋下", () => {
      expect(errsFor("s-review", (inv) => (inv.items[0].why = "字".repeat(LIMITS.whyMax + 1))).some((e) => e.includes("why"))).toBe(true);
      expect(errsFor("s-review", (inv) => (inv.items[0].why = "")).some((e) => e.includes("why"))).toBe(true);
      expect(errsFor("s-review", (inv) => (inv.tip = "字".repeat(LIMITS.tipMax + 1))).some((e) => e.includes("tip"))).toBe(true);
    });

    it("tag 只能用在 debug，且必須是三種標籤之一", () => {
      expect(errsFor("s-deepwork", (inv) => ((inv.items[0] as { tag: string }).tag = "網路")).some((e) => e.includes("tag 不合法"))).toBe(true);
      expect(errsFor("s-review", (inv) => (inv.items[0].tag = "程式碼")).some((e) => e.includes("只有 debug"))).toBe(true);
    });

    it("名詞比對涵蓋 why、tip 與打斷事件的文字", () => {
      const withTerm = (mutate: (c: Career) => void) => {
        const c = structuredClone(swe) as Career;
        c.glossary!.push({ term: "冷門詞", meaning: "測試用" });
        mutate(c);
        return validateCareer(c).some((e) => e.includes("冷門詞"));
      };
      expect(withTerm(() => {})).toBe(true);
      expect(withTerm((c) => (c.events.find((e) => e.id === "s-review")!.investigate!.items[0].why = "冷門詞"))).toBe(false);
      expect(withTerm((c) => (c.events.find((e) => e.id === "s-review")!.investigate!.tip = "冷門詞"))).toBe(false);
      expect(withTerm((c) => (c.interrupts!.find((i) => i.id === "i-s-printer")!.body = "冷門詞"))).toBe(false);
    });

    it("新名詞（單元測試、除錯、UTC、時區）都在詞彙表裡", () => {
      const terms = swe.glossary!.map((g) => g.term);
      for (const t of ["單元測試", "除錯", "UTC", "時區"]) expect(terms).toContain(t);
    });

    it("新名詞（ticket、Scrum、開發環境、正式環境、本機測試）都在詞彙表裡", () => {
      const terms = swe.glossary!.map((g) => g.term);
      for (const t of ["ticket", "Scrum", "開發環境", "正式環境", "本機測試", "事後檢討", "工單"]) expect(terms).toContain(t);
    });

    it("修印表機是 s-ci 期間的打斷事件", () => {
      const it = swe.interrupts!.find((i) => i.id === "i-s-printer")!;
      expect(it.during).toBe("s-ci");
      expect(it.choices).toHaveLength(2);
    });
  });

  describe("ticket 主線（v0.10）", () => {
    const swe = careers.find((c) => c.id === "swe")!;
    const fresh = () => structuredClone(swe) as Career;

    it("事件上限 14，軟體工程師剛好 14 件；超過會被擋下", () => {
      expect(LIMITS.eventsMax).toBe(14);
      expect(swe.events).toHaveLength(14);
      const c = fresh();
      c.events.push({ ...structuredClone(c.events[c.events.length - 1]), id: "s-extra", group: undefined, expire: undefined, time: "18:00" });
      expect(validateCareer(c).some((e) => e.includes("事件數需"))).toBe(true);
    });

    it("requiresAny：旗標必須由更早的選項設定，且至少 2 個", () => {
      const c = fresh();
      c.events.find((e) => e.id === "s-returned")!.requiresAny = ["rushed_dev", "nope"];
      expect(validateCareer(c).some((e) => e.includes("requiresAny") && e.includes("nope"))).toBe(true);
      const one = fresh();
      one.events.find((e) => e.id === "s-returned")!.requiresAny = ["rushed_dev"];
      expect(validateCareer(one).some((e) => e.includes("至少要 2 個旗標"))).toBe(true);
    });

    it("條件時限：每種條件事件組合都要做得完", () => {
      const c = fresh();
      c.deadlines!.evening = { base: 40, extra: { "s-bug-found": 14 } };
      const errs = validateCareer(c);
      expect(errs.some((e) => e.includes("太緊") && e.includes("s-bug-found有"))).toBe(true);
      expect(errs.some((e) => e.includes("s-bug-found無"))).toBe(false);
    });

    it("條件時限：每種組合都要有壓力", () => {
      const c = fresh();
      c.deadlines!.evening = { base: 80, extra: { "s-bug-found": 15 } };
      expect(validateCareer(c).some((e) => e.includes("太鬆") && e.includes("s-bug-found無"))).toBe(true);
    });

    it("條件時限：extra 只能指向同組的條件事件，且為正整數", () => {
      const c = fresh();
      c.deadlines!.evening = { base: 40, extra: { "s-bug-found": 15, "s-mentor": 5, "s-review": 5 } };
      const errs = validateCareer(c);
      expect(errs.some((e) => e.includes("s-mentor") && e.includes("不是條件事件"))).toBe(true);
      expect(errs.some((e) => e.includes("s-review") && e.includes("不在這個 group"))).toBe(true);
      const neg = fresh();
      neg.deadlines!.evening = { base: 55, extra: { "s-bug-found": 0 } };
      expect(validateCareer(neg).some((e) => e.includes("正整數"))).toBe(true);
    });

    it("時限仍可用單一數字", () => {
      const c = fresh();
      c.deadlines!.evening = 55;
      expect(validateCareer(c)).toEqual([]);
    });
  });

  describe("說話者 speaker（v0.12 對話框名牌）", () => {
    const swe = () => structuredClone(careers.find((c) => c.id === "swe")!) as Career;

    it("選填：沒有 speaker 的事件仍通過驗證", () => {
      const c = swe();
      for (const e of c.events) delete e.speaker;
      expect(validateCareer(c)).toEqual([]);
    });

    it("空白、只有空格、過長或不是文字都會被擋下", () => {
      for (const bad of ["", "   ", "字".repeat(LIMITS.speakerMax + 1), 42 as unknown as string]) {
        const c = swe();
        c.events[0].speaker = bad;
        expect(validateCareer(c).some((e) => e.includes("s-standup") && e.includes("speaker")), String(bad)).toBe(true);
      }
      const ok = swe();
      ok.events[0].speaker = "字".repeat(LIMITS.speakerMax);
      expect(validateCareer(ok)).toEqual([]);
    });

    it("軟體工程師：有人說話的事件標上說話者，旁白事件不填", () => {
      const c = careers.find((x) => x.id === "swe")!;
      const by = Object.fromEntries(c.events.map((e) => [e.id, e.speaker]));
      expect(by["s-scope"]).toBe("產品經理");
      expect(by["s-returned"]).toBe("主管");
      expect(by["s-postmortem"]).toBe("主管");
      expect(by["s-mentor"]).toBe("新人");
      expect(by["s-review"]).toBe("同事");
      // 小遊戲與等待類事件是旁白（對話框不顯示名牌）
      for (const id of ["s-alert", "s-unittest", "s-deepwork", "s-ci"]) expect(by[id], id).toBeUndefined();
      for (const e of c.events) if (e.speaker !== undefined) expect(e.speaker.length).toBeGreaterThan(0);
    });
  });
});
