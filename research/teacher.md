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

### 為什麼還不能寫進遊戲
1. **學段不符**：以上是**國中**。高中職（upper secondary）才是遊戲的對象；同一份報告指出臺灣是少數「高中老師教學時數比國中多、總工時也較長」的系統，所以不能拿國中數字代替。高中職的表是 Table I.2.29，只在線上附錄。
2. **缺項**：親師溝通、同儕協作、學生輔導、校務會議、課外活動的時數都在線上附錄的 Table I.2.27／I.2.29，這份報告沒有收錄。沒有這些就無法拆成遊戲的五類（核心／溝通／行政／零碎／學習）。
3. 用上面的數字硬湊會互相矛盾（教學＋備課＋批改已接近總工時，卻還要容納「超過 4 小時」的行政），不採用。

### 下一步
- 需要開放 `doi.org`（以及可能的 `stat.link`），才能下載 Vol. I 第 2 章的 StatLink Excel（`https://doi.org/10.1787/888933933045`），裡面應有 Table I.2.29（高中職）。
- 取得後再決定五類換算方式，並比照軟體工程師寫成測試。
- 在那之前，老師的比例維持推估（fiction）。
