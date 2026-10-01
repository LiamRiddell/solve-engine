---
"solve-engine": patch
---

A line the engine cannot read says so in the reader's terms, names what it expected, and suggests the next step (#768)

When a line cannot be read at all (a parse error: an operator with nothing after it, a bracket never closed), the engine throws an error with a message for the reader. Those messages named the parser's internals: a token type (`GT`, `STAR`, `LINE_REF`), which is the parser's name for a kind of symbol and means nothing to a person, and in one case a value the reader never typed, a time already turned into minutes. None of them set `suggestion`, the field an `EngineError` has for the obvious next step.

Each message now names what the reader typed, in quotes, and what the engine expected there, and sets `suggestion` wherever there is an obvious next step. Every code is unchanged: a host branches on the code, and the message is for the reader.

| line | before | now: `message` | now: `suggestion` |
| --- | --- | --- | --- |
| `2 + * 3` | `No prefix parselet found for token: STAR ("*")` | `Expected a value after "+", but found "*"` | `Write a value between "+" and "*", or remove one of them` |
| `(5 km) -> miles` | `No prefix parselet found for token: GT (">")` | `Expected a value after "-", but found ">"` | `"->" is not a conversion here; to convert, write "in miles"` |
| `3 ** 2` | `No prefix parselet found for token: STAR ("*")` | `Expected a value after "*", but found "*"` | `Write a power with "^", as in 2 ^ 3` |
| `round(3.14159, )` | `No prefix parselet found for token: RPAREN (")")` | `Expected a value after ",", but found ")"` | `Write a value after the ",", or remove the ","` |
| `5 +` | `Unexpected end of input` | `The line ends after "+", where a value was expected` | `Write a value after "+"` |
| `(2 + 3` | `Unexpected end of input` | `The line ends where ")" was expected` | `Close the bracket with ")"` |
| `sqrt(` | `Unexpected end of input` | `The line ends after "(", where a value was expected` | `Write a value after "(", then close the bracket with ")"` |
| `[1, 2` | `Unexpected end of input` | `The line ends where "]" was expected` | `Close the bracket with "]"` |
| `1,5 + 1` | `Unexpected token after expression: ","` | `Expected an operator or the end of the line, but found ","` | `Write a decimal with a point, as in 1.5; a comma separates the items of a list` |
| `x := 5` | `Unexpected token after expression: ":"` | `Expected an operator or the end of the line, but found ":"` | `Assign with "=" on its own` |
| `roll 1d6` | `Expected token type "MINUS" but got "STAR" ("*")` | `Expected "-" between the two ends of the range, but found "d6"` | `Write the range as roll 1-6, roll(1, 6) or roll between 1 and 6` |

The same reading reaches the other parse failures: a phrase missing one of its words (`roll between 1 6` says `Expected "and", but found "6"`), a function definition with a number where a parameter goes (`f(1) = 2` says `Expected a parameter name, but found "1"`), and a variable named with a word the engine already reads (`:gcd = 4` says `"gcd" is a word the engine already reads, so it cannot name a variable`). The span on each error covers the characters at fault, so an editor can underline them; for a line that ends too soon it is an empty span just after the last character, where the caret goes.

A quoted token is what the reader typed, cut to 32 characters and an ellipsis, and a character that cannot be seen (a zero-width space, a direction override, a control character, half of a broken surrogate pair) is written as its code point, `<U+202E>`, so a message cannot be made to read as something else. A suggestion never repeats a result-shaped piece of the line (the `= 99` of `1,5 = 99`, the `42` of `5 -> 42`), so it cannot be mistaken for an answer.

The boundary: this rewords messages and adds suggestions; it does not make any of these lines evaluate. `->` as a conversion is not read, and no suggestion is offered where there is no obvious next step. A message is for reading and may be reworded again in a patch release, as [versioning and support](/guide/versioning-and-support/) says; a host that needs to tell failures apart reads the code. Package parselets outside this repository keep whatever messages their authors wrote.

## Verification

`Issue768_parseMessagesInReadersTerms.spec.ts` holds 48 tests. The wording helpers in `parser/ParseMessages.ts` are tested on their own with ordinary tokens, the end of the line, a long token cut to its limit, and invisible characters and lone surrogates. The issue's lines are checked table by table: no message uses a token type name as a word of its own, and each carries its suggestion and a span on the characters at fault. The adversarial cases are a 10,000-character line that fails at its end (the message stays bounded), prototype words and the shared text edges as the failing token, control characters, direction overrides and a lone surrogate, which never reach a message raw, and suggestions that never echo a result-shaped piece of the line. Twelve existing specs that asserted the old wording were updated to the new text; their codes and outcomes are unchanged.

`npm run test:ci` passed, 16,075 of 16,079 tests in 621 suites with 4 skipped, with `npm run typecheck`, `lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:ci-parity` and `lint:error-codes`. `npm run verify:ci` and the bundled-consumer contract were not run for this change.
