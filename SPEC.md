# 職場一日 — 遊戲規格 v0.1

> 給多代理開發用的共用合約。所有代理開工前先讀本文件；修改「劇本格式」需經主代理同意。

## 0. 目標

彌補台灣高中生對職業「想像 vs 實際」的落差。學生自己玩，單場 10–15 分鐘，手機可玩、免安裝、免登入。

第一版職業：**高中老師、軟體工程師、水電工**（節奏差異大：學期循環 / 專案迭代 / 現場工班）。

## 1. 核心循環

| 階段 | 玩家做什麼 | 設計重點 |
|---|---|---|
| 預測 | 用滑桿分配一天的時間比例（5 類） | 不給提示，記錄原始預測 |
| 上班 | 時間軸推進，事件打斷 | 資源：精力、時間、關係（信任） |
| 抉擇 | 每事件 2–3 選項 | 無標準答案，只有不同代價 |
| 對照 | 預測 vs 實際並排 | 落差最大的一類做重點說明 |
| 結算 | 生成可分享結算卡 | 顯示節奏偏好與價值取向，非「你適合 X」 |

### 時間分類（三職業共用，便於比較）
`core`（專業核心工作）、`communicate`（溝通協調）、`admin`（文書行政）、`wait`（等待/移動/零碎）、`learn`（學習與準備）

### 結算維度
- 節奏：穩定規律 ↔ 突發應變
- 互動：與人協作 ↔ 獨立專注
- 成就來源：看到人的改變 ↔ 解決問題 ↔ 做出實體成果
- 壓力類型：時間壓力 / 人際壓力 / 體力與安全壓力

## 2. 劇本格式（合約）

每個職業一個檔案：`content/careers/<id>.json`。

```ts
type Category = "core" | "communicate" | "admin" | "wait" | "learn";
type Stat = "energy" | "time" | "trust";

interface Career {
  id: string;                 // "teacher" | "swe" | "plumber"
  name: string;               // 顯示名稱
  intro: string;              // 開場 2–3 句
  dayStart: string;           // "07:30"
  dayEnd: string;             // "17:30"
  actualAllocation: Record<Category, number>; // 加總 = 100
  allocationSources: Source[];               // 必填，比例的依據
  events: GameEvent[];
  reflections: string[];      // 結算時顯示的 1–2 題自問題
}

interface GameEvent {
  id: string;
  time: string;               // "10:15"
  category: Category;
  title: string;
  body: string;               // ≤ 80 字，手機一屏
  choices: Choice[];          // 2–3 個
  tags: string[];             // 例 "成就感", "突發", "人際"
  sources: Source[];          // 必填
  requires?: string[];        // 前置旗標，做分支用
}

interface Choice {
  label: string;              // ≤ 20 字
  effects: Partial<Record<Stat, number>>; // -30 ~ +30
  traits: Partial<Record<"pace"|"social"|"achieve_people"|"achieve_solve"|"achieve_make", number>>;
  outcome: string;            // 選後的結果敘述 ≤ 60 字
  setFlags?: string[];
}

interface Source {
  type: "public_data" | "public_report" | "news" | "fiction";
  title: string;
  url?: string;
  note?: string;
}
```

規則：
- 每職業 8–12 個事件，至少 2 個帶「成就感」標籤。
- 每個選項都要有代價，禁止「明顯正確答案」。
- 一場中至少出現一個「我以為這份工作不用做這個」的事件（例如老師的行政、工程師的開會、水電的報價溝通）。

## 3. 真實性政策（沒有從業者資料時）

1. **比例數字只能來自公開資料**（政府統計、國際調查、職業公會、公開研究）。查不到就標 `"type": "fiction"`，並在對照畫面顯示「此比例為推估」。
2. **事件情境**可以虛構，但要對應公開描述的工作內容（例如勞動部職業介紹、職安規範、教育法規）。
3. 遊戲開頭與結算都顯示：「情境為虛構，比例依據見來源」。
4. 預留「從業者回饋」欄位，未來有訪談再更新。

### 待查證資料（研究代理負責）
- 高中老師：教學時數、行政工作與工時相關調查（例如 TALIS、教育部或教師團體公開調查）
- 軟體工程師：開發者時間分配調查（例如大型開發者問卷、公開研究）
- 水電工：工作內容與職安規範（勞動部職業介紹、職安署資料）、從業條件與證照

> 規則：未找到來源前，不得寫入具體數字。

## 4. 技術架構

- TypeScript + Vite，純前端，無後端
- 手機直向優先，最小寬度 360px
- 2D 卡片式介面 + 頂部時間軸
- 結算卡：前端 Canvas 生成 PNG，可下載/分享
- 進度存 localStorage（包 try/catch，失敗也能玩）

```
/content/careers/*.json     劇本（內容代理）
/content/schema.ts          型別與驗證（主代理）
/src/engine/                狀態機、事件排程、計分（引擎代理）
/src/ui/                    畫面元件（引擎代理）
/tests/                     格式驗證、路線可達性測試（審查代理）
```

## 5. 多代理分工

| 代理 | 職責 | 產出 | 依賴 |
|---|---|---|---|
| 主代理 | 維護本規格、schema、整合 | `schema.ts`、合併 | — |
| 研究代理 | 找公開資料、填來源 | `research/<id>.md` | 規格 |
| 內容代理 ×3 | 各寫一個職業劇本 | `careers/<id>.json` | schema、研究 |
| 引擎代理 | 遊戲循環與 UI | `src/` | schema |
| 審查代理 | 真實性、平衡、格式、可玩性 | 審查報告、測試 | 全部 |

執行順序：
1. 主代理定 schema → 2. 研究代理與引擎代理平行 → 3. 內容代理 ×3 平行 → 4. 審查代理 → 5. 主代理整合修正

審查代理不參與製作，只檢查並回報。

## 6. 第一版完成定義

- [ ] 三個職業都能從預測玩到結算
- [ ] 每個比例數字有來源或標示為推估
- [ ] 每職業至少 2 個成就感事件，無明顯正解選項
- [ ] 手機 360px 寬可順暢操作
- [ ] 結算卡可下載
- [ ] schema 驗證測試與全路線可達測試通過

## 附錄：v0.1 實作時的格式擴充（主代理）
- `Career.categoryNotes?`：對照畫面「落差最大的一類」顯示的說明。
- `Career.practitionerFeedback?`：從業者回饋預留欄位（§3.4）。
- 「我以為這份工作不用做這個」事件以標籤 `意想不到` 標示；測試保證每條路線至少遇到一個。
- 「每個選項都要有代價」的可驗證定義：每個選項至少一項資源為負，且同一事件內沒有選項在三項資源上全面優於另一個。
