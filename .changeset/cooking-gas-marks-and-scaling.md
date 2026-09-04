---
"solve-engine": minor
---

Oven gas marks, and scaling a recipe by its servings.

A British gas oven is not marked in degrees: its dial runs from a quarter to nine, and each mark stands for a temperature. That is a lookup rather than a sum, because the steps are uneven, so no unit conversion could express it.

| expression | result |
| --- | --- |
| `180C in gas mark` | `gas 4` |
| `350F in gas mark` | `gas 4` |
| `gas mark 4` | `180.00 C` |
| `gas 6` | `200.00 C` |
| `gas 6 in F` | `392.00 F` |

Both spellings a recipe uses are read, and the answer to `in gas mark` is text because "gas 4" is what the dial says. That also keeps the two slow settings readable: 110°C is `gas 1/4`, a dial position rather than the number a quarter. A temperature between marks reads as the nearer one within ten degrees, half the widest step in the table; further out is not a gas setting at all and says so.

```
300C in gas mark    300C is not a gas setting: the dial runs from gas 1/4 (110C) to gas 9 (240C)
```

Scaling gives the factor to multiply quantities by when you are cooking for a different number of people.

| expression | result |
| --- | --- |
| `scale 4 servings to 6` | `1.50` |
| `scale 6 servings to 4` | `0.67` |
| `scale 4 people to 10` | `2.50` |
| `scale 2 to 5` | `2.50` |

The word for what you are counting is yours (`servings`, `serves`, `people`, `portions`) or you can leave it out. This is a factor, not a recipe parser: it hands you the number and you apply it to the quantities you care about.

The boundary is that neither word is claimed. `gas` and `scale` stay ordinary identifiers everywhere else, and are read as cooking only when the rest of the phrase is present: a number after `gas`, and a complete `scale ... to ...` around `scale`. So `:scale = 1.5` still defines a variable, which a lexer keyword would have broken, and the playground's own recipe example still runs.

Nothing was added for ingredients or Fahrenheit. `2 cups flour in grams` already works through the units' ingredient densities, and `180C in F` is an ordinary conversion; this package is only what those two cannot express.
