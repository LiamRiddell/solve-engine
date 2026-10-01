---
"solve-engine": patch
---

An infinity is written `∞` wherever a reader sees it: `∞ km` is `∞ km`, not `Infinity km`

A plain infinity has always been shown as `∞`, the sign the engine reads. A quantity and an amount of money are written through a different step, which wrote the number with JavaScript's `toFixed`, and `toFixed` writes an infinity as the word `Infinity`. So `∞ km` answered `Infinity km`, and so did every distance divided by zero or multiplied past about 1.8e308, the largest number that can be held: `1e308 * 10 km`, `-∞ m`, `∞ km in m`, `$1e308 * 10` (`$Infinity`). The word reached messages and converters too, wherever a number was put into text as it stood: `sin(Infinity) has no real value`, `Infinity mod 3`, `Year Infinity is outside the bundled UK price index's range`, `as sci`, `as fraction`, `as compact`, `as engineering`, `as timespan` (`Infinity weeks`) and a timecode's frame count (found while testing overflow). A note cannot read the word back, and it is an internal spelling, not the engine's.

Each of those now writes `∞`, or `-∞`, through one helper. The honesty checks every adversarial test uses now count the word as a leak, which is how the converters and messages above were found. While there, a solved formula whose exact value had a numerator too large for a double was converted to a number as an infinity over its denominator, so `x*π = 1e308`, `x =>` answered an infinity for a finite 3.18e307; the conversion now divides in exact arithmetic first, and also no longer turns a small numerator over a huge denominator into zero.

| line | before | now |
| --- | --- | --- |
| `∞ km` | `Infinity km` | `∞ km` |
| `-∞ m` | `-Infinity m` | `-∞ m` |
| `∞ km in m` | `Infinity m` | `∞ m` |
| `1e308 * 10 km` | `Infinity km` | `∞ km` |
| `$1e308 * 10` | `$Infinity` | `$∞` |
| `1 / 0 as sci` | `Infinity` | `∞` |
| `sin(1/0)` | sin(Infinity) has no real value: ... | sin(∞) has no real value: ... |
| `(1/0) mod 3` | Infinity mod 3 has no value: ... | ∞ mod 3 has no value: ... |
| `(01:02:03:04 at 30 fps) / 0` | `Infinity frames at 30 fps` | `∞ frames at 30 fps` |
| `(9:30 - 8:30) + (1/0) minutes` | `Infinity:NaN:NaN` | `∞` |
| `1e308 as multiplier` | `Infinityx` | `1e+308x` |
| `x*π = 1e308`, then `x =>` | `Infinity` | `31,830,988,618,379,070,...` |
| `200 + 1e308%` | `∞` | `∞` |

The boundary: an overflow is still an infinity, not a refusal. `200 + 1e308%` is `∞` because adding a percentage multiplies and the product is past the largest number that can be held, as `2^1024` is; that is the value the arithmetic reached, written the engine's way, and a later line can still compare it or divide by it. A quantity times zero or minus itself (`∞ km - ∞ km`) is NaN, as it is for a plain number. A converter a package author writes formats its own text, and is not covered. Six existing tests pinned the word (`FoundBug_exponentTextInAResult.spec.ts`, `LargeDoubleDigitsReadNoFormatter.spec.ts`, `ArithmeticConverters.spec.ts`, `Issue600_infiniteAnglesAndRemainders.spec.ts`, `Issue759_timecodeDisplay.spec.ts`, and `compactString` in `FoundBug_compactExponent.spec.ts`); each now asserts `∞`. `Issue710_perEngineRegistries.spec.ts` writes its test converter's number with the same helper, since its honesty check now reads the word as a leak.

## Verification

`FoundBug_infinityInAResult.spec.ts` holds 154 tests: nineteen quantities and amounts of money, the percentage overflow beside `2^1024`, ten converters, nine messages, a column total, a `total above` and a solved formula that overflow through both document passes, a solved formula past a double's numerator, and the single-line path; unit tests of `nonFiniteText` and `numberText` (the infinities and NaN, every finite edge, text read as a number), `fixedDecimalText` and `shortestText` (the largest double in full, a hundred places of an infinity), `formatMsDuration`, `timecodeText` and `toTimespanString` (finite, signed infinite, NaN), `engineeringString` and `compactString`, and `rationalToNumber` and `formatRational` (a numerator or denominator past a double, a thousand digits each way in time); and the adversarial cases (prototype words as the unit with `Object.prototype` unchanged, the infinity emoji, five hundred infinities and five hundred overflows in time, text edges, markup, an infinite quantity from the line above converted, checked and summed, a unit that does not fit, a what-if that overflows, every numeric edge pushed past the largest double as a quantity and as money, the largest double with a unit, zero, negative zero and the smallest double). `tools/adversarial.ts` counts `Infinity` as a leak, and `AdversarialFeatureSweep.spec.ts` gains three overflow templates. Gates: see the verification of `unit-named-unknown.md`.
