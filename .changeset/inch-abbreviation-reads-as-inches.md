---
"solve-engine": patch
---

`12 in in cm` is 30.48 cm: the inch abbreviation reads as a unit

`in` is how the engine spells the conversion itself, so the unit table
deliberately refuses to claim the spelling and the word lexes as a keyword
wherever it appears. That was right for `12 in ft` and wrong everywhere else:
the abbreviation took the magnitude and relabelled it with the target unit, and
lost the unit entirely under arithmetic.

| expression | before | now |
| --- | --- | --- |
| `12 in in cm` | `12.00 cm` | `30.48 cm` |
| `5 in in mm` | `5.00 mm` | `127.00 mm` |
| `2 in + 3 in` | `5` | `5.00 in` |
| `12 in` | `12` | `12.00 in` |

The shape that separates the unit from the preposition is what follows the word.
A conversion needs something to convert into, so `in` is read as inches only
directly after a number and only where there is plainly nothing there: at the
end of a line, before an operator, or before a second `in` or a `to`, which is
the `12 in in cm` case itself.

Every other continuation keeps the reading the line already had. `12 in ft`,
`5 km in miles`, `100 in USD`, `$500 in 1990 dollars` and `99 in binary` are
unchanged, and so is `3 ft in in`, where the word follows a unit rather than a
number and is doing its ordinary job. The guard is a list of what ends a
quantity rather than a list of conversion targets, because a spelling missing
from the first list leaves the old reading in place, while one missing from the
second would turn a working conversion into inches.

The boundary: `12 in ft` still relabels a unitless number, exactly as it did
before. Whether a bare number should be convertible at all is a separate
question from whether `in` is a unit here.

[Converting units](https://liamriddell.github.io/solve-engine/syntax/converting-units/)
gains a proven section saying which spellings of inches are read and why.
