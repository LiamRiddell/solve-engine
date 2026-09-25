---
"solve-engine": patch
---

Units and money: a shape's area is squared, a tolerance, a list and a constant are refused where their unit was lost, statistics and health read units, temperatures add as steps, `in` reaches a converter, a decimal is its own fraction, fiat and crypto rates coexist, and inflation is US dollars only

Twelve faults from the 2026-09-25 survey of units, quantities and money. Each gave a confident answer in a unit that was wrong, or dropped a unit without saying so.

**A shape's dimensions carry their units (#638).** The geometry parselet read only the number of `radius 5 m`, so the stranded `m` labelled the whole answer, and in front of a comma it stopped the line parsing. Each dimension is now read with its unit, the dimensions are put into one length unit (the first one written), and the answer takes the power its measure has: a length for a perimeter, the square for an area, the cube for a volume.

| line | before | now |
| --- | --- | --- |
| `area of circle radius 5 m` | 78.54 m | 78.54 m² |
| `area of circle radius 5 m in cm²` | refused: a length cannot be converted to an area | 785,398.16 cm² |
| `area of circle radius 5 m in cm` | 7,853.98 cm | refused: an area cannot be converted to a length |
| `volume of sphere radius 2 m` | 33.51 m | 33.51 m³ |
| `area of rectangle width 3 m, height 4 m` | error: Unexpected token after expression: "," | 12.00 m² |
| `area of circle radius 5 kg` | 78.54 kg | refused: a radius is a length, not a mass |

A dimension with no unit beside one with a unit is read in that unit, as `total of 1 km, 500` reads it, so `width 3 m, height 4` is 12.00 m². A length with no square or cube spelling of its own answers in square or cubic metres, as `(5 furlong)^2` does, rather than being refused: `area of square side 2 furlong` is 161,874.26 m². Bare dimensions answer plain numbers as before.

