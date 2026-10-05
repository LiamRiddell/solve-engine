---
"solve-engine": patch
---

Sixteen normaliser rules ask their cheapest question first, so the normaliser suite runs at its merge base's speed again, and three of them no longer read a word that names an inherited property as a trigger.

The benchmark gate measured the normaliser suite creeping to 1.23 times its merge base. Bisected by interleaving the merge base, the commit after the earlier hot-path fix, the merges since and the head, the step came with the ISO duration rule (#760): not from its own work, which turns away every word that does not open with `P`, but because it was the 97th rule, which took every rule mask from three words to four. The zone-answer merge (#757) and found-bugs batch N changed nothing the normaliser runs, and measured so.

| commit | geometric mean against the merge base |
| --- | --- |
| after the earlier hot-path fix (649fcc8) | 1.18x |
| after found-bugs batch M, with the ISO duration rule (9154c20) | 1.24x |
| before the zone-answer merge (f8b6867) | 1.24x |
| before found-bugs batch N (75d1b85) | 1.22x |
| head (277b709) | 1.22x |

Rather than take back one word of mask, the change removes what every word and number of a line paid before a rule could say no. Each rule is offered most positions of a line, and each paid something first: a word lower-cased (a new string) only to be compared with `how`, `up`, `sum`, `of` or a month name and fail; a pattern run before the token type that settles it; a closure built on every call; the engine's calendar read before it was needed; `parseInt` and `isNaN`, two globals, read before the shape. Each now asks the cheap question first:

- the weekday count, between unit, up and down, tag and section aggregate, month name date, bare rate and call fusion rules compare a word in place (`lowersTo`, which settles a word of the wrong length at once and leaves anything past ASCII to `toLowerCase()`), or lower it only when it has a capital;
- the line reference rule tests the first letter before either pattern, the address rule reads its one to three digits and a dot by character, and the large number suffix, mixed number, date literal and month name date rules look at the next token before running a pattern on this one;
- the mixed number rule builds its match in a function of the module rather than a closure per call, the month name and date literal rules read the calendar only for a date, the clock time rule reads the hour only for a clock shape, and the date offset and bare rate rules look for their connector before the unit table;
- a definition of a name of several words looks for its `=` before testing each word's letters.

| normaliser case, median of ten interleaved runs against the merge base | before | now |
| --- | --- | --- |
| `12 + 34 * (56 - 7) / 8` (noop_arithmetic) | 1.17x | 0.98x |
| `The quarterly report covers revenue and cost` (noop_prose) | 1.35x | 0.99x |
| `:v42 = 43` (assignment) | 1.19x | 0.95x |
| `2(x + 1) + 3y` (implicit_multiply) | 1.16x | 0.90x |
| `10 increase by 5%` (phrase_fusion) | 1.03x | 0.85x |
| `sha256("hi") + base64("x")` (call_fusion) | 1.11x | 1.14x |
| `120 km/h to m/s` (unit_conversion) | 1.07x | 1.00x |
| `25/12/2026 until now` (date_literal) | 0.99x | 1.04x |
| a 200-word prose line (long_prose_line) | 1.28x | 1.02x |
| a 500-line document (document_500_lines) | 1.33x | 1.09x |
| geometric mean of the ten cases | 1.16x | 0.99x |

Three answers change, on purpose. The weekday count, section aggregate and date offset rules looked a word up in a plain object, so a word naming an inherited property found `Object`'s own members:

| line | before | now |
| --- | --- | --- |
| `constructor until friday` | `Expected a value after "function Object() { [native code...", but found "friday"` | `Expected an operator or the end of the line, but found "until"` |
| `__proto__ until friday` | `Expected a value after "[object Object]", but found "friday"` | `Expected an operator or the end of the line, but found "until"` |
| `constructor of section "x"` | `startType.startsWith is not a function` | `Expected an operator or the end of the line, but found ""x""` |
| `5 days constructor 3` | `startType.startsWith is not a function` | `Expected an operator or the end of the line, but found "constructor"` |

The tables are `Map`s now, which hold only their own keys, and each line reads as `toString until friday` always did: as words with no meaning together.

The boundary: nothing else a line reads is different. Every rule that changed is run at every position of 1,429 token streams (the shared normaliser corpus, lines aimed at each rule's forms and near misses, each trigger's template filled with the prototype words and look-alike characters, and the text and numeric edges, each lexed and normalised) and gives the answer it gave at 277b709, recorded there with the streams so the comparison does not move when the lexer or another rule does. The rule mask is still four words: nothing here narrows a rule's declared shape, because a shape left too narrow makes a spelling unreachable, and the time went to the rules' own first questions instead. `call_fusion` stays about 1.1 times its merge base: the call fusion rule fires twice on that line, and the four-word mask is the larger part of what remains. Measured through `jest.bench.config.cjs` on a shared four-core container under a load average of 2 to 7, the merge base, 277b709 and this change interleaved in each round.

## Verification

`__tests__/hardening/NormaliserRulesRejectCheaply.spec.ts` (50 tests, and the oracle's recorder, skipped unless asked for) compares each changed rule with its recorded answers at each of the 5,393 positions of the oracle's streams, and each changed helper with the form it replaced: `lowersTo` against `toLowerCase() ===` with every UTF-16 code unit in every place of eight words, the shared corpora and the prototype words in four cases, and a 100,000-character word; `opensLine` against the two line patterns and `opensDottedQuad` against `/^\d{1,3}\./` over every code unit; `monthOf`, the weekday, section and connector lookups, `stepTokenAt` and `definedNameWords` against copies of the old code, with `Object.prototype` unchanged. Source checks fail on each previous form, and the lines a reader writes (`how many fridays between 01/06/2026 and 31/08/2026`, `120 up 10% then down 10%`, `1 1/2 + 2 ½`, `9:00am + 30 minutes`, `line1 + line 2`, `25/12/2026`, `192.168.1.0/24` and others) answer what they answered at 277b709.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 29,846 tests in 809 suites: 29,841 passed and 5 were skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed.

On top of main, the full suite ran 33,251 tests in 839 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,740 tests.
