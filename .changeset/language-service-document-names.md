---
"solve-engine": patch
---

The language service knows a document's names after every pass: completions offer `rent` after `parseDocument("rent = 1200\nrate = 5\nre")`, and a line holding only `rent` is highlighted

The language service's default `variableNameSource` read the dependency graph, and only the incremental pass (`evaluateDocument`, a live evaluator) records a plain assignment there. After `parseDocument`, `evaluateLines` or `evaluateLine` on numbered lines the graph held nothing for `rent = 1200`, so completing `re` offered no `rent` and a lone `rent` line was left uncoloured. The graph also holds every name a line merely reads, so the incremental pass offered the half-typed word itself and any undefined name a line mentioned, and a live editor went on highlighting a name after its defining line was renamed, because a line below still read it. The option's doc block said the default served any host sharing one engine, which held for one pass of the three.

The default now reads `engine.documentVariableNames()`, a new method listing the names the document's lines define that the engine still holds: variables, names of several words (`hourly rate`) and functions. Every pass fills it alike; the next document pass and `clear()` empty it; a live editor's settle of an orphaned name removes it; and a snapshot restored with `fromJSON` carries it. `engine.isDocumentVariableName(name)` answers the lone-word check without walking every name.

| after | typed | before | now |
| --- | --- | --- | --- |
| `parseDocument("rent = 1200\nrate = 5\nre")` | `re` | nothing | `rent` |
| the same | `ra` | nothing | `rate` |
| the same | a line of only `rent` | not highlighted | highlighted |
| `evaluateLines` of the same lines | `re` | nothing | `rent` |
| `evaluateLine(1, "rent = 1200")`, `evaluateLine(2, "rate = 5")` | `r` | nothing | `rate`, `rent` |
| `evaluateDocument` of the same document | `re` | `re`, `rent` | `rent` |
| `evaluateDocument` of `broken = undefinedthing + 1` | `undef` | `undefinedthing` | nothing |
| a live editor over `rent = 1200`, `rate = 5`, `rent + rate`, line 1 renamed `rental` | a line of only `rent` | highlighted | not highlighted |

The boundary: a name set outside a document (`evaluateExpression(":x = 5")`) is still not offered, since it is the host's and not the note's, and a name only read is no longer offered by any pass. The graph is not read at all, so nothing here builds a snapshot of its positional edges (the cost #733 removed). A host whose language service sits on a separate, non-evaluating engine still passes `variableNameSource`, now most simply as `() => evaluatingEngine.documentVariableNames()`; the playground's own source still reads a graph snapshot and is unchanged. The editor-integration guide gains a section on the document's names, and the package guide on highlighting and completions points to it.

## Verification

`FoundBug_languageServiceNamesAfterEveryPass.spec.ts` holds 135 tests: the document that exposed it through `parseDocument`, `evaluateLines`, `evaluateDocument` and a live editor, `evaluateLine` on numbered lines, and `evaluateExpression` still offering nothing; the same names and the same completion list from every pass for a note holding variables, a name of two words, a global, a function, a failing line and a running total; unit tests of `documentVariableNames` (none on a fresh engine or an empty note, order and redefinition, case kept, a fresh iterator per call, `clear()`, the next document pass, a host's own name) and of `isDocumentVariableName` (names held and not, the empty string, a leading space, the first word of a two-word name, and every prototype word); a live editor's rename, deletion, rename back and two hundred renames; a snapshot round trip; the service with no engine, with a host's own source, and over a second engine's names. The adversarial cases: every prototype word as a variable name offered and highlighted with `Object.prototype` unchanged, `constructor = 5` then `con`, five thousand names within a keystroke's budget, a long name and a line past the length limit, a Cyrillic look-alike, a zero-width space, markup-shaped names, a typo, a failing line, a what-if, a check and a tag, completions leaving answers unchanged, every document edge agreeing across both passes, CRLF, the text edges typed as a prefix, and names holding zero, negative zero, 2^53, the largest double and a division by zero. `CrossPathDocumentFeatures.spec.ts` gains the names as a whole-document read: both passes giving the same completions and lone-word answers, a live rename agreeing with a fresh pass, the single-expression path offering nothing, and the worker's completions after its `parseDocument` and its `evaluateDocument`.

The fast suite ran across 812 suites (30,222 of 30,228 tests passed, 5 skipped); its one failure was `Issue761_evaluatorSeams.spec.ts` asking for `isDocumentVariableName` on a docs page, which the editor-integration guide now names, and that spec then passed with the docs examples (1,403 tests). `npm run typecheck`, `typecheck:tests` (92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:changeset`, `lint:links`, `lint:error-codes`, `lint:cheatsheet` and `lint:sidebar` passed, as did the hardening, integration and language suites, `CompletionBucketsSortedOnce.spec.ts` and `Issue771_completionSources.spec.ts`. The language-service benchmark passes its thresholds, and over 500 names the incremental pass defined, a completion takes about 0.12 ms as before and a lone-word check about 0.0005 ms against 0.029 ms. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 33,251 tests in 839 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,740 tests.
