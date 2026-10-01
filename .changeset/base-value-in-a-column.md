---
"solve-engine": patch
---

A number written in a base is a figure in a column, so `total above` adds `255 in hex` as 255 instead of refusing it

`in hex`, `as binary` and `in octal` change how a number is written, not what it is, but the span aggregates took a plain number or a quantity and refused every other kind, so a number shown in a base was refused as "not a plain number or unit value". `total above`, `sum above`, `average above`, `count`, `min`, `max` and `median above`, a line range (`sum(line 1 : line 3)`), a section total and a tag total or breakdown now read such a line as the number it is, exact past 2^53 as the number in the base is. The total is a plain decimal number, since the lines above can be in different bases, and `total above in hex` writes it in one.

| document | line | before | now |
| --- | --- | --- | --- |
| `255 in hex`, `0b1010 as binary`, `5` | `total above` | Line 1 is not a plain number or unit value, so it cannot be included in an "above" aggregation | `270` |
| the same | `total above in hex` | the same refusal | `0x10E` |
| the same | `average above` | the same refusal | `90` |
| `255 in hex`, `1` | `sum(line 1 : line 2)` | Line 1 is not a plain number or unit value, so it cannot be included in a sum, total or average range | `256` |
| `255 in hex #a`, `10 #a` | `total of #a` | Line 1, tagged #a, is not a plain number or unit value. | `265` |
| `"x"`, `1` | `total above` | refused | refused |

The boundary: a column total reads a whole number past 2^53 as the nearest ordinary number, as it does when the same number is written in decimal, so a base adds no digits a total would not otherwise keep. Text, a date and the other values with no single number are refused as before. The number bases page shows a column in mixed bases and which form its total takes, and the line references page points to it.

## Verification

`FoundBug_baseValueInAColumn.spec.ts` holds 9 tests: every above aggregate, a range, a section, a tag total and a breakdown over numbers in bases, each through both document passes, and the forms that must not change; unit tests of `numberOfBase` (a number in a base, a plain number and a length passed through, zero, a negative, a value past 2^53 kept exact, one past the largest double, sources kept, and text and a big integer passed through); and the adversarial cases (prototype words as a variable, a heading and a tag with `Object.prototype` unchanged, a thousand-line column, a 4,000-bit value, text edges, the aggregate without a document, a base from a variable with a check and a what-if, and every numeric edge in a base in a column). `CrossPathDocumentFeatures.spec.ts` gains the three-path shape: the document result, the agreement of the batch and incremental passes, and the single-line refusal of `255 in hex + total above`. `AdversarialFeatureSweep.spec.ts` gains two document forms over the numeric edges.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed. `npm run verify` as one command and the benchmarks were not run.
