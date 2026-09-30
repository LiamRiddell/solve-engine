---
"solve-engine": minor
---

Completions offer call words, phrases (the aggregates among them) and the units a document defines, and the eight keywords with no category now have one: `sha` offers `sha256`, `averag` offers `average of`

`LanguageService.getCompletions` offered the lexer keywords that had a highlight category, the unit table and each package's `completionItems`. The declarative call words (`sha256(`, `slugify(`, a package's `callFusions`), the registered phrases and the units a document defines never entered, and eight keywords with no category (the seven weekday names and `by`) were skipped, so words that evaluate were never offered (#771).

The static candidates now include every call word, as a function (`engine.getCallWords()` lists them), and every registered phrase, offered whole by its opening words. A phrase is also matched across the words already typed, and such a match carries the new `CompletionItem.replaceLength`, the characters before the cursor it replaces; the CodeMirror adapter turns it into an `apply` that replaces them. The units a document defines are read fresh on each call from `engine.userUnitNames()`, like variables, so a unit whose defining line is deleted is no longer offered. `SUNDAY` to `SATURDAY` and `BY` are keywords in the category map, so they are coloured and offered. A label reaching the list twice is kept once, the package's own `completionItems` entry first, so a defined function keeps its signature as its detail.

| line | before | now |
| --- | --- | --- |
| `sha` | `shade` | `sha1`, `sha256`, `sha512`, `shade` |
| `presen` | nothing | `present value of` |
| `net pres` | nothing | `net present value of` (replacing 8 characters), `present value of` |
| `weath` | nothing | `weather in` |
| `averag` | nothing | `average above`, `average of`, `average of column` |
| `4 spr`, after `1 sprint = 2 weeks` | nothing | `spread of`, `spread of column`, `sprint` |
| `frid` | nothing | `friday` |
| `doub`, with the package guide's `double` built on `callFusions` | nothing | `double` |

Each word offered evaluates: `sha256("abc")` is `= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`, `average of 10, 20, 30` is `= 20`, `net present value of -1000, 300, 400, 500 at 10%` is `= -21.04`, and `3 sprints in days` is `= 42 days`.

The boundary: a phrase is offered by its opening words, not continued part-way through from the grammar (after `net present` the service offers what starts with `present`). Hover stays a variable hover. Highlighting is unchanged by default: `sha256("abc")` still colours `sha256` as a variable unless the service is built with `normalizeForHighlighting: true`, which the highlighting guide now documents with its measured cost (about 0.003 ms a short line plain against 0.007 ms normalised on the language service benchmark). The candidate list stays bucketed by first character, and the warm completion benchmarks are within their thresholds (a short prefix 0.017 ms, a specific one 0.002 ms).

## Verification

`Issue771_completionSources.spec.ts` holds 59 tests: one per source (call words and `getCallWords`, phrases by opening words and across typed words with `replaceLength`, the cursor limiting what is read, user units, the eight keywords, every lexer keyword now categorised, the candidates offered before), the CodeMirror adapter's `apply` (the typed words replaced, an ordinary item untouched, a `replaceLength` of zero, negative, fractional or not a number ignored, one past the document's start clamped), the static list's parts (one entry per label and category, a package item winning over the same call word, a late registration, a package phrase), and the adversarial cases (prototype words as prefixes and as a unit name with `Object.prototype` unchanged, the fifty-item cap for every one-letter prefix, ten thousand defined units within a keystroke's budget, twenty thousand words before the cursor, the text edges, markup-shaped text, a unit named like a keyword, a unit whose line is deleted disappearing, a renamed unit, a typo, completions leaving answers unchanged, the cursor at a line's start, several spaces, upper case, digits, no engine). The existing language specs pass unchanged, and `languageServiceBenchmarks.spec.ts` passes its thresholds.

The fast suite ran across 682 suites (21,255 of 21,260 tests passed, 4 skipped); its one failure was the test-type baseline, run while a spec's import was half written, which passes on a rerun with the baseline at 94 errors in 30 files, none new. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, as did the proven docs examples and the hardening and integration suites. `npm run verify` and the full bundled-consumer contract (`npm run test:consumer`) were not run.
