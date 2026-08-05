---
"solve-engine": minor
---

Highlighting can now see phrase-fused tokens, behind `normalizeForHighlighting`.

`LanguageService` classifies at the lexer stage, which means a token type that only exists after normalization was never reachable from the highlighting path. That was documented and deliberate, but it had a consequence nobody had measured: all four token types mapped to the `datetime` category (`DATETIME_LITERAL`, `DURATION`, `VIDEO_TIMECODE`, `FRAME_COUNT`) are produced by normalizer rules, so no editor using this API has ever highlighted a date as a date. `12/09/2026` came back as number, operator, number, operator, number.

```ts
const language = new LanguageService(engine, { normalizeForHighlighting: true });
language.getSemanticTokens("12/09/2026", 1);
// one span, category "datetime", covering the whole date
```

Off by default. It is a behaviour change for anything already painting these lines, spans merge and categories move, and it costs real work per keystroke, so a host should opt into it rather than inherit it from a version bump.

What it costs, from `benchmarks/languageServiceBenchmarks.spec.ts`, median per call:

| line | lexer only | normalized |
| --- | --- | --- |
| `1 + 2 * 3` | 0.006 ms | 0.009 ms |
| `$10 + 50% of 200 - 3 kg` | 0.009 ms | 0.013 ms |
| fifty terms | 0.209 ms | 0.381 ms |
| prose | 0.031 ms | 0.038 ms |

Roughly three microseconds on a typical line, and the result is cached per line, so an edit pays it once for the line that changed.

The hard part was putting the tokens back. A fused token's `value` is its replacement rather than its source (`10 frames` becomes a `FRAME_COUNT` whose value is `10`), so `Token` gains an optional `sourceEnd` recording where the source text ended, stamped centrally by the normalizer for every one-replaces-many fusion rather than left to each rule to remember. Inserted tokens, such as the `*` implicit multiplication puts at the following token's offset, have no source text at all and are dropped rather than painted over the character that is really there.
