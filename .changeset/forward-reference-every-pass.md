---
"solve-engine": patch
---

A reference to a line further down is refused on every pass, as `parseDocument` refuses it

A note is read from the top, so from where line 1 stands, line 3 has not been evaluated yet, and the batch pass refuses `line 3` there. A live editor refused it on its first pass too, and from the second pass on read the answer the first pass had left line 3, so the same note showed a number in the editor and a refusal through `parseDocument`. The line-references page already says such a reference is refused, cycle or not, and that is now the answer through every entry point on every pass. The same holds for every form that reads another line's answer: a range, a section or tag total above its figures, `total by tag`, `inputs of line N`, and a goal seek whose target is below it.

| document | before, a live editor's second pass | now, every pass and `parseDocument` |
| --- | --- | --- |
| `a = line 3 * 2` / `a + 1` / `5` | 10 / 11 / 5 | Line 3 has not been evaluated yet (forward reference, or out of range), on lines 1 and 2 / 5 |
| `line 2 + 1` / `7` | 8 / 7 | Line 2 has not been evaluated yet (forward reference, or out of range) / 7 |
| `total of #a` / `1 #a` / `2 #a` | 3 / 1 / 2 | Line 2 has not been evaluated yet / 1 / 2 |
| `x = 3` / `solve line 3 for x = 10` / `x * 2` | 3 / 5 / 6 | 3 / Line 3 has no evaluated expression to solve (forward reference, out of range, or not an expression). / 6 |

The dependency on the line below is still recorded, so a cycle through a forward reference is found and reported as before; only a line on a cycle used to be refused, and the rule that decided which lines those were is no longer needed for reads. Several existing tests pinned the old tolerance of a plain forward reference in a live editor (`AnOrdinaryEditIntoAPositionalCycle`, `ACycleThroughANameReportsIt`, `PositionalReadsFollowAStructuralEdit`, `SectionAggregates`), and now assert the refusal and its agreement with the batch pass.

The boundary: a name defined with a colon further down (`x + 1` above `:x = 5`) is a different rule and still resolves in a live editor.

## Verification

`ForwardReferenceRefusedEveryPass.spec.ts` holds 19 tests: the context's `getLineResult` on its own (a line above, the line itself, a line below with an answer from the last pass, line 0, a negative line, NaN; the edge still recorded; a declared read recording nothing; a line explained on its own, which stands below the whole note, reading any line), goal seek's `getLineReads`, the reported document through `parseDocument`, `evaluateDocument` and four live passes, every cross-line form, and the adversarial cases (an insert that turns a reference forward, a cycle closed and reopened through one, a check and a what-if over one, prototype words as the name assigned, look-alike text as the line below, 2,000 forward references, edge line numbers, CRLF). `CrossPathDocumentFeatures.spec.ts` gains its three-path shape. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 18,328 of 18,332 tests in 651 suites with 4 skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:changeset` passed, as did the proven docs examples; the dispatch loop was measured by hand the way `lint:dispatch-size` measures it, at 46,042 bytecode bytes, since that script's jest run skips a worktree. `npm run verify` was not run.
