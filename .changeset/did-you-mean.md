---
"solve-engine": minor
---

An unknown name says which real names it is close to

A mistyped variable, function or unit used to be reported bare, `Undefined variable: kilomters`, and a conversion to a word that is not a unit was reported as two units that measure different things. The error now names the nearest real names, so a typo is one glance from fixed. Nothing is ever corrected on the reader's behalf: the line stays an error, in keeping with the rule that a spelling that is not a unit is never resolved to the nearest thing that looks similar.

| expression | before | now |
| --- | --- | --- |
| `20 kilomters in miles` | Undefined variable: kilomters | Undefined variable: kilomters. Did you mean kilometers? |
| `sqr(16)` | Undefined function: sqr | Undefined function: sqr. Did you mean sqrt? |
| `budgte * 2` (with `budget` defined) | Undefined variable: budgte | Undefined variable: budgte. Did you mean budget? |
| `sine(1)` | Undefined function: sine | Undefined function: sine. Did you mean sin, sind or sinh? |
| `5 km in mies` | Cannot convert km to mies: they do not measure the same thing | "mies" is not a unit. Did you mean miles? |

The candidates come from the engine's own vocabulary: the builtin functions, the note's own functions and variables, and every unit spelling, so a package's units are suggested without the package doing anything. Closeness is the edit distance with adjacent transpositions, compared without case, allowing one edit up to five letters, two up to nine and three beyond. Names equally close are all listed, up to three.

For a host, the candidates travel on the thrown `EngineError` as `suggestion` (a comma-separated list) and `context.didYouMean` (an array), ready for a one-click fix; a document line carries the sentence in its error text. A target that is not a unit comes back as an `UNKNOWN_UNIT` error value.

The boundary: a short word gets no suggestion, since the unit table holds thousands of short spellings and nearly every short word is an edit or two from one of them. The floor is three letters for a function name, so `sqr` still finds `sqrt`, and four for a variable, whose candidates include every unit. Four or more equally close names get none, since listing them all would not help. The suggestion does not yet carry a source span; a host locates the named word in the line. In a document with more than 500 variables, which a written note does not reach, an unknown name is compared with the units alone: comparing it with every variable made a long generated document take time growing with the square of its length. The unit table is searched through an index built once, and an unknown word's search is remembered, so a line that stays wrong costs nothing extra on the next pass.

## Verification

A new suite pins the distance, the ties and the thresholds, the sentence, each of the error forms above including a user-defined function and a variable from earlier in the note, and the mismatch that is still a mismatch. The unit arithmetic and variables pages gain proven examples, and the TypeScript guide shows the fields a host reads. `npm run verify:ci` passes: 9,807 tests across 496 suites, with the bundled-consumer contract.
