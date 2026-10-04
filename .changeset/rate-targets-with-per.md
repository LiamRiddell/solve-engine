---
"solve-engine": minor
---

A conversion target can be written as a rate the way the source can: `60 km/h in miles per hour` and `$20/hour in $/day` convert

The source side of a conversion read a rate written with `per` or with a currency symbol, but the target side did not, so a reader converting a speed or a pay rate had to change spelling halfway through the line (#738). The target was cut at its first unit: `in miles` was taken as the target and `per hour` read after the conversion, so the speed was refused as not a length. A target written `<unit> per <unit>`, `<unit>/<unit>`, `<symbol>/<unit>` or `/<unit>` straight after `in` or `to` is now read as one unit.

| line | before | now |
| --- | --- | --- |
| `60 km/h in miles per hour` | error: cannot convert km/h to miles | 37.28 miles/hour |
| `$20/hour in $/day` | error: cannot convert USD/hour to USD | $480.00/day |
| `$20/hour in dollars per day` | error: cannot convert USD/hour to USD | $480.00/day |
| `$20 per hour in USD per day` | error: cannot convert USD/hour to USD | $480.00/day |
| `$50/week in /month` | `USD/week/month: that is already a rate` | $214.29/month |

A bare slash keeps what a rate counts and changes what it is per, so `$50/week in /month` is `$50/week in $/month`. A price per unit converts into another currency per unit through the exchange rate (`$20/hour in €/day` is €432.00/day at 0.9 euros to the dollar), and before a rate is known the line says the rate is missing (`No exchange rate available for USD to EUR`) rather than that the two do not measure the same thing.

The boundary: `in $` on its own is still a currency conversion, since a symbol is joined only when a denominator follows. Only `per` and the slash are read in a target: `a`, `each` and `every` introduce a rate on the source side, but after a conversion they are prose, so `100 km in miles a day` is unchanged. Straight after a number, `in` is the inch, so `5 in/s` is still five inches a second. A distance into a speed target is refused (`5 km in miles per hour`), where it used to convert the distance and then make it a rate. What a trailing `in` converts in general is not changed. The rates and speeds page gains a section on rate targets.

## Verification

`Issue738_rateTargets.spec.ts` holds 101 tests: each spelling of a rate target for a speed, a pay rate and a data rate, a symbol with and without spaces, a bare slash, a target in another currency at a primed rate and with none, what stays as it was (`in $`, `a` and `each` in prose, the inch, a distance into a speed), unit tests of `rateTargetNumerator`, the rule's `match` and `convertRate` across currencies, and the adversarial cases: prototype words as the numerator, the denominator and after a bare slash, a 300-conversion chain, look-alike and markup-shaped text, a document through both passes with a check over it, and the numeric edges. Two `test.failing` cases in `UnitsCurrencyAndRates.spec.ts` that pinned `$100/hour in $/day` now pass and were moved into the passing set, and the guard in `DifferentialRegressions.spec.ts` now uses a rate into a rate of another measure.

The full suite (`npm run test:full`, which includes the lexer fuzz and long-document suites) passed, 21,509 of 21,513 tests in 681 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:keywords`, and the proven documentation examples all evaluate as documented. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
