---
"solve-engine": patch
---

`£100 in 1990 pounds` and `€100 in 2010 euros` ask what `$100 in 1990 dollars` asks, each through its own currency's price index

`£100 in 1990 pounds` and `€100 in 2000 euros` were parse errors (`Expected an operator or the end of the line, but found "1990"`), while `$100 in 1990 dollars` answered. The interest and inflation page adjusts amounts in all three currencies it bundles an index for, and the dollar spelling was the only one with a rule: `in <year> dollars` was fused into one token before parsing, and nothing fused `in <year> pounds` or `in <year> euros`, so the conversion `in` took the year and stranded the rest.

The rule now fuses the pound and euro words too (singular or plural, any case), one token per currency, and the phrase reads the amount's own index: the ONS CDKO series for pounds, the euro-area HICP for euros. An amount in another currency is refused by name with the form that reads its own index, as `£100 in 1990 dollars` already was; the pound and euro phrases answer `INFLATION_EXPECTED_CURRENCY`, and the dollar phrase keeps `INFLATION_EXPECTED_USD`.

| line | before | now |
| --- | --- | --- |
| `£100 in 1990 pounds` | Expected an operator or the end of the line, but found "1990" | £30.53 |
| `€100 in 2010 euros` | Expected an operator or the end of the line, but found "2010" | Year 2026 is outside the bundled euro-area price index's range (1999-2025): ... |
| `$100 in 1990 pounds` | Expected an operator or the end of the line, but found "1990" | in 1990 pounds asks for pounds sterling, and this amount is in USD: ask what it was worth in 1990 instead, which reads the US consumer price index (BLS CPI-U) |
| `$100 in 1990 dollars` | $39.46 | unchanged |
| `5 kg in pounds` | 11.02 pounds | unchanged |

The boundary: the phrase starts from today's money, so a euro line refuses until the euro-area series reaches the current year (it ends with 2025, as `what was €100 worth in 2010` already said); naming both years with `inflationAdjust` answers. A year is what makes it this phrase, so `5 kg in pounds` stays a conversion into the weight. A bare number names no currency and is refused as before, even though the phrase names one, the same as `100 in 1990 dollars`.

## Verification

`FoundBug_inYearPoundsAndEuros.spec.ts` (23 tests) holds the lines above through all three entry points, that each spelling answers what `what was ... worth in` answers, unit tests of `inYearTokenTypeFor`, the normaliser rule, `InYearMoneyParselet`, `inYearCurrencyRefused` and the `inflationToYearInCurrency` handler (an unknown code, a fault as the amount, a missing currency argument, prototype words), and the adversarial sides: prototype words either side of the year, deep brackets and a long sum as the amount, every text and numeric edge as the year and the amount, the amount from the line above with a check over it, and the document edges. `INFLATION_EXPECTED_CURRENCY` is in the catalogue snapshot and the reachability spec, and the error code reference is regenerated.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`; the docs, hardening, integration, packages and bugs suites, and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
