---
"solve-engine": minor
---

`not` and a prefix `!` negate a boolean, and negating anything else is refused by name

There was no way to negate a condition. `and` and `or` joined booleans, but `not` was not a word the engine knew, and `!` was only the factorial after a number, so `!(1 > 2)` failed with a message about a missing value (#751).

| line | before | now |
| --- | --- | --- |
| `!true` | throws `Expected a value, but found "!"` | false |
| `!(1 > 2)` | throws `Expected a value, but found "!"` | true |
| `not true` | throws `Expected an operator or the end of the line, but found "true"` | false |
| `not (1 > 2)` | throws `Undefined function: not. Did you mean dot?` | true |
| `if not 5 > 3 then 1 else 2` | throws `Expected "then", but found "5"` | 2 |
| `not 5` | throws `Expected an operator or the end of the line, but found "5"` | `"not" works on true or false, and 5 is a number: compare it first, as in not (x > 3).` |

The two spellings bind as they do in the languages they come from. `not` takes the comparison after it and stops at `and`, `&&`, `or` and `||`, as in Python and SQL, so `not a > b` is `not (a > b)` and `not true and false` is `(not true) and false`. A `!` takes the one value after it, as in C and JavaScript, so a comparison after it needs its brackets. Negating a number, an amount, a text or a date is refused with the new code `NOT_NEEDS_BOOLEAN`, never read as zero or as a bit complement.

The boundary: negation is of a boolean only. `~` stays the bit complement, a `!` after a value stays the factorial (`5!` is 120) and `!=` stays "not equal". `not` is ordinary English and was a free name, so it is read as negation only where a value is expected (the start of a line, or after `if`, `then`, `else`, a bracket, a comma, `and`, `or` or a comparison) and a condition follows it: `not now` stays a non-answer, and `not = 3` then `not + 1` still define and read a variable. A `check` still needs a comparison, so `check !(1 > 2)` is refused as any check without one is; `check !(1 > 2) == true` is a comparison of two booleans, which a check does not compare (out of this change's scope). The conditionals page gains the section.

## Verification

`Issue751_notAndBang.spec.ts` holds 110 tests: both spellings over booleans and comparisons, `if not`, what must keep working (`5!`, `3 != 4`, `~5`, `true and false`), how tightly each spelling binds, variables in a document, the named refusal for a number, zero, money, text and a quantity, a stray `!`, sentences starting with `not`, the variable called `not`, `not` inside a label, and a check over a negation. The parts are tested directly: `logicalNot` and `kindOfOperand` with ordinary, boundary and hostile arguments, the normaliser rule's `negates` and `isNotWord`, and the parselet. The adversarial cases cover the numeric edges after `not` and `!`, the text edges after `not`, prototype words, five hundred chained `not`s and two thousand `!`s, look-alike characters and agreement of the two document passes. The gates run are those listed in the multi-word names changeset, which shipped in the same change.
