---
"solve-engine": patch
---

A value that is not zero never prints as one

Two decimal places is the right budget for almost everything the engine answers,
and wrong for the answers that live below it. A conversion can land several
orders of magnitude down, and `0.00 MHz` cannot be told apart from a real zero.

| expression | before | now |
| --- | --- | --- |
| `1 Hz in MHz` | `0.00 MHz` | `1e-6 MHz` |
| `1 byte in GB` | `0.00 GB` | `1e-9 GB` |
| `1 g in tonnes` | `0.00 tonnes` | `1e-6 tonnes` |
| `1 second in years` | `0.00 years` | `3.17e-8 years` |
| `0.001 km` | `0.00 km` | `0.001 km` |
| `1/1000000` | `0.00` | `1e-6` |

A magnitude that would round away is shown to three significant digits instead:
as a decimal while the zeros are still countable, and in exponent form once they
are not. Three digits rather than everything the double holds, because a
conversion is not more precise than what went into it.

Money is the exception, because a currency zero is a real answer rather than a
rounding artefact. A tenth of a penny is not a payable amount, so `$0.001` is
`$0.00` and stays that way. So does a genuine `0 kg`, and so does every value
that already rendered legibly.

Fixed in the same pass, since it is the same display path: **`to N dp` is now
obeyed on a quantity.** `1.23456 km to 4 dp` was answering `1.23 km`, the
setting's two places, because a quantity's own place count was never read the way
a plain number's already was. It now answers `1.2346 km`, and `5 km to 0 dp` is
`5 km`. An explicit place count also beats the display floor in both directions,
because a line that names its precision has said what it wants.

[Decimals](https://liamriddell.github.io/solve-engine/syntax/decimals/) gains
proven sections for both, and documents `as scientific`, which was the existing
escape hatch and was written down nowhere.

Five pinned strings move with this: `12/25/2026` read as division under the
`onAmbiguous: 'arithmetic'` opt-out now reads `0.000237` rather than `0.00`. The
arithmetic is unchanged; it is the same division, now legible.
