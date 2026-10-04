---
"solve-engine": minor
---

A variable's name can be several words, `hourly rate = $50`, and the same words on a later line read as that name

A name was one word to the parser, so `hourly rate = $50` failed on `rate` while `hourly_rate = $50` worked, and people name a value the way they say it (#743).

| line | before | now |
| --- | --- | --- |
| `hourly rate = $50` | throws `Expected an operator or the end of the line, but found "rate"` | $50.00 |
| `monthly rent = $1,200` | throws `Expected an operator or the end of the line, but found "rent"` | $1,200.00 |
| `hourly rate * hours`, below `hourly rate = $50` and `hours = 8` | `Expected an operator or the end of the line, but found "rate"` | $400.00 |
| `take home = 5` | `home stored as an equation: solve with "home =>"` | refused: `"take" is a spelling of minus`, with `take_home` and `-home = 5` offered |
| `minus x = 5` | `x stored as an equation: solve with "x =>"` | refused the same way |
| `tax on = 5` | throws `Expected a value after "tax on", but found "="` | refused: `"tax on" is a phrase the engine reads` |

The words are fused into one name only on the line that defines it: two to four plain words at the start of a line, directly before its `=`. That line registers the name for the document, and from there on the same run of words reads as the name on every line below it, the longest registered name first, so `rate` and `hourly rate` can both be defined and each reads as itself. The table is scoped as user-defined units are: a batch pass starts it empty and fills it top to bottom, the incremental pass keeps each name with the line that defines it, and a change drops every compiled program, so editing or deleting the definition re-keys every reader through both passes alike. A snapshot restores the names with the variables, and the language service's references, hover and rename find every use (`ExpressionEngine.readExpressionTokens` takes the names defined above an expression as a new optional third argument, beside the units).

A would-be name holding a word the engine already reads is refused by name, since a name must never hide an operator or a phrase: an operator spelled as a word first (`take home = 5` used to be stored quietly as the equation `-home = 5`, and `plus rate = 5` as `+rate = 5`), or a fused phrase among the words (`tax on`, `hourly for`, `value of`, `sum of`). The refusal is the new code `NAME_HAS_RESERVED_WORD` and says how to write each meaning. An operator word between names (`x plus y = 10`) is left as it was.

The boundary: a run of words that no line defines stays the error it is today, and a line above the definition does not read the name yet, which is what keeps a sentence from turning into one. Words are matched as written, so `Hourly rate` is another name from `hourly rate`. A word that is a unit, a keyword or an operator is never part of a name, `:name` and `global :name` keep their one-word form, and a run longer than four words before an `=` is left alone, since that is more often a sentence. On the single-expression path a definition answers on its own and an engine keeps its names across calls as it keeps its variables; a read of words nothing has defined is the parse error it was, since nothing says the words are one name.

## Verification

`Issue743_multiWordNames.spec.ts` holds 70 tests: a definition on every path, reads below it in both document passes, the longest name first beside a shorter one and an extension of it, a redefinition, a read above the definition, case and spacing, the colon forms, a single-expression engine, prose holding a defined name, nine refused definitions and their messages, equations still stored, a name beside a phrase and a unit of several words, the four-word limit, the name meeting a check, a tag, a label, a what-if, a goal seek and a trace, references, hover and rename, a snapshot round trip, a live editor re-keyed by an edit and by a deletion (each compared with a fresh batch pass of the edited text), and a definition line that settles in as few re-runs as a one-word name. The parts are tested directly: `MultiWordNameTable` (define, match, release and settle, `withNames`, prototype words), `isNameWord`, `nameWordRun`, `definedNameWords`, both normaliser rules and `multiWordNameRefusal`. The adversarial cases add the numeric edges as the value, prototype words inside names, look-alike characters, markup-shaped words, a 5,000-word run and three hundred names in one note, CRLF and a trailing newline.

`CrossPathDocumentFeatures.spec.ts` gains the three-path shape for this form and for the lone total of #742, and `AdversarialFeatureSweep.spec.ts` gains templates for both and for negation (#751). The full suite (`npm run test:full`) passed, 24,492 of 24,496 tests in 712 suites with 4 skipped (the seven tests of `BuiltinTokenCategoryLookup.spec.ts`, which reached `main` after that run, pass on their own), as did `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords` and `lint:dispatch-size` (`executeBytecode` at 46,484 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
