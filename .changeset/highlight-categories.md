---
"solve-engine": patch
---

Highlighting colours the conversion words alike, leaves a label uncoloured, and keeps a clock time's colon with its number

`getSemanticTokens` coloured the same conversion word differently from one line to the next, painted a line's label as a variable the line reads, and painted the colon of a clock time as a variable's sigil.

| line | word | before | now |
| --- | --- | --- | --- |
| `12 kg to lb` | `to` | unit | keyword |
| `5 km in miles` | `in` | comparison | keyword |
| `Total: 1 + 2` | `Total`, `:` | variable, variable | uncoloured |
| `12:30 + 1` | `:` | variable | number |

A label is found the way the engine finds it, through the same reader the reference-aware editing uses, and only on a line with a colon past its first character, so an ordinary line costs nothing more to highlight. A definition's own colon after a label (`rent: :rent = 1200`) is still the sigil.

The boundary: only the category of these spans changes; which spans are coloured on any other line is unchanged.

Fixes #576.

## Verification

A new spec pins each case, and the category map spec now asserts the conversion words as keywords. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
