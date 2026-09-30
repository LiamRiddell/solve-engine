---
"solve-engine": patch
---

A name defined from one the note gives a value only later is read with that value: `y = x + 1` above `x = 5`, then `y + x`, is 11

A definition whose unknown has no value yet stores a formula, and shows it (`y = x + 1` answers `x+1`). A line below the unknown's definition read that formula unchanged and met the unknown's value in the same line, so `y + x` held `x` as 5 in one term and as an unknown in the other and answered `x+6`, which is wrong under every reading (#732). A name holding a formula is now read with the value each of its unknowns holds at the reading line, so the answer is the one the lines give in the other order.

| line | before | now |
| --- | --- | --- |
| `y = x + 1`, `x = 5`, `y + x` | `x+6` | 11 |
| `y = x + 1`, `x = 5`, `y` | `x+1` | 6 |
| `y = x + 1`, `x = 5`, `y * 2` | `(x+1)*2` | 12 |
| `y = x + 1`, `x = 5`, `z = y + x`, `z` | `x+6` | 11 |
| `y = a * 2`, `a = 3`, `y + a` | `2a+3` | 9 |
| `y = sin(x)`, `x = 5`, `y` | `sin(x)` | -0.96 |
| `y = x + 1`, `x = $5`, `y + x` | `x+6` | refused: `x` now holds money, which the formula cannot take |

The read follows a chain of formulas defined in reverse order (`y = x + 1`, `x = z * 2`, `z = 3`, then `y` is 7), to a depth of 64 names. An unknown given money, a quantity in a unit, a percentage, a date or text is refused by name, since the formula was written without that unit and adding one would be a guess; the message says to define the unknown above the line that uses it. An unknown whose definition failed passes its failure on.

The boundary: the defining line still shows its formula, as documented, and so does any line above the unknown's definition. A `=>` line keeps its unknowns symbolic, a stored equation read by a solve keeps its behaviour, and a what-if or a sweep, which rebind names, sees the rebound value. A pair of formulas that each name the other (`y = x + 1`, `x = y * 2`) has no value to give, so each stays a formula. A `global` name is read by a separate path and is not covered. One gap remains outside this change and is pinned as two `test.failing` cases: on a re-run after an edit, the live evaluator lets a line read a name that only a line below it defines, holding the value from the previous pass, so the defining line can show a number where a pass from scratch shows the formula.

The read is `vm/StoredFormula.ts`, called from the VM's variable read; `symbolic/SymbolicNode.ts` gains `substituteAll`, a single iterative walk, and its free-variable scan is iterative too, so a chain as deep as the size guard admits is rewritten rather than overflowing the native stack. The variables page gains a section on formulas defined before their unknowns, with proven examples, and the new refusal is catalogued as `SYMBOLIC_FORMULA_VALUE_UNSUPPORTED`.

## Verification

`Issue732_storedFormulaReadsLaterValues.spec.ts` holds 59 tests: the six documents from the issue through both document passes, value for value; what must not break (the defining line, a line above the definition, `=>`, the stored equation, a name defined twice); the read over functions, fractions, a complex result, a chain and a circular pair; each refusal; live edits; unit tests of `resolveStoredFormula`, `formulaCannotTake` and `substituteAll` with ordinary, boundary (zero, negative zero, 2^53, a 9,000-level chain, the depth limit) and hostile arguments; and the adversarial cases (prototype words as the unknown and the name, a 300-line reverse chain, a formula near the size limit, a zero-width name, markup-shaped text, the numeric edges, CRLF). `CrossPathDocumentFeatures.spec.ts` gains the three-path shape, and `AdversarialFeatureSweep.spec.ts` two document templates. Gates run: `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` all clean; the proven docs examples (985 tests) and the hardening and integration suites (5,918 tests) passed; and the fast suite ran 19,472 tests in 661 suites, 19,467 passing and 4 skipped, with one failure, the `Issue657_lakhGrouping.spec.ts` pin updated as described in the decimal-comma entry, which then passed on its own (73 tests). `npm run verify` and the bundled-consumer contract were not run for this change.
