---
"solve-engine": minor
---

`1 1/2 cups` reads as a cup and a half

A recipe is written in mixed numbers and the engine ships a cooking package
aimed squarely at that reader, but the spelling was a parse error.

| expression | before | now |
| --- | --- | --- |
| `1 1/2 cups in ml` | a parse error | `354.88 ml` |
| `2 1/4 kg in lb` | a parse error | `4.96 lb` |
| `½ tsp in ml` | `Undefined variable: ½` | `2.46 ml` |
| `2 ½ cups in ml` | `Undefined variable: ½` | `591.47 ml` |
| `1 and 1/2 cups in ml` | `119.29 ml` | `354.88 ml` |

The last row is the reason this is more than a convenience. That spelling
answered, and answered wrongly: it computed `1 + (1/2 cups)` rather than
`(1 + 1/2) cups`, so a cup and a half came out as a fifth of what it is. Each
new form is pinned against the decimal it stands for, so the two cannot drift.

Three shapes, one reading. A whole number and a proper fraction beside it are
that mixed number; a whole number and a vulgar fraction beside it are the same
thing written shorter; and a vulgar fraction on its own is the fraction it draws,
handed on as a numerator over a denominator so it keeps the exact behaviour
typing `1/2` has. The whole Unicode fraction block is taken, since each character
means one fraction and nothing else.

The `and` spelling is claimed only in front of a unit, and only for the word.
`1 + 1/2 cups` lexes as an ordinary sum and stays `119.29 ml`, because changing
what a sum answers is not a spelling question. `1 and 1/2` on its own already
answered one and a half and is untouched.

The boundaries the issue asked for: the hyphenated `1-1/2` is ambiguous against
subtraction and is left as the subtraction it reads as; an improper fraction is
not a mixed number, so `3/2` and `1/2 + 1/3` are unchanged; and nothing here
changes how a fraction prints, so `1.5 as fraction` is still `3/2`.

[Cooking](https://liamriddell.github.io/solve-engine/syntax/cooking/) gains a
proven section, including the sum that is deliberately still a sum.
