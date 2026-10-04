---
"solve-engine": minor
---

An electricity cost can be written in reading order: `$0.30/kWh * 2 kW * 3 h` is $1.80

An electricity cost is usually said as the price, then the power, then the time. Multiplication runs left to right, and a rate could only meet a quantity of its own denominator's measure, so the price met a power before the time had made it an energy, and the line was refused while `2 kW * 3 h * $0.30/kWh` gave $1.80 (#758). A rate times a quantity of another measure now forms the rate per what is left, when the rate's denominator over the quantity is a single unit the engine names: a kilowatt-hour per kilowatt is an hour, so a price per kilowatt-hour times a power is a price per hour, and a kilowatt-hour per hour is a kilowatt, so times a time it is a price per kilowatt. The next factor then cancels as against any rate.

| line | before | now |
| --- | --- | --- |
| `$0.30/kWh * 2 kW * 3 h` | `RATE_MUL_MEASURE_MISMATCH` | $1.80 |
| `$0.30/kWh * 2 kW` | `RATE_MUL_MEASURE_MISMATCH` | $0.60/h |
| `$0.30/kWh * 3 h * 2 kW` | `RATE_MUL_MEASURE_MISMATCH` | $1.80 |
| `$0.30/kWh * 2 kW * 180 min` | `RATE_MUL_MEASURE_MISMATCH` | $1.80 |
| `$300/MWh * 2000 W * 3 h` | `RATE_MUL_MEASURE_MISMATCH` | $1.80 |
| `$0.305/kWh * 2 kW * 3 h` | `RATE_MUL_MEASURE_MISMATCH` | $1.83 |

The answer stays exact to the cent, as `12.3 kWh * $0.15/kWh` is (#579): the price per hour carries its decimal. A time is counted in hours when the rate is per watt-hour (`$0.30/kWh * 2 MW` is $600.00/h), and otherwise in the largest clock unit it counts whole. The refusal that remains is reworded without the hyphenated `"kWh"-denominated` it used: `Cannot multiply a rate per kWh by a quantity in kg: they measure different things, and together they make no unit.` The same step lets a speed times a force be a power (`10 m/s * 5 N` is 50.00 W).

The boundary: only a product that reduces to the denominator's measure with a time or a named unit. A price per kilowatt-hour times a mass, or a price per hour times a mass, keeps the named refusal, and so does a named rate such as `mph`. The multiplying and dividing units page gains a section on a price per kilowatt-hour in reading order, and its boundary no longer documents the refusal and the reordered workaround.

## Verification

`Issue758_pricePerKwhInReadingOrder.spec.ts` holds 89 tests: the bill in each order and in other units of time and power, the agreement of every order with the energy-first one, half-cent exactness, the explanation, what stays refused and the reworded message, unit tests of `unitQuotient` and `rateThroughQuantity` with ordinary, boundary and hostile arguments, and the adversarial cases: prototype words as the price's unit, the power and the time, a 400-factor chain, look-alike and markup-shaped text, a document through both passes with a check over it, a currency conversion inside the chain at a primed rate, and the numeric edges. `UnitAlgebra.spec.ts` and `Issue775_messageStyleLint.spec.ts` pinned the old refusal and its wording, and were updated to a case that is still refused and the new wording.

The full suite (`npm run test:full`, which includes the lexer fuzz and long-document suites) passed, 21,509 of 21,513 tests in 681 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:keywords`, and the proven documentation examples all evaluate as documented. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
