# 研究筆記：軟體工程師

狀態：**比例已有公開來源（2026-10-21 查證）**，遊戲內不再標示為推估。

## 來源
Meyer, Barr, Bird, Zimmermann. *Today was a Good Day: The Daily Life of Software Developers.* IEEE TSE, 2021.
[Microsoft Research 預印本 PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/04/devtime-preprint-TSE19.pdf)，第 6.2 節 Table 2。

- 樣本：微軟開發者，5928 筆「前一個工作日」的自我回報；平均一天 9.08 小時。
- 取用欄位：All（全部工作日）。表中另有 Typical / Atypical / Good / Bad 工作日的分欄，遊戲未使用。

## Table 2 原始數字（%，全部工作日）
| 類別 | % | 本專案歸類 |
|---|---|---|
| Coding | 15 | core |
| Bugfixing | 14 | core |
| Testing | 8 | core |
| Specification | 4 | core |
| Reviewing code | 5 | core |
| Documentation | 2 | admin |
| Meetings | 15 | communicate |
| Email | 10 | communicate |
| Interruptions | 4 | communicate |
| Helping / mentoring | 5 | communicate |
| Networking | 2 | communicate |
| Learning | 3 | learn |
| Administrative tasks | 2 | admin |
| Breaks | 8 | **排除** |
| Various（移動、規劃、環境架設） | 3 | wait |

換算：core 46、communicate 36、admin 4、learn 3、wait 3，合計 92。排除休息後以 92 為分母，最大餘數法得 **50 / 39 / 5 / 3 / 3**。`tests/allocation.test.ts` 會驗證 JSON 與這個換算一致。

## 限制（已寫入遊戲內來源說明）
- 單一公司（微軟）、自我回報，不是計時紀錄。
- 原表沒有「等待」類別，遊戲的 wait 只能用 Various（3%）近似，所以遊戲裡「等待 CI」這類事件比它在資料中占的比例更突出。歸類是本專案的判斷，不是原作者的分類。
- 臺灣工程師與非大型軟體公司可能不同。
