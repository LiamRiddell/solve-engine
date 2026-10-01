---
"solve-engine": patch
---

A name, number or unit that holds an invisible direction control is refused by name, with the character written as its code point

The lexer reads every character past ASCII as part of a word, and the dozen characters that only say which way text runs (the marks U+200E, U+200F and U+061C, the embeddings and overrides U+202A to U+202E, and the isolates U+2066 to U+2069) are not drawn. So `rent = 5` with a right-to-left override in front of the name defined a variable stored as that override followed by `rent`, in both document passes, and a later line spelled the same way read it back: a name shown as one thing and stored as another, the shape of the "Trojan Source" attack. Nothing between the lexer and the variable store asked what the character was (found bug, no issue).

A word holding one of these characters is now refused with `DIRECTION_CONTROL_IN_NAME` wherever the engine would read it as a name, a number or a unit: a bare, colon, running-total or several-word definition, a function or unit definition, a read, a tag, and a line ending in `frozen`. The message names the character by its code point and its Unicode name. A line that has the shape of a definition is matched without being run, so nothing is stored under the hidden spelling, and the dependency graph, the completions and the highlighting never hold it. `readExpressionTokens` agrees with compiling about such a line. The Arabic letter mark (U+061C) is now written as its code point in every parse message, as the other direction controls already were.

| line | before | now |
| --- | --- | --- |
| `<U+202E>rent = 5` | `5`, stored under the hidden spelling | `"<U+202E>rent" holds U+202E (right-to-left override), an invisible character that changes the direction text is shown in, so it would not read as what it is. A name, a number or a unit cannot hold one: delete it and type the word again.` |
| `rent = 5`, then `<U+202E>rent` | `Undefined variable: <U+202E>rent. Did you mean rent?` | the same refusal, naming `"<U+202E>rent"` |
| `5<U+202E>0` | `Undefined variable: <U+202E>0` | the refusal, naming `"<U+202E>0"` |
| `x<U+200F> = 4` | `4` | the refusal, naming U+200F (right-to-left mark) |
| `"a<U+202E>b"` | `a<U+202E>b` | `a<U+202E>b` (unchanged) |
| `Rent<U+202E>: $5` | `$5.00` | `$5.00` (unchanged) |

The boundary: text keeps these characters, since a right-to-left script needs them to show correctly and nothing is looked up by them. Text in quotes, a comment, a heading, the label before a colon and a prose line are read as before, and a prose line that is refused before it reaches the character (`Prose about <U+202E> things`) keeps its own message, so the rule adds no error to a sentence. The characters are refused rather than dropped, because dropping one silently would leave a line showing one thing while the engine read another. A name written in Arabic or Hebrew letters with no control inside it is an ordinary name. The other invisibles keep their readings: a zero-width space still separates words, and a zero-width joiner still holds an emoji together.

## Verification

`FoundBug_directionControlInAName.spec.ts` holds 46 tests: the refusal for each of the twelve characters through `evaluateLine`, `parseDocument` and `evaluateDocument`, every way of defining a name, numbers, units, text, comments, headings, labels and prose, the language service's completions, highlighting and `readExpressionTokens`, unit tests of `isDirectionControl`, `hasDirectionControl`, `describeDirectionControl`, `findHiddenDirections`, `directionControlRefusal`, `hiddenDirectionToRefuse`, `safeText` and `extractReadsAndWrites`, and adversarial cases from the kit (prototype words, sized input, look-alike and markup-shaped text, a check, a what-if, a tag, a section, a trace, an edit, a cached failure, CRLF and the numeric edges). The variables page has a proven example.

`FoundBug_internalNamesInRefusals.spec.ts` pinned `<U+202E>foo + 1` as `Undefined variable: <U+202E>foo`, the old reading; it now expects the refusal.

Gates run: `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:changeset`, `lint:cheatsheet`, `lint:sidebar`; the docs, hardening, integration, errors, lexer, normaliser and language suites passed. The fast suite ran 31,107 tests in 818 suites: 31,101 passed, 5 were skipped, and the one failure was the pinned line above, updated and passing since. `npm run verify` and the bundled-consumer contract were not run.
