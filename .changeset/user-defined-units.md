---
"solve-engine": minor
---

A document can now define its own units, the way it can already define a function.

`f(x) = 2*x + 1` worked, but `1 sprint = 2 weeks` did not, so anyone working in a unit the engine does not ship had to keep the conversion factor in their head and write it out on every line. Now the name is taught once and used everywhere below it:

```
1 sprint = 2 weeks         was a parse error, now sprint defined
6 sprints in days          was Undefined variable,  now 84 days
1 story point = 4 hours    was a parse error, now story point defined
13 story points            was Undefined variable,  now 52 hours
```

A defined unit is an alias for a real unit, so it inherits that unit's dimension. `6 sprints in days` converts and `6 sprints in kg` is refused the same way `2 weeks in kg` is, reporting that a duration is not a mass. Plurals and multi-word names both work, and the value is reported in the base unit (`6 sprints` is `12 weeks`).

The shape is deliberately narrow so it cannot swallow an equation. Only the natural `1 <name> = <quantity> <unit>` form defines a unit: the coefficient must be `1`, the name must not be a built-in unit, and the base must be a known unit. `2 x = 10` is still a scalar equation, `x = 5` is still an assignment, and a built-in unit still cannot be redefined.

Definitions are document-scoped, the way a user-defined function is. They are rebuilt top-to-bottom on every pass, so a definition holds only for the document that wrote it, a later line redefining a name replaces the earlier one, and nothing leaks between documents. A defined name only activates after a quantity, so a bare word in prose, or a same-named variable, is never rewritten into arithmetic.

Free-standing (dimensionless) units and a host-supplied definition table are deliberately left for a later slice: this change gives the document-scoped, dimensioned case, which is what planning, recipes and house units all wanted.
