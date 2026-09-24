---
"solve-engine": patch
---

The incremental pass agrees with the batch pass on bare assignments and on markdown list markers

A live editor evaluates a note through the incremental evaluator (`ThreeTierEvaluator`, and `evaluateDocument`, which drives it for one pass), and a fresh read of the same text goes through `parseDocument`. On two ordinary forms they gave different answers, with nothing on screen to say which one was wrong.

A bare assignment (`payment = deposit * 40`) is carried out while it compiles and leaves no program behind, and it recorded neither the names it read nor the one it wrote. The live evaluator re-runs a clean line by executing its program, so for such a line it ran nothing: an edit above it left its old answer in place while the colon form beside it updated, a name assigned twice held the later value at the earlier line, and a bare definition edited away went on defining its name. It now records what it reads and writes, as `:name = ...` does, and a clean line that defines a name with no program goes back through the full pipeline, which is what a fresh pass does with it.

Each row is a note, then one edit, then the answer the evaluator shows for the named line:

| note, then the edit | line | before | now |
| --- | --- | --- | --- |
| `deposit = 100` / `payment = deposit * 40` / `:colon = deposit * 40`, then line 1 to `deposit = 150` | `payment` | 4,000 | 6,000 |
| `x = 5` / `x + 1` / `x = 7`, then line 2 to `x + 2` | `x + 2` | 9 | 7 |
| `x = 5` / `x + 1`, then line 1 to `# heading` | `x + 1` | 6 | error: Undefined variable: x |

In each row the answer now is the one `parseDocument` gives for the edited text, and the colon line in the first row was already 6,000.

A markdown list marker is markup: `- 100 * 2` is a bullet holding `100 * 2`. The batch pass has set the marker aside since 1.0.2, but the incremental pass read the whole line, so `-` became a minus and the other markers did not evaluate at all. It now reads a list line from past the marker, using the same classification the batch pass slices by, so the two cannot disagree about what counts as one. Each row sits below a line holding `20`:

| line | `parseDocument` | `evaluateDocument` before | now |
| --- | --- | --- | --- |
| `- line 1 + 1` | 21 | -19 | 21 |
| `- 100 * 2` | 200 | -200 | 200 |
| `1. 3 * 3` | 9 | error: Unexpected token after expression: "." | 9 |
| `* 5 + 5` | 10 | error: No prefix parselet found for token: STAR ("*") | 10 |
| `- [ ] 4 + 4` | 8 | error: A matrix literal cannot be empty | 8 |

A minus with no space after it is still arithmetic in both passes: `-100 + 20` is -80.

The boundary. A bare assignment that reads a name defined only below it now takes the incremental path's tolerance of a forward reference, which the colon form already had: `y = a * 2` above `a = 3` answers `2a` on the first pass, as `parseDocument` does, and 6 once the note has run again. The single-expression path (`evaluateLine`) reads its text as an expression, not as markdown, so `- 100 * 2` is still -200 there. A `=>` line (`a + 1 =>`, or `x =>` solving a stored equation) also has no program, but defines nothing, and is not re-run by this change: after an edit above it, the live evaluator still shows its earlier answer until the line itself is edited. Whether every such line runs on every pass is a separate question from a definition's, and is left open.

Fixes #555 and #560.

## Verification

`CrossPathDocumentFeatures.spec.ts` gains both forms in its shape: each edit case through a live `ThreeTierEvaluator` matched against a fresh `parseDocument` of the edited text, both document passes agreeing value for value, and the single-expression refusal for a line reference inside a bullet. The list-marker suite runs its table through `evaluateDocument` too, and the evaluator suite pins the tier a clean bare assignment takes and that one out of view does not send each scroll back to line 1. The differential document fuzzer's shapes gain bare assignments: seed 1 reported 29 disagreements before the fix and none after, and six seeds (2,400 editing sessions) report none. `npm run verify` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
