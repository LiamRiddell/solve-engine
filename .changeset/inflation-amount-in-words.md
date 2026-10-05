---
"solve-engine": patch
---

An inflation question about something that is not money is refused by the word the reader wrote, and its amount can be worked out on the line

`what is 100 apples from 1990` answered `Expected "from <year>" or "in <year> worth in <year>" after "what is <amount>", but found "*"`, naming a star the reader never typed. The normaliser reads a number beside a word as a multiplication and puts a `*` between them, and the inflation phrase read its amount only up to the `*` level, so it stopped at the inserted star and reported it. The same limit refused a star the reader did type: `what is $100 * 2 from 1990` was a parse error too.

The amount is now read up to, but not including, the conversion `in`, so `*` and `/` belong to it. A number with a word straight after it stands where a currency would, and is refused by that word with `INFLATION_NO_INDEX`, the code a non-money amount such as `100 kg` already answered. `100 pounds` is the weight to the engine (as `5 kg in pounds` needs it to be), so its refusal now also points at the sterling spelling.

| line | before | now |
| --- | --- | --- |
| `what is 100 apples from 1990` | Expected "from <year>" or "in <year> worth in <year>" after "what is <amount>", but found "*" | a price index adjusts money, and apples is not a currency: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100 |
| `what was 100 apples worth in 1990` | Expected "worth in", but found "*" | a price index adjusts money, and apples is not a currency: ... |
| `what is $100 * 2 from 1990` | Expected "from <year>" ..., but found "*" | $506.78 |
| `what is 100 pounds from 1990` | a price index adjusts money, and pounds is a mass: give an amount in ... | the same, then (for pounds sterling, write £100 or 100 GBP) |
| `what is 100 from 1990` | a price index measures one currency, and this amount has none: ... | unchanged |
| `what is $100 from 1990` | $253.39 | unchanged |

The boundary: the word is read as what the amount counts, so a name that holds a price is multiplied with a typed star, `what is 100 * apples from 1990`, which reads its value. A sum still needs brackets, `what is ($300 + $50) from 2003`, since the phrase reads its amount up to the first `+` or `-`. The bare `$100 from 1990`, without `what is`, is not a form the inflation page claims, and stays a parse error.

## Verification

`FoundBug_inflationAmountInWords.spec.ts` (24 tests) holds the lines above through `evaluateLine`, `parseDocument` and `evaluateDocument`, unit tests of `countedWord` (a typed star against an inserted one, a unit, a line that ends early, prototype words), `countedAmountRefusal`, `poundSterlingHint` and the `inflationCountedAmount` handler, and the adversarial sides: prototype words as the counted word, deep brackets and a long sum as the amount, every text and numeric edge as the count and the year, a price held in a name, and the document edges. The adversarial sweep gains the pound and euro spellings, an amount worked out on the line and a counted word. The interest and inflation page shows the refusal and the worked-out amount as proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`; the docs, hardening, integration, packages and bugs suites, and the fast suite. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 33,251 tests in 839 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,740 tests.
