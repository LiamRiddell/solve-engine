---
"solve-engine": patch
---

The live evaluator reads every line the way a pass from the top reads it, whatever the viewport and whichever document last used the engine, and a scroll costs the distance scrolled

Five faults in the incremental evaluator (`ThreeTierEvaluator`), found by earlier batches, shared a cause: a line ran against whatever state the lines that ran last had left, rather than the state the note has at that line.

- **A name defined below its reader.** The VM holds every name the note defines, and a pass read it as it found it, so from the second pass on `x * 2` above `x = 5` answered 10, where `parseDocument` reads the note from the top and has no `x` there. A function (`f(2)` above `f(x) = x + 1`) and a name of several words (`hourly rate * 2` above `hourly rate = 5`) did the same, and `y = x + 1` above `x = 5` stored 6 rather than the formula (the pinned case in the #732 spec).
- **A viewport starting below line 1.** The dirty lines above it were compiled without running (Tier 3), so a line in view reading one by position had nothing to read; `setViewport` on a note never evaluated did not compile them at all; and a clean definition above the viewport handed a line in view the value a later definition had left.
- **Two evaluators on one engine.** Building a second evaluator took the engine for its note, so the first one's line references read the second note's lines, and the VM, the dependency graph, the line cache and the tables of units and names were shared between them.
- **The cycle walk on the first pass of a ledger.** Each frame of the depth-first walk held its line's full list of readers, and a running total after every entry is read by every line below it, so the stack held n² / 2 numbers at once.
- **A scroll on a long note.** `setViewport` rebuilt the VM from every checkpoint above the viewport, and summed what every line above it had spent for the pass budget.

The checkpoint chain now keeps the VM at a line (`VMCheckpointer.syncTo`), and the evaluator moves it to the line above each line it runs, applying the entries passed on the way down or putting back the names written after it on the way up; the table of names of several words is limited, for the length of a pass, to the names a line above defines, and a program compiled while a name was hidden is not cached. A dirty line above the viewport runs in full. The engine counts each change of the document it serves (`documentEpoch`), and an evaluator whose engine served another since its last pass takes it back first. The cycle walk reads each line's readers one at a time (`DependencyGraph.positionReadersOf`), and the pass budget is kept in running totals by position (`PrefixSums`).

| line | before | now |
| --- | --- | --- |
| `x * 2` above `x = 5`, second pass | 10 | `Undefined variable: x` |
| `x + 1` above `:x = 5`, second pass | 6 | `Undefined variable: x` |
| `f(2)` above `f(x) = x + 1`, second pass | 3 | `Undefined function: f` |
| `hourly rate * 2` above `hourly rate = 5`, second pass | 10 | `Expected an operator or the end of the line, but found "rate"` |
| `y = x + 1` above `x = 5`, after `x = 5` is edited to `x = 6` | 6, and `y + x` below 12 | `x+1`, and `y + x` below 13 |
| `prev + 1` on line 3 of `10`, `20`, first pass of lines 3 to 5 | `Line 2 has not been evaluated yet (forward reference, or out of range)` | 21 |
| `total above` on line 5 of the same note | `Line 4 has an error` | 81 |
| `x + 100` between `:x = 1` and `:x = 99`, viewport of line 2 | 199 | 101 |
| `prev + 1` under `100`, with a second evaluator built on the engine | `Line 1 has not been evaluated yet (forward reference, or out of range)`, then 8 | 101 |
| cycle walk, first pass of a 4,000-line ledger | about 79 MB held at once | about 9 MB |
| `setViewport`, a five-line scroll, 5,000 and 20,000 lines | 2.4 ms and 11.8 ms | 0.7 ms and 1.1 ms |

Found beside them and fixed with them: a name defined twice now reads the definition above the reader in a viewport-only pass too, and a stored equation, a running total and a positional reader above the viewport agree with the batch pass.

The boundary. Tier 3 now serves the lines below the viewport (`backgroundCompile`) only, so a first pass with the viewport at the bottom of a long note runs every line above it where it used to compile most of them; the tests that pinned the old tier counts were updated to the new ones. Two evaluators taking turns on one engine pay for a full pass each time they swap, which is what a first pass costs; a host showing two notes at once gives each its own engine, as the live-editor guide says, and never pays it. A retired evaluator does not take the engine back. A value that arrives from a resolver while another document holds the engine is still re-run against whichever document the engine serves; the batcher has one checkpoint chain, and giving it one per document is a larger change than this one.

## Verification

`FoundBug_forwardReadsInTheLiveEvaluator.spec.ts` (57 tests), `FoundBug_viewportBelowLineOne.spec.ts` (38), `FoundBug_twoEvaluatorsOnOneEngine.spec.ts` (24), `FoundBug_cycleWalkMemory.spec.ts` (22) and `FoundBug_scrollCostFollowsTheViewport.spec.ts` (37) hold the reported documents on every pass, the unit tests of `syncTo`, `noteLineRan`, `resync`, `desync`, `setVisibility`, `isHidden`, `takeHidden`, `documentEpoch`, `hasAnyUncompiledDirtyLineBefore`, `positionReadersOf` and `PrefixSums` with ordinary, boundary and hostile arguments, and the adversarial cases from all three sides: prototype words as names, tags and zones, thousands of lines, look-alike and markup-shaped text, edits, structural changes, scrolls back and forth, running totals, and the numeric and document edges. `CrossPathDocumentFeatures.spec.ts` gains the three-path shape for a name defined below its reader and for a viewport below line 1, and its #743 block now compares the line above the definition in a live editor. The two `test.failing` cases in the #732 spec pass and are in the passing set; the tests that pinned the old answers (a colon name above its use, a seek over a forward read, the two-evaluator boundary, Tier 3 above the viewport) were updated to the answers a pass from the top gives.

The timings are medians of 41 scrolls on this machine, measured before and after on the same run of the same note of alternating definitions and reads; the lookups a scroll makes are now the same at 5,000 and 20,000 lines, which the scroll spec asserts. `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and `npm run test:ci` passed.
