---
"solve-engine": patch
---

Text is counted and reversed by the characters a reader sees

`length of`, `characters in` and `reverse` worked on Unicode code points, so a character built from several code points counted as several and could be split in two. A thumbs-up with a skin tone is the thumb and a tone modifier, a flag is two regional-indicator symbols, and an accent can be a combining mark after its letter. Each now counts as the one character it looks like, and `reverse` keeps each whole.

| expression | before | now |
| --- | --- | --- |
| `characters in "👍🏽"` | 2 | 1 |
| `length of "🇬🇧"` | 2 | 1 |
| `length of "👨‍👩‍👧"` | 5 | 1 |
| `reverse "👍🏽a"` | a🏽👍 | a👍🏽 |
| `reverse "🇬🇧🇫🇷"` | 🇷🇫🇧🇬 | 🇫🇷🇬🇧 |

The text page promised this already ("an accent or an emoji counts as the one character it looks like"), and that was true only of an emoji that is a single code point.

The boundary: the characters are grapheme clusters as the runtime's `Intl.Segmenter` finds them, which every current browser and Node.js provide. The segmenter is built on first use rather than when the package loads. On a runtime without one, counting falls back to code points, as before, which still keeps a surrogate pair together. Words and lines are counted as they were.

## Verification

New tests pin each count and reversal above, and a separate suite removes `Intl.Segmenter` to pin the code-point fallback. The text operations page gains proven examples. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
