---
"solve-engine": minor
---

The everyday spellings of the list aggregates are read: `sum of`, `mean of`, `min of`, `max of`, `product of`, the calls `sum(1, 2, 3)` and `mean(...)`, and `count above`, `max above` and the rest

The engine had `total of`, `average of`, `median of`, `total above`, `sum above` and `average above`, but not the neighbouring spellings a spreadsheet or another notepad uses, and each failed with a parser message (#703).

| line | before | now |
| --- | --- | --- |
| `sum of 1, 2, 3` | throws `Unexpected token after expression: ","` | 6 |
| `max of 1, 2, 3` | throws `Expected token type "LPAREN" but got "OF" ("of")` | 3 |
| `product of 2, 3 and 4` | throws `Unexpected token after expression: ","` | 24 |
| `sum(1, 2, 3)` | throws `Expected token type "RPAREN" but got "COMMA" (",")` | 6 |
| `mean(1, 2, 3)` | throws `Undefined function: mean` | 2 |
| `max above`, after lines of 10, 20 and 30 | `Expected token type "LPAREN" but got "IDENT" ("above")` | 30 |

The list phrases: `sum of` is `total of`, `mean of` and `avg of` are `average of`, and `min of`, `max of` and `product of` give the least value, the greatest and the values multiplied together. Units work as they do for the other lists (`product of 2 m, 3 m` is `6.00 m²`), and mixed measures are refused by name.

The calls: `sum(...)`, `total(...)`, `average(...)`, `mean(...)`, `median(...)` and `stdev(...)` over plain values. `stdev(...)` is the population standard deviation, the same as `stdev of` in this engine; a spreadsheet's `STDEV` is the sample form, written `sample stdev of`.

The block above: `avg above` and `mean above` for the average, and `count above`, `min above`, `max above` and `median above`. Each walks the block as `total above` does, passing over comments and subtotals, and each is a summary line itself, so the next one reads past it.

The boundary: the calls keep the readings the same brackets already had. `sum(x, [10, 20, 30])` and `sum(10*x, 0:9)` are still map-reduce (a two-argument `sum` whose first argument is a bare name, or whose second is a list, a range or a name), and `average(line 1 : line 4)` is still a line range. `mean`, `median` and `stdev` stay ordinary names wherever no bracket follows them (`mean = 4` is a variable); a function of one's own under one of those three names is refused by name, since the call would never reach it, and an empty call such as `mean()` is refused rather than answered 0. `min` stays the minute and `max(...)` the function; each is claimed as a phrase only before `of` or `above`. The statistics and line-references pages gain proven examples.

## Verification

`Issue703_aggregateSpellings.spec.ts` holds 42 tests. Each list spelling gives the answer of the form it mirrors, with money and units in the unit written first, mixed measures refused, and `min` and `max` keeping their other meanings where no `of` follows. Each call gives its answer, `stdev(...)` agrees with `stdev of`, map-reduce keeps `sum(x, [10, 20, 30])`, `sum(10*x, 0:9)` and `sum(x, 0:3)`, a line range keeps its call, `mean` and `median` stay names without a bracket, and an empty call and a function of one's own under these names are refused by name. Each `above` form reads its block in both document passes, is a summary line the next one reads past, leaves a subtotal out, keeps units and refuses mixed measures, and stops at a blank line and a heading as `total above` does. The adversarial cases: prototype words as calls and phrases, an unclosed call, and sixty values. `CrossPathDocumentFeatures.spec.ts` holds the cross-path case for the new `above` forms: the block in both passes, an edit reaching each in a live editor, and the single-expression refusal.

The full suite (`npm run test:full`) passed, 15,825 of 15,829 tests in 617 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,888 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,404 documented examples). `executeBytecode` is unchanged at 47,528 bytecode bytes on Node 24.16.0.
