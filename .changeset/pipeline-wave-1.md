---
"solve-engine": minor
---

The parser pipeline is faster on the paths an editor exercises most, and it fails better. Figures are medians from the engine's own benchmark suites on one machine, before and after this release.

Lexing a line is two to three times faster. The scanner used to be a generator, and every token paid a resume plus a second pass to copy the tokens out; it now scans into an array the caller owns.

| line | before | now |
| --- | --- | --- |
| `1 + 2 * 3` | 1.10 µs | 0.40 µs |
| `$10 + 50% of 200 - 3 kg` | 1.51 µs | 0.67 µs |
| `100 km/h to m/s` | 1.83 µs | 0.71 µs |
| fifty `1+1` terms | 11.76 µs | 7.60 µs |

Scanning a whole document no longer searches the rest of the document from every prose line. The inline-solve and wikilink checks were unbounded, so a long note paid a cost proportional to its size on every line.

| document | before | now |
| --- | --- | --- |
| 1,000 lines | 11.1 ms | 9.4 ms |
| 5,000 lines | 75 ms | 35 ms |
| 10,000 lines | 220 ms | 61 ms |
| 20,000 lines | 765 ms | 129 ms |

An expression that has already been compiled is answered without lexing or normalising it again, and a line that does not parse is remembered so the next evaluation skips its front half and the throw. A line being typed does not parse for most of its life, and every re-evaluation of the document was paying for it in full.

| single evaluation | before | now |
| --- | --- | --- |
| cached expression | 3.80 µs | 1.58 µs |
| line that does not parse, repeated | 9.30 µs | 1.04 µs |

The normaliser tries fewer rules at each token position. Every rule now declares the token types it can start on, and the first pass over a document is filtered by that declaration the way later passes already were: attempts per token on a cold first pass fall from 52.7 to 14.1, and on a warm pass from 9.0 to 7.0, with the normalised stream proven identical over every example in the docs and the normaliser specs.

Parse errors now say where. Every error the parser raises carries a `span`, the offending token's or an empty span just after the last token when the line stops short, so an editor can underline the position rather than show a sentence. Codes and messages are unchanged.

```ts
try {
  engine.evaluateExpression("2 +* 3");
} catch (e) {
  (e as EngineError).span; // { start: 3, end: 4, line: 1, col: 4 }
}
```

A minus sign or an en dash pasted from a word processor or a web page now subtracts. Both were filed as unknown identifiers.

| expression | before | now |
| --- | --- | --- |
| `10 − 3` | Undefined variable | `7` |
| `10 – 3` | Undefined variable | `7` |

The em dash is deliberately not an operator: it is a sentence mark, and a line carrying one is prose.

A tokeniser fault stays on its line. An unterminated quote part way through a document used to abort the whole scan, so one half-typed line blanked every other line's result; the line now carries its error and the scan continues. Highlighting paints the tokens read before the fault instead of blanking the line.

The parser and the bytecode builder refuse what they used to truncate. An index or byte operand outside 0 to 255 throws `BYTECODE_OPERAND_OUT_OF_RANGE` instead of being written modulo 256; a jump patched outside the emitted stream is refused; numeric literals are interned, so a line that repeats one literal three hundred times uses one constant-pool slot, and `TOO_MANY_NUMERIC_CONSTANTS` now counts distinct literals; and the parser restores its nesting depth, its builder and the binding power exposed to parselets after a throw, not only on the success path.

Package registration is exact. A vocabulary (keywords, operators, units) is registered all at once, so a collision on the third keyword no longer leaves the first two behind. Each keyword, unit, operator and `callFusions` word remembers which packages claimed it: the newest claim is in force, as before, and unregistering one package hands the word back to the other rather than deleting it for both. Registering a package now clears the compiled caches, since a package can change what a line means.

Smaller corrections: a diagnostics collector sees the normaliser's fusion events on a repeated evaluation of a cached line, which the cache's early return had been skipping; the postfix `%` parselet reports the binding power the parser uses (Postfix, not Prefix); a lone `.` lexes as `DOT` rather than as a number; and the parser benchmark now times parsing (0.5 µs to 1.6 µs per line) rather than the registry construction it was measuring before (about 14 µs).

Deprecated: `buildTokenLookup` and the lookup parameter of `Lexer` and `ExpressionLexer`. The lexer never read the lookup it was handed, and the engine no longer builds one. Both stay for one more major and are removed in 3.0.
