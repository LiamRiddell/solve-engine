---
"solve-engine": patch
---

Refusals and labels say what the reader wrote rather than what the engine calls it: a value's kind in words, an invisible character as its code point, the ordinal a reader typed, a loan's terms, where a goal seek sits, and a city's own capitals

These were found by earlier adversarial batches. The date and working-day refusals printed a value's internal type (`got Number and Number`, `got Uom`); an undefined name was printed as typed, so a direction override inside it reversed the rest of the message on screen; `the 2nd tuesday of 5` quoted "2:2", the fused token's internal value; a repayment on an amount that came to zero or less named the function behind the phrase (`loanRepayment: principal must be positive`); a goal seek on a line that a what-if re-runs was told it was in the batch pass, since a what-if's scenario is a batch pass of its own; and a list of zones labelled "Rio de Janeiro" as "Rio De Janeiro", because the label raised every letter after a word boundary.

| line | before | now |
| --- | --- | --- |
| `workdays between 5 and 10` | "working days between" expects two dates, got Number and Number | "working days between" expects two dates, but got a number and a number. |
| `workdays between 5 m and 10` | ... got Uom and Number | ... but got an amount in m and a number. |
| `foo + 1` with a U+202E before `foo` | Undefined variable: foo, with the override printed raw | Undefined variable: <U+202E>foo |
| `the 2nd tuesday of 5` | ... but found "2:2" | ... but found "2nd tuesday" |
| `monthly repayment on (p - 1000) over 25 years at 4%`, `p` 1000 | loanRepayment: principal must be positive | The amount borrowed must be more than zero to work out a repayment. |
| `line 3 with x = 4`, line 3 a goal seek | Goal seek re-runs another line, which the batch pass (parseDocument) cannot do ... | Goal seek cannot run inside a what-if: the what-if works each line of its scenario out once, and a goal seek re-runs another line many times. Solve the line outside the what-if. |
| `3pm London in Tokyo, Rio de Janeiro, New York` | Tokyo 11:00 PM, Rio De Janeiro 11:00 AM, New York 10:00 AM | Tokyo 11:00 PM, Rio de Janeiro 11:00 AM, New York 10:00 AM |

A line context now says when it runs a what-if's scenario (`LineExecutionContext.inWhatIf`), which a package function that cannot answer there can read to say so; the functions-and-operators guide describes it beside `rerunLines`. The codes are unchanged throughout, so a host that reads them sees no difference.

The boundary: `evaluateLine` at any line number is still the single-expression entry point, since it is handed no document, and its goal-seek refusal says so, as #617 settled. A zone label keeps whatever the reader capitalised, so `Rio De Janeiro` typed that way stays that way; only a linking word the reader wrote in lower case (`de`, `of`, `es`) is left lower case. The other finance builtins that still prefix a function name to a refusal (`compoundInterest: ...`, `taxRemove: ...`, `presentValue: ...`) are not changed here, and are left for a change of their own.

## Verification

`FoundBug_internalNamesInRefusals.spec.ts` (14 tests), `FoundBug_goalSeekLoanRefusals.spec.ts` (15), `FoundBug_goalSeekRefusalNamesWhereItIs.spec.ts` (13) and `FoundBug_zoneNameCapitals.spec.ts` (12) hold the lines above, unit tests of `valueKindName`, `sourceTextOf`, `safeText`, `loanTermsRefused`, `goalSeekNoRerunMessage`, `goalSeekHandler` and `zoneDisplayName` with ordinary, boundary and hostile arguments, and the three adversarial sides: prototype words as names, units, months, zones and unknowns, every direction and zero-width character in an undefined name, markup-shaped text, the value from the line above through both document passes, and the numeric edges. The cross-path spec gains the what-if case through all three entry points. The goal-seek and time-zones pages show the new wording as proven examples, and the what-if page's boundary list says it.
