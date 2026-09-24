---
"solve-engine": minor
---

Hosts can find, rename and follow a note's variables, and keep line references on their lines when lines move

The language service classified one line at a time and knew nothing about a note as a whole, so an editor had no way to list where a variable is used, jump to its definition, show its value, or rename it: a find and replace edits prose that shares the word. And `line 3` is an absolute number, so a line typed at the top of a note left every reference below it reading the wrong line. `LanguageService` now answers both from the engine's own reading of the note.

| call | example | result |
| --- | --- | --- |
| `findReferences` | `tax` in `:tax = 20%` / `100 + 100 * tax` / `tax is due in April` | lines 1 and 2; the prose on line 3 is not a reference |
| `getDefinition` | the `tax` on line 2 | line 1, characters 1 to 4 |
| `getHover` | the same, with the document's results | `:tax = 20%`, value 20.00% |
| `rename` | `tax` to `vat` | edits lines 1 and 2 only; line 2 still gives 120 |
| `rename` | `tax` to `pi` | refused: `RENAME_KEYWORD` |
| `shiftLineReferences` | a line inserted above `10` / `20` / `line 1 + line 2` | the edit `line 2 + line 3`; the answer stays 30 |
| `shiftLineReferences` | line 2 deleted under `line 2 * 2` | the edit `line deleted * 2`, an error that says the line was deleted |

A word is a variable only where the engine reads it as one: a line is code when it parses, and a name on it is a reference when the dependency graph reads or writes it there. The calls ask exactly that, through a new side-effect-free `ExpressionEngine.readExpressionTokens` (the real lexer, normaliser and parser, with a `label:` set aside as prose) and the graph's own `extractReadsAndWrites`, which can now report positions. Every call takes the whole document and returns positions or text edits for the host to apply; `applyTextEdits` applies them to a string. Nothing is evaluated, and nothing in the engine changes: a running total or a unit definition is recognised by its shape and never run. A unit the note defines is a unit below its definition, as it is when the note runs, so the `sprints` in `3 sprints` is never taken for a variable, even on an engine kept only for highlighting that has never evaluated the note.

A rename is refused with a named reason rather than done partly: the position is not on a variable, the variable is a `global` other documents read, the new name is not an identifier, is a keyword or a unit, is already used in the note, or would change how an edited line reads (renaming a function `f` to `sum` makes `f(3)` a different call). A line-reference shift renumbers every absolute `line N`, including a range's ends and goal seek's target, and moves a range's ends independently, as a spreadsheet does. A reference into a deleted line has no right number to become, so it is rewritten as `line deleted`, a new form that answers with the named `LINE_REFERENCE_DELETED` error in every entry point rather than silently reading whichever line moved into the gap. It compiles to the existing line-reference call, so no plugin function index moves.

The boundary: a global is found but not renamed, since one note cannot rename it in the others. `prev`, `total above` and `average above` read whatever is above them and are never rewritten, and the inserted lines themselves are left as written. A split or merge in the middle of a line has no single answer for which half is the same line, so the host describes its change as whole lines inserted or deleted. A line is read the way the batch pass reads it; the one place that differs from evaluation is a label followed by a definition (`rent: :rent = 1200`), which the equation grammar currently claims before the parser does. The hover's value is the one the host's own results hold.

## Verification

A new suite pins references, definitions and hover across labels, comments, inline solves, list items, globals, function parameters, goal seek and unit definitions; every rename refusal; renames whose answers match before and after through both document passes; insertions and deletions including ranges, glued references and refused changes; and that reading a note leaves a running total and the unit table untouched. A second suite holds `readExpressionTokens` to `tryCompileExpression` over every line the documentation shows, plus prose, half-typed lines and each statement shape, so the side-effect-free reading cannot drift from the engine's own. The cross-path suite gains the line shift through `parseDocument` and `evaluateDocument` and `line deleted` through all three entry points. The line-references page and a new reference-aware editing guide carry proven examples. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
