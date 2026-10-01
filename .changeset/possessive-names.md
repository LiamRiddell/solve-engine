---
"solve-engine": patch
---

A name of several words can hold a possessive, typed with either apostrophe: `Alice's food = £30`, then `Alice’s food * 2`

The lexer skipped a straight `'` as an unknown character, so `Alice's` was read as the name `Alice` and the unit `s` (seconds), and `Alice's food = £30` answered `Expected an operator or the end of the line, but found "food"`, though the word pattern of names of several words allows an apostrophe (#743). A straight apostrophe after a letter is now part of its word, inside it (`Alice's`, `O'Brien`) or ending it (`the Smiths' rent`), as a typographic `’` always was. A name reads either apostrophe as the straight one, since a phone or a word processor swaps one for the other unasked, so a name defined with one is read when typed with the other. A mark that only looks like an apostrophe, and an apostrophe before a word's first letter, are refused by name with a new code, `NAME_HAS_QUOTE_MARK`, rather than left to the parse error.

| line | before | now |
| --- | --- | --- |
| `Alice's food = £30` | Expected an operator or the end of the line, but found "food" | `£30.00` |
| then `Alice's food * 2` | the same parse error | `£60.00` |
| then `Alice’s food * 2` | Expected an operator or the end of the line, but found "food" | `£60.00` |
| `Alice‘s food = 3` | Expected an operator or the end of the line, but found "food" | "Alice‘s food" cannot be a name: "‘" in "Alice‘s" is a quotation mark, not an apostrophe. Write the apostrophe as ' or ’. |
| `’tis rate = 5` | Expected an operator or the end of the line, but found "rate" | "’tis rate" cannot be a name: "’tis" starts with an apostrophe, and a word in a name starts with a letter. |

The boundary: a straight apostrophe after a digit or an underscore, or before a word, is still skipped as any stray mark is, so `5'` is 5 and `'rent'` reads as the word `rent`; the closing mark of a word quoted that way is not taken for a possessive. A name of one word with a look-alike mark (`Alice‘s = 3`) is still an ordinary one-word name, since one-word names have always taken any character past ASCII. The variables page explains possessives under names of several words.

## Verification

`FoundBug_possessiveName.spec.ts` holds 81 tests: the reported line through both document passes and the single-expression path, the typographic apostrophe, either apostrophe reading the other's name, a plural possessive, two possessive names, one-word names, both refusals and their code; unit tests of `wordApostropheEnd` (inside and ending a word, after a digit, an underscore or nothing, before a digit, an underscore, a second apostrophe or another mark, a quoted word, positions that are not an apostrophe), the lexer's tokens and values, `quoteMarkInWord` (each look-alike mark, a leading apostrophe, text that is not word-shaped, prototype words), `isNameWord` and `multiWordNameRefusal`; and the adversarial cases (prototype words with `Object.prototype` unchanged, forty thousand characters of apostrophes and letters, a ten-thousand-letter word, text edges inside the possessive, markup and injection-shaped text, the modifier letter apostrophe, a typo, labels, a check, a what-if and a tag, a section and an edit, every numeric edge, CRLF, an apostrophe alone, five words). `CrossPathDocumentFeatures.spec.ts` gains possessive names through all three entry points and a live edit; `AdversarialFeatureSweep.spec.ts` gains the definition with each apostrophe and a plural possessive over the numeric edges, a name read with the other apostrophe, and the prototype-word form.

The fast suite ran 29,604 tests in 806 suites with this batch's four fixes (29,599 passed, 5 skipped, none failed), and `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the docs, hardening and integration suites (11,522 tests in 101 suites), the two lexer fuzz suites (331 tests) and the dispatch-loop size check (45,759 bytecode bytes, read with the script's own command run by hand) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
