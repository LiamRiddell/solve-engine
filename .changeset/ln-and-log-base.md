---
"solve-engine": minor
---

`ln(x)` is the natural logarithm, and the docs say which base `log` uses

`ln` was an undefined function, and nothing on the reader pages said that `log` is the natural logarithm, so `log(100)` giving 4.61 read as a wrong answer to anyone expecting a calculator's base-10 key (#667).

| line | before | now |
| --- | --- | --- |
| `ln(e)` | Undefined function: ln | 1 |
| `ln(100)` | Undefined function: ln | 4.61, the same as `log(100)` |
| `ln(0)` | Undefined function: ln | refused: ln(0) has no real value: ln is only defined for positive numbers. |
| `ln = 4`, then `ln * 2` | 8 | 8 |

`ln` becomes the call only where a bracket follows it, the way `sha256(` does, so a note that already uses `ln` as a variable keeps working. It has its own builtin index over the same implementation as `log`, so a refusal, an arity error and an explanation all name `ln` as the line wrote it, and the algebra reads it as the logarithm it knows.

`log x base n` is exact at a power now. It divided two natural logarithms, so `log 1000 base 10` came out as 2.9999999999999996 and showed as 3.00; base 10 and base 2 now use their own logarithms, and a result a hair from a whole number that really is the power (`log 81 base 3`) is that whole number.

| line | before | now |
| --- | --- | --- |
| `log 1000 base 10` | 3.00 | 3 |
| `log 81 base 3` | 4.00 | 4 |

What stays: `log` is still base e, since making it base 10 would change every note that uses it. A two-argument `log(x, base)` is not added, because tools disagree on the argument order; `log 8 base 2` already names a base in words, and `log10` and `log2` name the common two. `ln 10` without a bracket is not read.

The number-functions page has a section on logarithms that says all of this.

## Verification

`Issue667_lnAndLogBase.spec.ts` has 25 tests: `ln` beside `log`, `log10` and `log2` and inside `map`, its explanation and its completion; `log x base n` at powers of 10, 2 and 3 and at a non-power (`log 2 base 10`), its refusals, its explanation and its symbolic change of base; and adversarial cases: `ln` of zero, of a negative number and of a mass, and with no argument or two, each refused under the name it was written with; `ln` as a variable name wherever no bracket follows, on both document passes; and the algebra reading `ln` as the logarithm.

The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
