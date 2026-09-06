---
"solve-engine": minor
---

`20°C` reads as a temperature

`°C` and `°F` are in the unit table and could never reach it. The lexer reads a
unit as one run of `[A-Za-z0-9_]`, so a non-ASCII character cannot become a unit
token, and the line arrived at the parser as a number and an identifier nobody
had defined.

| expression | before | now |
| --- | --- | --- |
| `20°C in F` | `Undefined variable: °C` | `68.00 F` |
| `100°F in C` | `Undefined variable: °F` | `37.78 C` |
| `180°C in gas mark` | `Undefined variable: °C` | `gas 4` |
| `37°C` | `Undefined variable: °C` | `37.00 °C` |

Meanwhile every other spelling of the same question already answered, so
`20 C in F` was `68.00 F` and `20° C in F`, with a space, was too. A refusal with
the answer one retyped character away is a gap rather than a boundary.

The precomposed `℃` and `℉` that some keyboards emit read the same way, and `°K`
is kelvin, which has no degree sign of its own and is spelled `K` in the table.

The scale letter is what claims the shape, so `90°` is still ninety degrees of
arc and `sin(90°)` is still `1`. The two rules share a character and only one of
them may have it: the angle rule takes the symbol standing alone, this one takes
it only when a letter is attached.

The boundary is the symbol forms only. `C` is still Celsius and `c` is still the
cooking cup, no ordinary word is claimed, and the case sensitivity of the unit
table is untouched: the five spellings above are the whole of it.

Two `test.failing` cases in the units-table integrity spec, which pinned this as
a known defect, are ordinary passing tests now.

[Converting units](https://liamriddell.github.io/solve-engine/syntax/converting-units/)
gains a proven section for the symbol forms.
