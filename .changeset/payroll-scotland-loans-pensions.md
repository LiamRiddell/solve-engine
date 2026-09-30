---
"solve-engine": minor
---

Take-home pay is worked out for Scotland, with a student loan plan and with a pension contribution: `take home on £50,000 in Scotland` is `£38,023.55`

The take-home forms covered a straightforward employee in England, Wales and Northern Ireland, and the three cases that most often change the real number were a unit message or a parser error (#747). Scotland sets its own income tax, in six bands where the rest of the UK has three, so the band tables became a list of bands per jurisdiction. Student loans and pensions are deductions the forms now take by name.

| line | before | now |
| --- | --- | --- |
| `take home on £50,000 in Scotland` | `"Scotland" is not a unit.` | `£38,023.55` |
| `£50,000 after tax in Scotland` | `"Scotland" is not a unit.` | `£38,023.55` |
| `take home on £50,000 with 5% pension` | throws `Expected an operator or the end of the line, but found "pension"` | `£37,519.60` |
| `£50,000 after tax with plan 2 student loan` | throws `Expected an operator or the end of the line, but found "2"` | `£37,664.25` |
| `£50,000 after tax with student loan` | throws, at `loan` | `a student loan needs its plan: write "with plan 1 student loan" (or plan 2, plan 4 or plan 5), or "with postgraduate loan"` |
| `£50,000 after tax in Scotland with plan 4 student loan and 5% pension` | throws `Expected an operator or the end of the line, but found "4"` | `£35,115.10` |

The clauses: `in Scotland` charges the Scottish bands (starter 19%, basic 20%, intermediate 21%, higher 42%, advanced 45%, top 48%); `in England`, `in Wales` and `in Northern Ireland` name the default. `with plan 1 student loan`, plan 2, plan 4, plan 5 and `with postgraduate loan` take 9% (6% for the postgraduate loan) of pay above the plan's threshold. `with 5% pension` takes a contribution from gross pay before income tax, a net pay arrangement, and the personal allowance tapers on the reduced income. Clauses may follow in any order, each with `with` or joined by `and`. Each kind is written once, and two undergraduate plans together are refused, since they share one threshold under rules not modelled here.

Every figure is public data for its tax year, one per line in `HmrcBands.ts`: the Scottish bands for 2024/25, 2025/26 and 2026/27, and the Student Loans Company's thresholds for each year (Plan 5 from 2026/27). The default year is still the latest shipped, never read off the clock.

The boundary: a tax code other than the standard one and self-employment stay out, as before. Pensions by relief at source or salary sacrifice give different answers (a salary sacrifice lowers National Insurance too) and are not modelled. `after 20% tax` takes no clause, since its rate is already stated. The England, Wales and Northern Ireland answers and the pound requirement are unchanged.

## Verification

`Issue747_payrollScotlandLoansPensions.spec.ts` holds 35 tests: both forms and the monthly form in Scotland, the taper across the Scottish bands, a salary a pound either side of every Scottish band boundary, each loan plan, a threshold met exactly, the postgraduate loan beside a plan, the pension taking income below the taper, every refusal, what must not break, unit tests of `taxThroughBands`, `incomeTax`, `studentLoanRepayment`, `pensionContribution`, `payslip`, `readPayrollCase` and `payrollCaseNormalizerRule`, the published figures of each year, and adversarial numeric edges, prototype words, text edges and a line of five hundred clauses. `PayrollTaxYears.spec.ts` was updated for the new band shape. The fast suite (`npm run test:ci`), the type checks, the lints and the proven docs examples passed.
