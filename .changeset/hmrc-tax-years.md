---
"solve-engine": patch
---

The take-home figures name the tax year they are for, and the package ships a table for each year rather than one.

The payroll package carried a single table labelled 2024/25 and used it as the default for good, so the label went stale when the tax year rolled over and nothing said which year an answer was on. There is now a table for 2024/25, 2025/26 and 2026/27, a lookup by the year as a reader writes it (`2025/26`, `2025-26`, `2025/2026`), and the default is the latest table shipped.

| | before | now |
| --- | --- | --- |
| the year an answer is on | 2024/25, whatever the date | 2026/27, the latest table shipped |
| a year the package has no figures for | not askable | answered as unknown, never the nearest year |

No result changes. HMRC left the employee figures unchanged across all three years (the £12,570 personal allowance tapering above £100,000, income tax at 20%, 40% and 45%, and employee National Insurance at 8% between £12,570 and £50,270 then 2% above), so `50000 after tax` is `39,519.60` under each.

The default is deliberately the latest table rather than a year read off today's date. A tax year the package has no figures for would otherwise be answered with the previous year's, silently, which is the same mistake as assuming a sales-tax rate. The employer's National Insurance rate and secondary threshold did move in April 2025; this package models an employee's deductions only, so those do not appear.
