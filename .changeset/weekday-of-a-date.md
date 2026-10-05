---
"solve-engine": patch
---

`weekday of 2026-10-01` asks which day of the week a date falls on, as `weekday on` does, so a function written with it works: `f(d) = weekday of d` then `f(2026-10-01)` is Thursday, where the call said "Undefined variable: weekday"

A function's formula is read the way a line is, so every phrase form works in one (`15% of x`, `x in km`, `weekday on d`, `month of d`). `weekday of` was no phrase anywhere: `weekday of 2026-10-01` on its own line was the undefined variable `weekday` too, and a definition written with it was accepted and then failed at every call (found in testing). `weekday of`, `day of the week of`, `day of week of` and `day of week on` are now the datetime package's spellings of the weekday question, beside `month of` and `week number of`.

| line | before | now |
| --- | --- | --- |
| `f(d) = weekday of d` then `f(2026-10-01)` | Undefined variable: weekday | `Thursday` |
| `weekday of 2026-12-25` | Undefined variable: weekday | `Friday` |
| `f(d) = day of week of d` then `f(2026-10-01)` | Undefined variable: day | `Thursday` |
| `weekday of 5` | Undefined variable: weekday | "weekday" expects a date, but got a number. |
| `f(x) = 15% of x` then `f(200)` | `30` | `30` |

The boundary: a name in a formula that is no phrase and no variable yet is still an honest undefined name when the function is called, since a formula may use a variable defined further down the note (`f(x) = x * rate`, then `rate = 3`), so the definition is not refused for it. `weekday` on its own stays a name a reader can define (`weekday = 3`), and `weekdays of 2` is still that variable times two.

## Verification

`FoundBug_weekdayOfInAFunctionBody.spec.ts` holds 18 tests: the lines that exposed it through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`, the other spellings, the other phrase forms in a formula (`15% of x`, `x in km`, `month of d`, `week number of d`, `is a weekday`), a variable defined later; unit tests of the package's phrase table (ordinary, boundary, hostile: inherited names); and the adversarial cases (prototype words as the date and as the argument with `Object.prototype` unchanged, five hundred repeats in time, every text edge, a number where a date belongs, a date from the line above, a check and a sum inside it, `weekday` as a variable, a section, a leap day, a month end and a new year, every numeric edge, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `weekday of X`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:keywords`, the docs example specs, `NormaliserRulesRejectCheaply`, the hardening and integration specs, and the fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
