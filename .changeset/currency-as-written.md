---
"solve-engine": minor
---

Currency is read the way it is written, and every amount the engine writes can be typed back: `100 €`, `12.00 kr`, `A$100`, `R12.00` and `100 usd`

The engine wrote ten currencies with a symbol after the amount or in letters, and could read none of them back: `12 SEK` showed `12.00 kr`, and `12.00 kr + 1 SEK` was an undefined variable (#693). It also read a symbol only before the amount, a dollar only as `$`, and a code only in capitals, where much of the world writes `100 €`, `A$100` or `100 usd` (#707).

| line | before | now |
| --- | --- | --- |
| `12.00 kr + 1 SEK` | `Undefined variable: kr` | 13.00 kr |
| `100 €` | throws `Unexpected token after expression: "€"` | €100.00 |
| `1,000 ₹` | throws `Unexpected token after expression: "₹"` | ₹1,000.00 |
| `A$100 + $5 AUD` | throws `Unexpected token after expression: "$"` | $105.00 |
| `R1,234.56` | throws `Unexpected token after expression: ","` | R1,234.56 |
| `100 usd` | `Undefined variable: usd` | $100.00 |

Each newly read form:

- **A symbol after the amount**, with or without a space: `100 €`, `100 $`, `100 £`, `100 ¥`, `12 ₽`, `12 ₩`, `1,000 ₹`, `12 ₺`, `12 ₴`, `12 ₪`, `12₫`, `12 ₦` and `12 ₱`, each the same money as the symbol before it.
- **The letters written after an amount**: `kr` (the Swedish krona), `zł` (zloty), `Ft` (forint), `Kč` (koruna) and `Fr` (Swiss franc), matched exactly as written, so `ft` stays the foot.
- **A dollar named by its country**, written touching the `$`: `A$`, `C$`, `US$`, `HK$`, `NZ$`, `S$`, `MX$` and `R$`.
- **The rand as the engine writes it**, the `R` touching an amount with its cents: `R12.00`, `R1,234.56`.
- **Thirty-two codes in lower case**: `usd`, `eur`, `gbp`, `jpy`, `cny`, `chf`, `cad`, `aud`, `nzd`, `hkd`, `sgd`, `sek`, `nok`, `dkk`, `pln`, `czk`, `huf`, `inr`, `krw`, `brl`, `mxn`, `zar`, `ils`, `thb`, `aed`, `sar`, `myr`, `idr`, `vnd`, `ngn`, `uah` and `twd`.

Of the twenty symbols the engine writes, eight read back before this change. All twenty read back now. Three are written for several currencies, and read as the default each already had or was given: `$` the US dollar, `¥` the yen, and `kr` the Swedish krona, as the word `krona` does.

The boundary: those three defaults mean an amount written for one of the others reads back as the default (`12 NOK` is written `12.00 kr`, which reads as kronor), so a note keeps the code where the currency matters; changing what the engine writes for them is not part of this. A bare `R` is not read as the rand, since people use it as a name, so `12 R` still multiplies by `R`, and `R12` without cents can still name a resistor. The prefixed dollars are read only when the letters touch the `$`, so `A` stays the ampere and `C` the coulomb, and `A $100` is left as written. The lower-case codes are a chosen list rather than every code folded to lower case, because several codes are words or units in lower case (`cup`, `try`, `mad`, `top`, `bob`, `all`, `pen`); `rub` and `php` are left out as a verb and a language. A spec asserts that none of the new spellings was already a unit, a keyword or a function. The currency page gains a section with proven examples.

## Verification

`Issue693_707_currencyAsWritten.spec.ts` holds 108 tests. Every code in the display table is written for 12, 1,234.56 and -12 and typed back, reading back as itself or as its symbol's default. Each suffix symbol is read with and without a space, with a thousands group and negative, and reads as the same symbol before the amount; one with another amount after it is left as written. Each letter symbol and each prefixed dollar is read, the letters exactly as written (`Ft` beside `ft`), and a name `Fr`, `A` or `C` defined above still works. The rand is read in the shapes the engine writes and not after an amount or without its cents, so `R = 5` then `12 R` is still 60. Each of the 32 lower-case codes is read, a spec asserts none was already a unit, a keyword or a function, and `try`, `rub`, `php`, `cup` and `Usd` are left alone. The adversarial cases: prototype words as symbols and before a dollar, a symbol after something that is not an amount, and a long line of suffix amounts. The unit-vocabulary spec knows the letter symbols are currencies, and a hardening test that recorded `100 usd in eur` as unreadable now records it read.

The full suite (`npm run test:full`) passed, 15,742 of 15,746 tests in 615 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,878 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,385 documented examples). `executeBytecode` is unchanged at 47,528 bytecode bytes on Node 24.16.0.
