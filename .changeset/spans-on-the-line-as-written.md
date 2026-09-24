---
"solve-engine": patch
---

Semantic token spans are measured on the line as written: a quoted line and a list item colour the characters they name

A host colours the characters between a span's `from` and `to`, so a span has to be measured on the line the host handed over. On a quoted line it was not. The highlighter set the `> ` aside before tokenizing and measured every span from there, two columns short, so the colours landed on the wrong characters. A list item had the opposite fault: it was tokenized marker and all, so a bullet was coloured as a minus sign, and a `*`, `1.` or task-box marker, which does not parse as an operator, left the whole line uncoloured, although the engine evaluates each of them as the list item it is.

| line | the engine answers | coloured, before | coloured, now |
| --- | --- | --- | --- |
| `> 1 + 2` | (a quote, not evaluated) | `>` as a number, `1` as an operator, `+` as a number | `1` number, `+` operator, `2` number |
| `> total += 5` | (a quote, not evaluated) | `> tot` as a variable, `l ` as an operator, `=` as a number | `total` variable, `+=` operator, `5` number |
| `- 100 + 20` | 120 | `-` operator, `100` number, `+` operator, `20` number | `100` number, `+` operator, `20` number |
| `* 5 kg` | 5.00 kg | nothing | `5` number, `kg` unit |
| `1. 12 km` | 12.00 km | nothing | `12` number, `km` unit |
| `- [ ] total += 5` | 5 | nothing | `total` variable, `+=` operator, `5` number |
| `-100 + 20` | -80 | `-` operator, `100` number, `+` operator, `20` number | unchanged |

The lexer now starts past the marker, the way the evaluator already did for a list item, and keeps every offset and column those of the whole line. So a line behind any marker (a quote, a bullet, a numbered item, a task box, an indented or quoted list item) is coloured exactly as its content is on a line of its own, moved along by the marker, and the marker itself is left uncoloured. `Lexer.getHighlightTokens` and `getHighlightTokenObjects` measure the same way, and take the start as an optional second argument; `Lexer.highlightContentStart` says where it is.

The boundary: a quoted line is still coloured and still not evaluated, as before; this changes where its colours land, not whether the engine reads it. A minus written with no space after it (`-100`) is arithmetic, as the evaluator reads it, and keeps its colour. Colouring costs the same: over a 200-line document with quoted and list lines in it, both builds in one process, interleaved, a full pass from an empty cache took a median of 0.38 ms before and now, and 0.80 ms before and 0.79 ms now with normalized highlighting, across two runs of eleven.

Fixes #567.

## Verification

A new suite puts twelve markers in front of eleven expressions, in both highlighting modes, and requires each line to be coloured exactly as its content alone is, moved along by the marker. It pins the issue's line, the bullet that is no longer a minus, the list items that are now coloured with the answer the evaluator gives them, the known-name gate behind a marker, an inline solve inside a list item, structure that still colours nothing, and the lexer's own offsets and columns. The editor integration page says what a span is measured on and which markers are left uncoloured. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
