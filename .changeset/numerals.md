---
"solve-engine": minor
---

Add numeral spellings: words, ordinals and Roman numerals (issues #248, #249).

The `as` converter set was binary, hex, fraction and percent. This adds the three
classic missing spellings of a number, and reads Roman numerals back. A new
`solve-numerals` package, on by default and removable.

## In words and as an ordinal

| expression | result |
| --- | --- |
| `1234 as words` | `one thousand two hundred and thirty-four` |
| `105 as words` | `one hundred and five` |
| `3 as ordinal` | `3rd` |
| `22 as ordinal` | `22nd` |
| `11 as ordinal` | `11th` |

Words use British spelling and the "and" of "one hundred and five"; a negative is
spelled with "minus", and a decimal is read digit by digit after "point".

## Roman numerals, both directions

| expression | result |
| --- | --- |
| `2024 as roman` | `MMXXIV` |
| `1994 as roman` | `MCMXCIV` |
| `"MMXXIV" from roman` | `2,024` |

The reverse takes the numeral in `"quotation marks"` rather than as a bare
`MMXXIV` literal, because the Roman letters `M C D L X V I` are already units and
variable names (`V` is the volt, `C` a temperature), so a bare literal would be
ambiguous. `from roman` is a fused phrase, so the bare `from` used by `plot` and
`clamp` is untouched.

## The boundaries

Roman numerals cover the classic range 1 to 3999. A value outside that, or a
string that is not a valid, canonical Roman numeral (`"IIII"`, `"IC"`), is
answered with a structured Error rather than a wrong number; canonicity is
checked by round-tripping the parse.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
numerals page's examples are proven live). New tests:
`packages/numerals/NumeralOps.spec.ts` and
`packages/numerals/NumeralsEngine.spec.ts`.
