---
"solve-engine": patch
---

Every return form answers a percentage, and a thousands comma in an amount of money inside a call is read as grouping: `compoundInterest($1,000, 5%, 3)` is $1,157.63

`$1,000 invested $1,500 returned` and `compoundInterestRate(...)` answered a bare fraction where `annual return on` answered a percentage, so one question gave two kinds of answer. Inside a call's brackets a comma separates arguments, which split `$1,000` into `$1` and `000`, and `compoundInterest($1,000, 5%, 3)` was refused as a call with four arguments (#830).

| line | before | now |
| --- | --- | --- |
| `$1,000 invested $1,500 returned` | 0.50 | 50.00% |
| `compoundInterestRate($1,000, $1,500, 3)` | throws `compoundInterestRate() takes 3 arguments, but was given 5 arguments` | 14.47% |
| `compoundInterest($1,000, 5%, 3)` | throws `compoundInterest() takes 3 arguments, but was given 4 arguments` | $1,157.63 |
| `max($1,000, 2)` | 2 | $1,000.00 |

A return is a share of what went in, so all three forms now answer a percentage, which still composes as the fraction it is (`($1,000 invested $1,500 returned) * $1,000` is $500.00) and gives the money multiple through `as multiplier` (3x for a 200% return). Inside a call or a list, a comma after an amount with a currency sign in front, followed by exactly three digits and then the end of the amount (a comma, a decimal point, a closing bracket or a space), groups the thousands, as it does outside a call.

The boundary, and the ambiguity it names: `max($1,234)` is read as the one amount $1,234, and a space after the comma (`max($1, 234)`) keeps two arguments. A plain number keeps the separator reading, so `max(1,000, 2)` is still the largest of 1, 0 and 2 and `rgb(255,255,255)` is still three numbers; an amount with its currency after it (`1,000 USD`) inside a call is not read as grouped. The interest and currency pages gain the return forms and the rule for amounts inside a call, with proven examples, and the Soulver parity row for `$500 invested $1,500 returned` now pins 200.00%.

## Verification

`Issue830_returnsAndGroupedAmounts.spec.ts` holds 31 tests: each return form's answer and its type, the compound rate against the annual return, a return composing with money and as a multiplier, nothing invested refused; grouped amounts in calls in dollars, pounds and euros, with decimals, negatives and several groups, the same amount inside and outside a call, and each boundary (a plain number, a group that is not three digits, a space after the comma, the named ambiguity); unit tests of `currencySignBefore` and `groupsCurrencyInCall`; and adversarial cases from the three sides (prototype words, a long list of amounts and deep brackets, a full-width dollar sign and digits and a zero-width space, amounts from the lines above with a what-if through both document passes, and the numeric corpus). `npm run typecheck`, `npm run lint`, `npm run lint:comments`, `npm run lint:docs`, `npm run lint:cheatsheet` and `npm run lint:sidebar` passed, the proven docs examples passed, and the fast suite passed, 16,029 of 16,033 tests in 618 suites with 4 skipped. `executeBytecode` is 47,517 bytecode bytes on Node 22.