**A value with a tolerance cannot be converted or meet a quantity (#639).** A tolerance is read without the unit of the value it is on, as the uncertainty page documents, so `5 m +/- 1 cm` is the plain `5 ± 0.01`. A later `in mm` labelled that bare 5 as millimetres, and a quantity in `+`, `-`, `*` or `/` gave the answer its unit and dropped the spread. Both are refused by name (`UNCERTAINTY_WITHOUT_UNIT`), and so is a unit written straight after such a value.

| line | before | now |
| --- | --- | --- |
| `(5 m +/- 1 cm) in mm` | 5.00 mm | refused, pointing at `(5 m in mm) +/- 10` |
| `(20 C +/- 1 F) in F` | 20.00 F | refused |
| `(5 +/- 0.1) in km` | 5.00 km | refused |
| `(5 +/- 0.1) km` | 5.00 km | refused |
| `(5 m +/- 1 cm) + 2 m` | 7.00 m | refused |
| `(5 +/- 0.1) * 2 m` | 10.00 m | refused |

The engine cannot tell a centre whose unit was dropped from one that never had one, so a unitless measurement is refused the same way. Scalar arithmetic is unchanged (`(5 m +/- 1 cm) * 2` is 10 ± 0.02), and so is the conversion of the tolerance into the centre's unit. Carrying the unit through, so that `(5 m +/- 1 cm) in mm` is 5,000 ± 10 mm, changes what the page documents and is left to its own change.

**A list given a unit is refused, not read as zero (#640).** A unit written straight after a list, and a quantity combined with one, read the list as the 0 `toNumber()` reports for it. The first is refused with the sentence `in` has given since #547 (`CONVERT_NON_NUMERIC`), the second with `QUANTITY_NON_NUMERIC`.

| line | before | now |
| --- | --- | --- |
| `[1, 2, 3] km` | 0.00 km | refused |
| `$[4, 5]` | $0.00 | refused |
| `[1, 2] * 1 km` | 0.00 km | refused |
| `[1, 2] + 1 km` | 1.00 km | refused |
| `1 km - [1, 2]` | 1.00 km | refused |
| `[1, 2] * 2` | [2, 4] | [2, 4] |

A range and a colour beside a quantity are refused the same way. Text and a date keep their own refusals. Lists that carry a unit, so that `[1, 2] * 1 km` becomes a list of lengths, are a designed feature this leaves open.

**A list literal in two units is refused (#641).** A cell stores a quantity's amount and drops its unit, so two units could not both be read right. A literal whose cells are in two different units is refused by name (`MATRIX_CELL_UNITS_DIFFER`), naming both.

| line | before | now |
| --- | --- | --- |
| `[1 km, 500 m]` | [1, 500] | refused, pointing at `in km` |
| `[1 kg, 3 m]` | [1, 3] | refused: mass and length are not one measure |
| `[$1, 2 kg]` | [1, 2] | refused |
| `[1 km, 2 km]` | [1, 2] | [1, 2] |
| `[1 km, 500]` | [1, 500] | [1, 500] |

A list in one unit keeps its bare magnitudes, since nothing in it is misread; two spellings of one unit (`km` and `kilometres`) are one unit. A bare number beside a quantity is read in its unit, the rule the aggregates follow.

**Standard deviation, variance and mode read units (#643).** Each read its arguments' bare magnitudes. They now read them in the first one's unit, as `spread` does, and answer in it.

| line | before | now |
| --- | --- | --- |
| `standard deviation of 1 kg, 1000 g` | 499.50 | 0.00 kg |
| `standard deviation of $10, $20, $30` | 8.16 | $8.16 |
| `mode of 1 kg, 1000 g, 2 kg` | 1 | 1.00 kg |
| `standard deviation of 1 kg, 2 m` | 0.50 | refused: mass and length cannot be used in a standard deviation |
| `variance of 2 m, 4 m` | 1 | 1.00 m² |
| `variance of 1 kg, 1000 g` | 249,500.25 | refused (`UNIT_POWER_UNSUPPORTED`) |
| `standard deviation of 1/0, 1000` | NaN | refused (`STATISTIC_NOT_FINITE`) |

A variance is in the square of the data's unit, which the engine spells only for a length. For any other quantity, money and temperatures included, the choice made is to refuse by name, as the power operator refuses `(2 kg)^2`, and to point at the standard deviation, which is the same spread in a unit the engine can write. A list with an infinity in it, which gave NaN, is refused as well. Plain numbers are otherwise unchanged. A table column of quantities is still refused by the column form, which reads plain-number cells only.

**`bmi`, `pace` and `speed` convert the units they are given (#644).** Each read a quantity's magnitude in the unit it assumes, so 175 cm was 175 metres and one hour was one minute. A quantity is converted into the function's unit now, and one that measures something else is refused with `HEALTH_BAD_INPUT`.

| line | before | now |
| --- | --- | --- |
| `bmi(70 kg, 175 cm)` | 0.00229 | 22.86 |
| `bmi(154 lb, 69 in)` | 0.03 | 22.74 |
| `speed(10 km, 1 h)` | 600.00 km/h | 10.00 km/h |
| `speed(10 mi, 1 h)` | 600.00 km/h | 16.09 km/h |
| `pace(10 mi, 80 min)` | 8:00 /km | 4:58 /km |
| `bmi(70 kg, -175 cm)` | 0.00229 | refused: the height cannot be negative |

A bare number keeps the documented unit, so `speed(10, 1)` is still 600.00 km/h. A negative figure is refused with or without a unit. `pace` still answers per kilometre when the distance is in miles.

**Temperatures across scales (#645).** A conversion between offset scales that lands within the comparison tolerance of zero is zero, so the value and not only its display is the shared point. And `+` reads a right-hand temperature on another scale as a step, converted the way a tolerance's width is.

| line | before | now |
| --- | --- | --- |
| `32 °F in °C` | 5.68e-14 °C | 0.00 °C |
| `20 °C + 10 °F` | 7.78 °C | 25.56 °C |
| `20 °C + 10 K` | -243.15 °C | 30.00 °C |
| `68 °F + 10 °C` | 118.00 °F | 86.00 °F |
| `10 °F + 20 °C` | 78.00 °F | 46.00 °F |

Same-scale sums are unchanged, and a genuine small reading is left alone (`32.0018 °F in °C` is 0.001 °C). Subtraction, and converting a difference afterwards, keep their documented reading and are held for 3.0: `20 °C - 10 °F` is still 32.22 °C.

**A bare number takes only a unit or a converter after `in` (#646).** A package's converters (`roman`, `words`, `ordinal`) lex as ordinary words, so `in` never reached them, and a plain number was given any word after `in` as its unit. `in` now reaches every converter a package registered, as `as` does, and a word that is neither a unit nor a converter is refused with the `UNKNOWN_UNIT` sentence a quantity already had.

| line | before | now |
| --- | --- | --- |
| `2024 in roman` | 2,024.00 roman | MMXXIV |
| `42 in words` | 42.00 words | forty-two |
| `5 in widgets` | 5.00 widgets | refused: "widgets" is not a unit. |
| `5 in Tokyo` | 5.00 Tokyo | refused |
| `5 in km` | 5.00 km | 5.00 km |

`to` is deliberately not rewritten the same way. A word after `to` is a percentage change to a variable (`start to n`), and a package converter is often named like one (the derived units register `n`, `v` and `w`), so `2024 to roman` still reads a variable called `roman`. The converters stay process-wide, as `as` reads them. The developer guide for `asConverters` describes the `in` spelling and its limits.

**A typed decimal is the fraction it spells (#647).** `as fraction` guessed at the double nearest the decimal with a continued fraction, which for six-digit decimals landed on near misses. It now renders the value's exact decimal. The choice made is the rule fractions.md states, a decimal reads as the fraction it is, always, so a decimal that only approximates a simple fraction is not rounded onto it.

| line | before | now |
| --- | --- | --- |
| `0.333333 as fraction` | 333332/999997 | 333333/1000000 |
| `3.14159 as fraction` | 76149/24239 | 314159/100000 |
| `0.0001234 as fraction` | 3/24311 | 617/5000000 |
| `0.3333333 as fraction` | 1/3 | 3333333/10000000 |
| `0.2857142857 as fraction` | 2/7 | 2857142857/10000000000 |
| `0.125 as fraction` | 1/8 | 1/8 |

A value with no exact form keeps the continued-fraction guess: `sqrt(2) as fraction` is still 47321/33461.

**`boltzmann` carries J/K, and the unitless constants refuse a quantity (#648).** The physical constants without an engine unit were plain numbers, which take the unit of the quantity they meet.

| line | before | now |
| --- | --- | --- |
| `boltzmann` | 1.38e-23 | 1.38e-23 J/K |
| `boltzmann * 300 K` | 4.14e-21 K | 4.14e-21 J |
| `planck * 5e14 Hz` | 3.31e-19 Hz | refused (`CONSTANT_UNIT_UNSUPPORTED`) |
| `gas constant * 300 K` | 2,494.34 K | refused |
| `avogadro * 2` | 1,204,428,152,000,000,000,000,000 | 1,204,428,152,000,000,000,000,000 |

`planck`, `elementary charge`, `gas constant` and `avogadro` need a dimension the engine does not have yet (charge, the mole, a product of units). They stay plain numbers marked with their unit, and a quantity meeting one in arithmetic or a conversion is refused. A value already computed from one (`planck * 2`) is an ordinary number, so the refusal covers the constant as written or held in a variable. A snapshot keeps the mark (an optional `uu` field on a serialised number, so no format version bump), so a variable holding `planck` is refused the same way after `fromJSON`. They gain their units with the everyday-units feature.

**Fiat and crypto rates no longer overwrite each other (#649).** Both fetch paths stored their result under the base currency and replaced whatever table was there, so of `$100 in EUR` and `$100 in BTC` in one note, whichever landed second cost the other its rate, and a host's primed table was lost to the first live fetch for its base. Each source now keeps its own table. With `fetch` stubbed (Frankfurter USD to EUR at 0.9, CoinGecko bitcoin at $50,000):

| note | before | now |
| --- | --- | --- |
| `$100 in EUR`, then `$100 in BTC` | CURRENCY_RATE_UNAVAILABLE, 0.002 BTC | €90.00, 0.002 BTC |
| `$100 in BTC`, then `$100 in EUR` | 0.002 BTC, CURRENCY_RATE_UNAVAILABLE | 0.002 BTC, €90.00 |
| host primed USD to EUR at 0.9, Frankfurter stub at 0.8 | €80.00, CURRENCY_RATE_UNAVAILABLE | €90.00, 0.002 BTC |

A pair two fresh tables both hold is served by the rule the single table per base gave: the base stored first, and within a base the table stored most recently, so no rate that used to be served moves. Freshness windows, the providers and the triangulation rules are unchanged; whether a live fetch should ever override a host's own rate is left as it was.

**Inflation adjusts US dollars only (#650).** The bundled table is the US consumer price index (CPI-U), and every form applied it to whatever it was given, keeping the unit.

| line | before | now |
| --- | --- | --- |
| `what is £100 from 1990` | £254.55 | refused (`INFLATION_EXPECTED_USD`), naming the US index |
| `what is 100 kg from 1990` | 254.55 kg | refused |
| `what is 100 from 1990` | 254.55 | refused |
| `inflationAdjust(£100, 1990, 2020)` | £198.01 | refused |
| `inflationAdjust($100, 1990, 2020)` | $198.01 | $198.01 |

The `from <year>` forms run to the current year (2026 on this run). The choice for a bare number follows payroll, which refuses a bare salary: it would assume dollars without saying so, and is refused pointing at `$100`. Indices for other countries are not bundled; the stated-rate `value of ... assuming N% inflation` form does not use the index and still takes any currency.

The geometry, uncertainty, vectors and matrices, statistics, health, converting units, unit arithmetic, numerals, time zones, fractions, other representations, constants, currency and interest and inflation pages describe each change with proven examples, and the `asConverters` guide and the live-data guide cover `in` and the side-by-side rate tables.

## Verification

New tests pin each issue under `__tests__/bugs` (#638 to #641 and #643 to #650), each with an adversarial section: a mass, a duration, money, a list and an area as a shape's side, metres beside centimetres, a unit on one dimension only, zero and negative dimensions, and a quantity from a variable and from a line reference; every operator with a tolerance, a list or a constant on either side of a quantity, a percentage tolerance, a temperature centre and money; two spellings of one unit, two currencies, a temperature pair, a matrix with `;` rows and a sweep over lengths; temperatures across every pair of scales in both directions and a genuine small reading the snap must leave alone; a converter a host registered, words naming inherited properties and a very long rate after `in`; decimals past a double's digits and past the exact-decimal limit; both orders of arrival of a fiat and a crypto rate, two crypto pairs from one base, a primed table beside a live fetch, a stale table, a failed fetch and provenance per line; and every inflation form with pounds, euros, a converted amount, a mass and a bare number. Each checks both document passes agree. Unit tests cover the new and changed helpers (`readDimensions`, `measureInUnit`, `asPowerOfLength`, `noSingleAmount`, `quantityOperandRefused`, `unitAfterValue`, `plainValueInUnit`, `namesAUnit`, `unknownUnitError`, `toleranceHasNoUnit`, `toleranceMeetsQuantity`, `uncertainOp`, `sameUnit`, `cellUnitsDiffer`, `spreadStatistic`, `modeOf`, `readHealthInput`, `temperatureStep`, `hasOffset` and the offset snap in `convertUnit`, `fractionOfExactDecimal`, `unspelledUnitRefused`, `inflationAmountRefused`, the converter preposition rule, and the exchange's tables through its public methods). The adversarial sweep gains a units-and-money group of fifteen forms over its numeric edges, which found the NaN standard deviation of a list with an infinity in it. Five existing tests that pinned the old readings now pin the new ones: `5 in Tokyo`, which was labelled as a unit and is refused, and four inflation tests written with a bare amount, now written in dollars, with the bare amount's refusal pinned beside them. The time-zones page's `5 in Tokyo` example shows the refusal.

The engine suite is 15,164 tests in 602 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including `lint:units`, the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.
