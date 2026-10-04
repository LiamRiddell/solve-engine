---
"solve-engine": minor
---

Speed, acceleration and frequency take part in unit algebra, and a power over a voltage is a current in amperes: `9.81 m/s^2 * 3 s` is 29.43 m/s and `100 W / 20 V` is 5.00 A

The unit algebra knew force, energy, power, pressure and voltage, but not speed, acceleration or frequency, so everyday physics was refused or mislabelled (#737). An acceleration times a time met "acceleration and duration cannot be multiplied", a change of speed over a time was called a rate of a rate, a frequency times a time was refused, and a power over a voltage stayed `W/V`. Speed and frequency now have a dimension, as does every unit written with a slash (`km/h` is a length over a time, `ft/s²` a length over a time squared), the ampere is a named result, and a product or quotient with a speed, an acceleration or a frequency on one side is named as the speed, acceleration, time, mass or plain count it comes to.

| line | before | now |
| --- | --- | --- |
| `9.81 m/s^2 * 3 s` | error: acceleration and duration cannot be multiplied | 29.43 m/s |
| `100 km/h / 10 s` | error: km/h per s is a rate of a rate | 2.78 m/s² |
| `10 Hz * 2 s` | error: frequency and duration cannot be multiplied | 20 |
| `10 Hz in /s` | 10.00 Hz/s | 10.00 /s |
| `100 W / 20 V` | 5.00 W/V | 5.00 A |
| `20 N / 2 m/s^2` | 10.00 N/mps2 | 10.00 kg |
| `9.81 m/s^2 in ft/s^2` | throws: a power applies only to a length | 32.19 ft/s² |
| `9.81 m/s^2 + 1 ft/s^2` | throws: a power applies only to a length | 10.11 m/s² |

The results convert (`9.81 m/s^2 * 3 s in mph` is 65.83 mph), a speed worked out from an acceleration in feet stays in feet (`3 ft/s^2 * 2 s` is 6.00 ft/s), and a frequency converts to and from any count per unit of time (`600 /min in Hz` is 10.00 Hz). A refusal that meets an acceleration names it `m/s²`, where several named the internal `mps2`.

The boundary: a speed, a time or a mass is only built this way when one side is already a speed, an acceleration or a frequency, so two plain quantities keep the reader's units (`90 km / 3 days` is still a rate in kilometres per day, and `120 mi / 60 mph` 2 hours). A price per hour over a time is still a rate of a rate, refused by name. Momentum (`100 kg * 10 m/s`), angular speed (`rpm`) and torque are not covered, and the ohm and the charge are left to the electrical units work (#706). The named derived units page gains a section on speed, acceleration and frequency, and the multiplying and dividing units page loses the speed-over-time refusal it documented.

## Verification

`Issue737_speedAccelerationFrequency.spec.ts` holds 166 tests: each identity in both orders, the results converted, what stays as it was (money over time, two plain quantities, the products with no name), the explanation of each product, unit tests of `dimensionOf`, `tryDimensionalCompose`, `accelerationSize`, `convertRate`, `describeMeasure`, `unitForMessage` and `unifyUom` with ordinary, boundary and hostile arguments, and the adversarial cases: prototype words in every position of an acceleration and a frequency target, a 500-factor chain, look-alike and markup-shaped text, a document through both passes with a check over it, and the numeric edges through four forms. Six existing specs that pinned the old refusals were updated to cases that are still refused.

The full suite (`npm run test:full`, which includes the lexer fuzz and long-document suites) passed, 21,509 of 21,513 tests in 681 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:keywords`, and the proven documentation examples all evaluate as documented. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
