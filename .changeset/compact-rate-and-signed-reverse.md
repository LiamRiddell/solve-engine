---
"solve-engine": patch
---

A price per unit keeps its currency symbol when written short, and a reversed conversion reads a signed count: `$15/hour as compact` is `$15/hour`, and `km in -1 mile` is -1.61 km

`as compact` and `as engineering` looked the whole of a rate's unit up in the currency display table, where `USD/hour` is not a currency, so a price per unit lost its symbol though the full answer has it. The short form is now written as the full one is: the symbol in front, the sign before it, and the unit after a slash. The reversed conversion (`km in 1 mile`) read only an unsigned count after `in`, so with a sign the rule did not match and the leading unit was read as a variable, which failed as `Undefined variable: km`. A sign in front of the count is now kept in front of it, so the line asks `-1 mile in km`.

| line | before | now |
| --- | --- | --- |
| `$15/hour as compact` | 15 USD/hour | $15/hour |
| `km in -1 mile` | throws `Undefined variable: km` | -1.61 km |

The boundary: a currency whose symbol follows the amount keeps its code in the short form, as it did (`15 SEK/hour as compact` is `15 SEK/hour`), and one sign is read, not two. The decimals page and the converting units page are updated, and the latter no longer says a signed amount is not read.

## Verification

`Issue_CompactRateAndSignedReversedConversion.spec.ts` holds 77 tests: rates, money and quantities written short, the signed reversed conversions and their agreement with the forward form, unit tests of `withUnit` and of the reversed-conversion rule with ordinary, boundary and hostile arguments, and the adversarial cases: prototype words as the unit, the numeric edges through both forms, text edges and a document through both passes.

The full suite (`npm run test:full`, which includes the lexer fuzz and long-document suites) passed, 21,509 of 21,513 tests in 681 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:keywords`, and the proven documentation examples all evaluate as documented. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
