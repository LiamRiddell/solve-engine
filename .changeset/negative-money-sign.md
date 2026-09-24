---
"solve-engine": patch
---

A negative amount of money is written with its sign before the currency symbol

A prefix currency symbol was placed in front of the whole amount text, and that text already carried its minus sign, so a negative amount read with the sign between the symbol and the digits. The sign now leads, as money is written on a statement.

| expression | before | now |
| --- | --- | --- |
| `-$5` | $-5.00 | -$5.00 |
| `$50 - $80` | $-30.00 | -$30.00 |
| `-£3.50` | £-3.50 | -£3.50 |
| `npv of -$1,000, $300, $400, $500 at 10%` | $-21.04 | -$21.04 |
| `-$1500 as compact` | -1.5k USD | -$1.5k |

The compact and engineering forms fell back to the currency code for a negative amount, which the corrected full form no longer needs, so they now write `-$1.5k` too. A currency written after the amount, such as `-5.00 kr`, was already right and is unchanged. The value itself is untouched: this is how it is shown, and a host reading `toNumber()` sees the same number as before.

Fixes #554.

## Verification

The grouping spec and the cash-flow spec now pin the sign first, the notation spec adds the compact form, and the currency page gains a negative amount as a proven example. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
