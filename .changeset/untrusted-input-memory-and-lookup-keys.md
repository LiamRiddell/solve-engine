---
"solve-engine": patch
---

Evaluating untrusted input is bounded in memory, and a word used as a lookup key can no longer resolve to an inherited property

Two hardening fixes for a host that evaluates input it does not control. Both
are behaviour-preserving for every ordinary expression: they change what the
engine does with input that was already wrong, never a real answer.

## The allocation budget now covers the values that grow without being a collection

The budget is the running tally every evaluation is charged against, the one
that already refuses an over-large matrix or an expanded range. It counted the
things that are collections, matrix cells and range elements, and three values
that grow without being one were never charged: a string joined to itself, a
bigint multiplied by itself, and the exact decimal behind same-currency money.
Each doubles every time the operator touches it, so a user-defined function that
squares or concatenates its argument, nested a few dozen deep, built a
near-gigabyte value from a document under a hundred characters long, while every
between-opcode limit (instruction count, call depth, expression length) passed.

| a one-line function, then its nested call | before                    | now                         |
| ---                                       | ---                       | ---                         |
| `d(s) = s + s`, then `d(d(…("ab")…))`     | a 256 MB string, no error | `ALLOCATION_LIMIT_EXCEEDED` |
| `b(n) = n * n`, then `b(b(…(9)…))`        | a 27 MB integer, no error | `ALLOCATION_LIMIT_EXCEEDED` |
| `m(x) = x * x`, then `m(m(…($9)…))`       | a 7 MB exact coefficient  | `ALLOCATION_LIMIT_EXCEEDED` |

Each refusal trips at roughly two megabytes of accumulated growth, not at the
hundreds of megabytes above, which are the sizes the same inputs reached with no
charge in place. The three are now charged on birth, in the one place that kind
of value is made, the same backstop `matrixValue()` already had; the running
tally then accumulates the doubling chain and trips well before V8's own
string-length or heap ceiling. `^` and `<<` on a bigint already refused past a
fixed bit ceiling; plain multiply, which has none, is what this charge bounds.
The charge is a no-op outside an evaluation (the formatter, a restored snapshot,
a host call), and the everyday forms are untouched: `"foo" + " bar"`, a bigint
sum, `$2.50 * 3`.

## A lookup key can no longer read an inherited property

Several parts of the grammar resolve a word the reader typed by reading it from
a table: a converter name (`as hex`), a rounding increment (`to nearest ten`), a
compounding interval (`compounding monthly`), a timezone (`in Tokyo`), a
currency alias, a `map`/`reduce` function, a cooking ingredient, a large-number
suffix. Each was a plain object read by key, so a word that happens to name an
inherited property, `constructor` or `__proto__` (and, for the tables read
without lower-casing, `valueOf` or `toString`), read a value off the object's
prototype instead of missing. The lookup treated that inherited function as a
real entry, and the line returned a confident wrong answer or leaked an engine
internal.

| expression                  | before                     | now                |
| ---                         | ---                        | ---                |
| `5 as constructor`          | `5`                        | unknown converter  |
| `5 to nearest constructor`  | `NaN`                      | refused            |
| `2026-04-03 in constructor` | an internal bytecode error | unknown zone       |
| `map(constructor, [1,2,3])` | an internal bytecode error | unknown function   |
| `300g constructor in cups`  | `NaN`                      | unknown ingredient |

Every such lookup now misses on a name it does not own, so a prototype name is
unknown like any other unrecognised word, and the real names (`as hex`,
`in Tokyo`, `map(double, …)`) work exactly as before. No table was ever written
through one of these keys: `Object.prototype` is untouched, so this closes a
wrong-answer and internal-error leak, not a prototype-pollution vector.

The boundary: this is the lookup, not the feature. A genuinely unknown word
already produced the honest "unknown X" error; the fix is that an inherited
property name now produces that same error rather than a wrong value or a leaked
internal code. The value charges change no result a legitimate expression
produces, only the point at which an unbounded one is refused.

## Verification

The full suite is green (9,470 tests across 483 suites), with two new hardening
specs. One drives each of the three doubling chains to
`ALLOCATION_LIMIT_EXCEEDED` on the default budget and confirms the everyday forms
still evaluate and the refusal is recoverable. The other asserts that a prototype
name gives the same honest "unknown" as any other word across every guarded
lookup, including the ones whose result is emitted into bytecode, and that
`Object.prototype` is untouched after every attempt. `npm run verify:ci` passes,
including the bundled-consumer contract.
