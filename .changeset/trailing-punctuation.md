---
"solve-engine": minor
---

An opt-in `validation.allowTrailingPunctuation` reads one `?` or `.` at the end of a complete line as the end of a sentence: `what is 5 km in miles?` answers 3.11 miles

People, and language models writing for a host, end a question with `?` and a sentence with `.`, and a line that would otherwise answer failed on its final character (#741). With the new option on, one such character after a complete expression is dropped. It is off by default, so strict parsing stays the default and a chat or tool host turns it on.

| line | off (the default) | on |
| --- | --- | --- |
| `what is 5 km in miles?` | refused at `?` | 3.11 miles |
| `what is 5+5?` | refused at `?` | 10 |
| `5 + 5?` | refused at `?` | 10 |
| `5 + 5.` | refused at `.` | 10 |
| `20% of 50?` | refused at `?` | 10 |
| `5 cm in ?` | the units a length converts to | the same |
| `5 kg + 2 m?` | mass and length cannot be added | the same |
| `5 + 5..` | refused | refused |

The check is `parser/TrailingPunctuation.ts`, consulted where the engine already tolerates a trailing `=`: only when the parser has read a complete expression and one token is left, a lone `?` or `.`, with nothing after it. It never applies after `in`, `to`, `as` or `=`, where `?` already means something, so `5 cm in ?` still lists the units a length converts to and the knowledge package still reads `= ?` as its question. A line that fails for another reason keeps its own error. It costs nothing on a line that parses whole.

The boundary: one character, at the end of the line only. A `?` inside a line, a doubled `..` or `??`, and `.?` are not touched, and a look-alike mark (a fullwidth or Arabic question mark, an ideographic full stop) is not the mark. A `.` directly after digits is read as a full stop rather than a decimal point, so a version-like `1.5.` answers 1.5 with the option on, which is why it is off by default. The embedding guide gains a section on the option.

## Verification

`Issue741_trailingPunctuation.spec.ts` holds 32 tests: each shape with the option on and off, the default, `1.5.`; `in ?` and `to ?` unchanged, `= ?` with the knowledge package registered, a trailing `=`, a line that fails for another reason, marks inside a line and doubled, a `?` inside a string, both document passes, and the semantic-token spans of a line whose last character was dropped; unit tests of `isDroppableSentenceEnd` with ordinary, boundary and hostile tokens; and the adversarial cases (prototype words, look-alike marks, a zero-width space, markup-shaped text, the numeric edges, a 2,000-term sum, ten thousand marks, CRLF). `AdversarialFeatureSweep.spec.ts` gains templates for the option. This change touches the parser's end-of-line check, which the option guards. Gates run: the full suite (`npm run test:full`) passed, 22,120 of 22,124 tests in 685 suites with 4 skipped, as did `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
