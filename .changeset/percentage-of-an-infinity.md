---
"solve-engine": patch
---

A percentage of a number too large to hold says it is too large, so `2^2000 as %` is no longer told it "is what dividing by zero gives"

`2^2000` and a typed `1e309` are past about 1.8e308, the largest number a double holds, so each is held as an infinity, and `2^2000 as %` was refused with `PERCENTAGE_NOT_FINITE`: "its value is not a finite number, which is what dividing by zero gives". Nothing was divided. The double cannot tell that infinity from the one `1/0` gives, so the division itself now records it: the VM's `/` marks an infinity a zero divisor gave, and `+`, `-`, `*`, `^` and a minus sign in front carry the mark. A percentage then gives the reason that fits: a division by zero keeps its message, a value that is no number at all (an infinity less an infinity) says that, and any other infinity is too large, under `PERCENTAGE_OVERFLOW`, the code a finite number too large for its percentage (`1e308 as %`) already takes.

| line | before | now |
| --- | --- | --- |
| `2^2000 as %` | This has no percentage: its value is not a finite number, which is what dividing by zero gives. | This is too large to write as a percentage: the number is past about 1.8e308, the largest number that can be held. |
| `1e309 as %` | the division message | the same too-large refusal |
| `50% + 2^2000` | the too-large message for a percentage a hundred times over | the same too-large refusal |
| `1/0 as %` | the division message | the division message |
| `40 is what % off 0` | the division message | the division message |
| `(1/0 - 1/0) as %` | the division message | This has no percentage: its value is not a number at all, as an infinity less an infinity is not. |
| `0/0 as %` | `QUOTIENT_UNDEFINED` | `QUOTIENT_UNDEFINED` |

The boundary: the mark is the only witness of a division by zero, so an infinity carried through a step that does not keep it, such as a function (`abs(1/0) as %`), is read as a number too large to hold. A program embedding the engine that tests `toPercentage` on a bare infinity it built itself now gets `PERCENTAGE_OVERFLOW`; one built by a division, or marked through `Value.divisionByZero`, gets `PERCENTAGE_NOT_FINITE`, as before. The percentages page explains both refusals under "A number as a percentage".

## Verification

`FoundBug_percentageOfAnInfinity.spec.ts` holds 34 tests: each too-large line and each division line, a value that is no number, the forms that must not change and the boundary; unit tests of `percentageRefusal` (each reason, either infinity, a marked NaN, a whole number written with `n`, text), of the three messages, of `zeroDivisorQuotient` and `infiniteResult`, of `exactIntegerArithmetic` carrying the mark, of an arena recycle clearing it and a clone keeping it; and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum, deep brackets, a huge power, text edges and look-alike digits, variables holding each infinity with a what-if and a check through both document passes, and every numeric edge over zero and to a huge power). `FoundBug_percentageOverflow.spec.ts` and `Issue633_percentOnThePartsPerScale.spec.ts` pinned the old reason for an unmarked infinity and now pin the new one. `AdversarialFeatureSweep.spec.ts` gains `(X) / 0 as %`.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. `npm run verify` as one command and the benchmarks were not run; the change adds one comparison to the plain division path, and nothing to the others.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
