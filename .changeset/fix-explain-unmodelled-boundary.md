---
"solve-engine": patch
---

`explainLine` reports the answer alone when a line mixes arithmetic with an operator it does not break down, instead of a misleading step.

The derivation explains arithmetic (`+ - * / ^`, `of`, a percentage on a quantity), and a line built from anything else, a comparison, a conversion, a logical operator, is meant to come back with the answer and an empty step list. `2 + 2 == 4` broke that: it emitted `["2 plus 2 == 4", 1]`, an arithmetic step whose text glued the comparison on and whose result was actually the Boolean the line evaluates to.

```
explainLine("2 + 2 == 4")     was [["2 plus 2 == 4", 1]], now []
explainLine("100 + 20 in kg") was [["100 plus 20 in kg", 120]], now []
explainLine("3 * 4 > 10")     was [["3 times 4 > 10", 1]], now []
```

The operand scan stopped only at the operators the derivation models, so an unmodelled one (`==`, `<`, `in`, `to`, `and`, a bitwise op) was swallowed into a leaf rather than ending the line. An operand run is now a span of value tokens, so any operator that is not modelled ends it and the line falls back to reporting its answer with no steps, the same as a bare comparison always did. Arithmetic that the derivation does model is unchanged, and the answer itself was always correct.
