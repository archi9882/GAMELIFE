# 研究筆記：高中老師

狀態：**比例尚未找到可直接引用的數字 → 劇本以 `fiction` 標示推估**

## 已查到（2026-10-21）
| 來源 | 用途 | 狀態 |
|---|---|---|
| [國立高級中等學校教師每週教學節數標準](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCODE=H0060059)（最新修正 111-07-04） | 基本教學節數的法源 | 頁面上的節數表無法擷取，**數字未寫入**，需開啟完整條文檔查 |
| [陳惠雪：國小教師專業發展阻礙與助益之探究：基於 TALIS 2018](https://em.ntue.edu.tw/var/file/22/1022/img/923/287490993.pdf) | 定性：臺灣教師行政校務時數高於 TALIS 平均（引柯華葳等，2019） | 對象為國小，只作定性參考 |

## 待查
- OECD TALIS 2018 Volume I 線上表格「Teachers' working hours, by type of activity」的 Chinese Taipei 數字（國中）。
- 柯華葳等（2019）TALIS 2018 臺灣報告的工時分配圖表。
- 注意：TALIS 臺灣樣本是國中、國小，**沒有高中**；引用時需註明學段差異。

## 2026-10-21 補充（已開放 OECD 網域後的查證）
**能讀到的**：`www.oecd.org` 的 PDF 可用（需瀏覽器 User-Agent）。`doi.org`（StatLink 與 DOI 轉址）、`gpseducation.oecd.org`（403）、`talis.naer.edu.tw`（無法解析）仍連不上。

### 臺灣數字（TALIS 2018，**國中＝lower secondary，全職教師**）
來源：Boeskens & Nusche (2021), *Not enough hours in the day: Policies that shape teachers' use of time*, OECD Education Working Papers No. 245（[PDF](https://www.oecd.org/content/dam/oecd/en/publications/reports/2021/01/not-enough-hours-in-the-day_4ebd6b3d/15990b42-en.pdf)），附錄表格轉引 TALIS 2018 資料庫。

| 指標 | Chinese Taipei | 出處 |
|---|---|---|
| 每週總工時（60 分鐘小時） | 36.0 | Table A.1 平均值 |
| 每週教學時數 | 17.2 | Table A.3 平均值 |
| 備課時間（每教學小時） | 0.5 | Table A.5 平均值（單位依原表） |
| 批改時間（每教學小時） | 0.3 | Table A.7 平均值（單位依原表） |
| 一般行政工作（含溝通、文書） | 「超過 4 小時」 | 正文第 2 節；OECD 平均 2.7 |

OECD 平均（全學段）：總工時 38.8、教學 20.6、備課 6.5、批改 4.2（TALIS 2018 Vol. I，p. 70）。

### 高中職（upper secondary）完整數字：已取得
`doi.org` 與 `statlinks.oecdcode.org` 開放後，下載 TALIS 2018 Vol. I 第 2 章的 StatLink Excel（`https://doi.org/10.1787/888933933045`），工作表 **Table I.2.29**「Upper secondary teachers' working hours」，Chinese Taipei 一列（平均值，單位：60 分鐘小時／週）：

| 任務 | 小時 | 本專案歸類 |
|---|---|---|
| Teaching | 18.70 | core |
| Marking/correcting student work | 3.95 | core |
| Engaging in extracurricular activities | 2.27 | core |
| Team work and dialogue with colleagues | 3.14 | communicate |
| Counselling students | 3.37 | communicate |
| Communication and co-operation with parents | 1.61 | communicate |
| General administrative work | 4.44 | admin |
| Participation in school management | 4.40 | admin |
| Individual planning or preparation of lessons | 8.01 | learn |
| Professional development activities | 2.76 | learn |
| Other work tasks | 2.01 | wait（近似） |
| （總工時 Total working hours） | 37.08 | 不使用 |

核心 24.92、溝通 8.12、行政 8.84、學習 10.77、零碎 2.01，合計 54.66。以 54.66 為分母、最大餘數法得 **45 / 15 / 16 / 20 / 4**。`tests/allocation.test.ts` 會驗證 JSON 與這個換算一致。

對照：國中（Table I.2.27）臺灣總工時 35.73、教學 17.16、備課 6.94；OECD 平均（國中，31 國）總工時 38.83、教學 20.64、備課 6.53。高中職表沒有 OECD 平均列，所以遊戲內不做跨國比較。

### 限制（已寫入遊戲內來源說明）
- **各項加總 54.66 ≠ 總工時 37.08**。原表註 2：各項是分開詢問的，所以不相等；平均也包含兼任教師。本專案取「各項占加總的比例」，這個做法放大或縮小個別項目的程度未知。
- 歸類是本專案判斷，不是 OECD 的分類。最敏感的兩個判斷：備課歸「學習與準備」（符合遊戲 learn 的定義與 t-prep 事件）、課外活動歸核心。
- TALIS 沒有「等待、移動」類別，遊戲的零碎類只能用「其他工作」近似（4%）。
- 2018 年調查，自我回報「最近一個完整工作週」；臺灣資料由國際團隊代為蒐集處理。
- 這是全體高中職教師平均，不是「兼任導師的數學老師」；遊戲主角的情境是虛構的。

狀態：**比例已有公開來源**，遊戲內不再標示為推估。
