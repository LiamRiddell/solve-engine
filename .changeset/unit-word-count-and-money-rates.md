---
"solve-engine": patch
---

A time word agrees with its count, and a price per unit is written as money: `3600 seconds in hours` is `1 hour`, `$15 per hour` is `$15.00/hour`

A value is written with the unit it carries, so a time word kept whichever spelling it was typed or converted into: `3600 seconds in hours` showed `= 1 hours` and `2 hour` showed `= 2 hour` (#753). The time words come in singular and plural pairs, so a count of exactly one now takes the singular and every other count the plural. And the currency display matched only a bare currency code, so a rate such as `USD/hour` fell through to the generic form and showed its code, where `$15` on its own shows `$15.00`. A money rate now takes the currency's symbol, in the place the amount has it, with the unit after the slash; the text reads back in as the same rate.

| line | before | now |
| --- | --- | --- |
| `3600 seconds in hours` | 1 hours | 1 hour |
| `60 seconds in minutes` | 1 minutes | 1 minute |
| `2 hour` | 2 hour | 2 hours |
| `1/2 hour` | 0.50 hour | 0.50 hours |
| `$15 per hour` | 15.00 USD/hour | $15.00/hour |
| `£12 per hour` | 12.00 GBP/hour | £12.00/hour |
| `€20 per day` | 20.00 EUR/day | €20.00/day |
| `$0.30/kWh` | 0.30 USD/kWh | $0.30/kWh |
| `12 SEK per hour` | 12.00 SEK/hour | 12.00 kr/hour |
| `$30/hour * 8 hours/day` | 240.00 USD/day | $240.00/day |

The boundary: only the time words (`second`, `minute`, `hour`, `day`, `week`, `month`, `year` and their plurals) change spelling. A symbol never takes a plural (`2.00 h`, `1.00 min`), and other unit words are written as the value carries them, so `1609.344 m in miles` is still `1.00 miles`; unit names in general, and in the reader's language, are a separate feature. A count a little off one is shown with places and stays plural (`1.00 hours`), because the places mark it as a measurement. A currency with no symbol in the display table keeps its code (`5.00 UYU/hour`). The proven examples that showed a code in a rate, on the money-precision, time, unit-algebra and variables pages, now show the symbol, and the converting-units page explains the agreement.

## Verification

`Issue753_unitWordCountAndMoneyRates.spec.ts` holds 42 tests: each time word both ways, minus one, zero, a fraction and a value that displays as one without being one; the symbols left alone; each money rate, a negative one, a suffix currency, a currency with no symbol, a price below the decimal budget, and the text read back in; the helpers `timeWordForCount` and `moneyUnitOf` with ordinary, boundary and hostile arguments; a host with four places and a `de-DE` host; and the adversarial cases (prototype words as the rate's unit, markup-shaped text, a long line, the numeric edges, a rate from the line above through both document passes, a rate inside a check). Nine existing specs that pinned the code form or the unagreeing word were updated to the new text, and `AdversarialFeatureSweep.spec.ts` gains templates for the rate and the time words.

The full suite (`npm run test:full`) passed, 19,060 of 19,064 tests in 655 suites with 4 skipped, including the proven docs examples, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:error-codes`, `lint:stats`, `lint:size` and `lint:units`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
