---
"solve-engine": patch
---

The incremental pass agrees with the batch pass on bare assignments, `=>` lines, equation solves and markdown list markers

A live editor evaluates a note through the incremental evaluator (`ThreeTierEvaluator`, and `evaluateDocument`, which drives it for one pass), and a fresh read of the same text goes through `parseDocument`. On several ordinary forms they gave different answers, with nothing on screen to say which one was wrong.

A bare assignment (`payment = deposit * 40`), a `=>` line (`a + 1 =>`), a stored equation (`a * x = 10`) and its solve (`x =>`) are all carried out while they compile, and leave no program behind. The live evaluator re-runs a clean line by executing its program, so for these it ran nothing, and they recorded neither the names they read nor, for a bare assignment, the one it wrote. An edit above such a line left its old answer in place while a colon line beside it updated, a name assigned twice held the later value at the earlier line, and a bare definition edited away went on defining its name. Each now records what it reads, a bare assignment records its write as `:name = ...` does, and a clean line with no program that depends on anything (a name, a position or a category tag it reads, or a name it writes) goes back through the full pipeline on every pass, which is what a fresh pass does with it. It is not held back until something it reads is seen to change, because a name's value belongs to the position it is read at, and the lines that already have a program are re-run on every pass for the same reason.

Each row is a note, then one edit, then the answer the evaluator shows for the named line:

| note, then the edit | line | before | now |
| --- | --- | --- | --- |
| `deposit = 100` / `payment = deposit * 40` / `:colon = deposit * 40`, then line 1 to `deposit = 150` | `payment` | 4,000 | 6,000 |
| `x = 5` / `x + 1` / `x = 7`, then line 2 to `x + 2` | `x + 2` | 9 | 7 |
| `x = 5` / `x + 1`, then line 1 to `# heading` | `x + 1` | 6 | error: Undefined variable: x |
| `:a = 2` / `a + 1 =>`, then line 1 to `:a = 3` | `a + 1 =>` | 3 | 4 |
| `:a = 2` / `a * x = 10` / `x =>`, then line 1 to `:a = 5` | `x =>` | 5 | 2 |
| `:a = 4` / `x^2 - a = 0` / `x =>`, then line 1 to `:a = 9` | `x =>` | [-2, 2] | [-3, 3] |
| `2` / `line 1 * 2 =>`, then line 1 to `5` | `line 1 * 2 =>` | 4 | 10 |
| `:a = 1` / `expand((x + a)^2)`, then line 1 to `:a = 2` | `expand((x + a)^2)` | x^2+2x+1 | x^2+4x+4 |

In each row the answer now is the one `parseDocument` gives for the edited text, and the colon line in the first row was already 6,000.

A stored equation is kept by its unknown, apart from the line that stored it, so it outlived that line: edited away or deleted, the equation stayed, and `x =>` below went on solving it. Each equation, of either kind (the product-chain `a * x = 10` and the scalar `x^2 - a = 0`), now records the line that stored it, and goes when that line is edited, emptied or deleted, as a unit definition goes with its line. A line that still states it stores it again as it runs, and when two lines store one for the same unknown, it belongs to the later to run, so removing the other leaves it in place.

| note, then the change | line | before | now |
| --- | --- | --- | --- |
| `:a = 2` / `a * x = 10` / `x =>`, then line 2 to `# heading` | `x =>` | 5 | x |
| `:a = 2` / `a * x = 10` / `x =>`, then line 2 deleted | `x =>` | 5 | x |
| `:a = 4` / `x^2 - a = 0` / `x =>`, then line 2 to `a + 1` | `x =>` | [-2, 2] | x |

For this, `ExpressionEngine.compileExpression` takes an optional line number (the line a stored equation or a unit definition compiled out of view belongs to), and the `VM` interface gains `deleteEquation` and `deleteScalarEquation`.

A markdown list marker is markup: `- 100 * 2` is a bullet holding `100 * 2`. The batch pass has set the marker aside since 1.0.2, but the incremental pass read the whole line, so `-` became a minus and the other markers did not evaluate at all. It now reads a list line from past the marker, using the same classification the batch pass slices by, so the two cannot disagree about what counts as one. Each row sits below a line holding `20`:

| line | `parseDocument` | `evaluateDocument` before | now |
| --- | --- | --- | --- |
| `- line 1 + 1` | 21 | -19 | 21 |
| `- 100 * 2` | 200 | -200 | 200 |
| `1. 3 * 3` | 9 | error: Unexpected token after expression: "." | 9 |
| `* 5 + 5` | 10 | error: No prefix parselet found for token: STAR ("*") | 10 |
| `- [ ] 4 + 4` | 8 | error: A matrix literal cannot be empty | 8 |

A minus with no space after it is still arithmetic in both passes: `-100 + 20` is -80.

The boundary. A unit definition (`1 sprint = 2 weeks`) also has no program, but reads nothing and answers the same whatever is above it, so a clean one is not run again. A bare assignment or a `=>` line that reads a name defined only below it now takes the incremental path's tolerance of a forward reference, which the colon form already had: `y = a * 2` above `a = 3` answers `2a` on the first pass, as `parseDocument` does, and 6 once the note has run again. An equation stored below a solve is read by it the same way: in `:a = 2` / `x =>` / `a * x = 20`, the solve answers `x` on the first pass, as `parseDocument` does, and 10 once the note has run again. The single-expression path (`evaluateLine`) reads its text as an expression, not as markdown, so `- 100 * 2` is still -200 there.

Fixes #555, #560, #565 and #569.

## Verification

`CrossPathDocumentFeatures.spec.ts` gains every form in its shape: each edit or deletion through a live `ThreeTierEvaluator` matched against a fresh `parseDocument` of the edited text, both document passes agreeing value for value, and the single-expression refusal for a line reference inside a bullet and inside a `=>` line. The list-marker suite runs its table through `evaluateDocument` too, and the evaluator suite pins the tier each kind of line takes, that a clean unit definition is not run again, that a bare definition out of view does not send each scroll back to line 1, and that an equation stored out of view goes when its line is edited out of view. The differential document fuzzer's shapes gain bare assignments, `=>` lines, stored equations and their solves: on seed 1 each group reported disagreements before its fix (29, 8 and 1) and none after, and six seeds (2,400 editing sessions) report none. `npm run verify` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
