---
"solve-engine": minor
---

Named-bucket accumulators: a running balance with `+=` and `-=`.

A named variable could be assigned but not updated: each new total had to be written out in full. `+=` and `-=` turn a note into a live ledger, where every line adjusts a balance in place.

```
:budget = 500
budget -= 120    380
budget -= 63     317
budget           317
```

A first `+=` or `-=` on a name that has not been set yet starts it at zero, so a ledger can open straight into `spent += 10` rather than an undefined-variable error. The accumulation runs through the engine's own arithmetic, so money stays money and a unit stays its unit, and the right-hand side keeps its own precedence (`budget -= 1 + 2` subtracts three).

The boundary: the compound forms apply to bare names, not the colon `:name` or `global :name` grammars, and a genuine typo on the right (`total += nope`) is still a real undefined-variable error. `+=` and `-=` are punctuation, so they never shadow an ordinary word.

A running total is re-seeded on every re-evaluation, so a note that opens `spent += 10` reads the same total no matter how many times the document is re-parsed (a host re-parses on each keystroke) or the line is edited. The total is reset to its seed at the start of each pass and rebuilt from the ledger, rather than reading its own previous value and growing without bound.

## Verification

- A regression spec covers the seed-zero first use, a running balance down a document, typed (money) accumulation, right-hand-side precedence, the undefined-name and half-typed errors, and the untouched colon grammar; a lexer spec pins `+=`/`-=` and that `=+`, `=-`, `++`, `= -5` and the ASCII uncertainty `+/-` are unchanged. A further spec pins re-evaluation stability across repeated re-parses and an in-place edit, on both the batch and the incremental evaluators.
- 7,784 tests across 343 suites, no failures. `npm run verify` green.
