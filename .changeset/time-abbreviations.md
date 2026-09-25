---
"solve-engine": minor
---

Time abbreviations after a number: `$15/hr`, `30 mins` and `10 secs` are units, and so is anything with a micro sign, such as `5 µs`

An hourly rate is usually written `$15/hr` and a meeting `30 mins`. The engine refused both as undefined variables, although it already read the same spellings inside a compact duration: `1hr30min` gave 90 minutes (#666). The unit tables did not spell them, and they are the vocabulary the lexer, the rate and duration rules and the conversions all read. They now carry seven abbreviations, each another name for a unit they already had: `hr` and `hrs` for the hour, `mins` for the minute, `sec` and `secs` for the second, `wks` for the week and `yrs` for the year.

| line | before | now |
| --- | --- | --- |
| `$15/hr` | error: Undefined variable: hr | 15.00 USD/hr |
| `30 mins` | error: Undefined variable: mins. Did you mean min? | 30.00 mins |
| `10 secs` | error: Undefined variable: secs | 10.00 secs |
| `3 yrs in months` | error: Undefined variable: yrs | 36.50 months |
| `2 hours in mins` | refused: "mins" is not a unit. Did you mean min? | 120.00 mins |
| `90 minutes in hr` | refused: "hr" is not a unit. | 1.50 hr |
| `$15/hr * 37.5 hrs` | error: Undefined variable: hr | $562.50 |
| `1hr 30min` | error: Unexpected token after expression: "30" | 90.00 min |
| `1hr30min` | 90 minutes | 90 minutes |

The abbreviations are added by the table generator from a short, justified list, at the ratio of the unit each one names, so `hr` agrees with `h` to the bit. It checks that `convert`, the package the table is mirrored from, still lacks each one, so an upstream release that adds a spelling fails the generator rather than leaving two definitions. They are lower case only, as every unit spelling is, so `HR` and `Hrs` stay names.

**The micro sign is admitted.** The tables spell every micro unit with both characters a keyboard gives for the prefix, the micro sign (U+00B5) and the Greek small letter mu (U+03BC), but the lexer admitted only ASCII spellings, so `5 µs`, `5 µm` and `250 µg` were all undefined variables while `5 microseconds` worked. A leading micro sign on a spelling the table has is now read as the unit.

| line | before | now |
| --- | --- | --- |
| `5 µs in ns` | error: Undefined variable: µs | 5,000.00 ns |
| `5 μs in ns` | error: Undefined variable: μs | 5,000.00 ns |
| `3 µm in nm` | error: Undefined variable: µm | 3,000.00 nm |
| `250 µg in mg` | error: Undefined variable: µg | 0.25 mg |
| `5 µs + 1 ms` | error: Undefined variable: µs | 1,005.00 µs |

A micro unit as a conversion target already worked (`1 mL in µL` gave 1,000.00 µL), because the word after `in` is read as a unit name directly. `us` is not read as microseconds, because it is also an ordinary word, and a micro sign on anything the table does not spell (`5 µx`) is still an undefined variable.

**A variable with one of these names.** A unit spelling has always been read as a unit when it stands straight after a value, and as your variable where a name stands on its own. The new spellings follow that rule, so two documents that used one as a variable after a value now read the unit, as `h` already did:

| document | before | now |
| --- | --- | --- |
| `hr = 2` then `$15/hr` | $7.50 | 15.00 USD/hr |
| `mins = 4` then `30 mins` | 120 | 30.00 mins |
| `hr = 2` then `hr * 3` | 6 | 6 |
| `h = 2` then `$15/h` | 15.00 USD/h | 15.00 USD/h |

Both passes agree on every line above. After a slash with a plain value before it, a defined variable is divided by, for every unit spelling and these seven with them (#642, in its own entry): with `hr = 2`, `30 / hr` is 15.

**A misspelt target is offered units of the same measure.** With `mins` in the table, `5 km in mies` would have offered `miles or mins`, since both are one letter away. Converting from a unit, the refusal now names only the near spellings that measure the same thing, when there are any: `5 km in mies` still offers `miles`, and `5 kg in mies`, with no mass that close, offers both.

The boundary: `m` is still metres outside a compact duration, and `mo` and `d` are unchanged. `60 mph for 2 hours` and `5 ms to ?` fail the same way with the new spellings as with the old, which is a separate question. The time page gains a short-spellings section and the converting-units page a section on the micro sign, both with proven examples, and the unit reference lists the new spellings and the micro ones it could not list before.

## Verification

`Issue666_timeAbbreviations.spec.ts` has 134 tests: each abbreviation after a number, after a slash and as a conversion target, agreeing with the unit it names to the bit; the compact forms; the micro sign in both characters, as a prefix only; a rate's count keeping a symbol singular; what did not change (`30 min`, `2 wk`, `90m`, capitals, `sec(1)`); a variable of the same name at the start of a line, after a value and as a global, through both document passes; prose; the suggestion filter, with direct tests of `unknownUnitError`; and an adversarial sweep of nine forms over each spelling, answered honestly. `ConvertParity.spec.ts` checks each added spelling against the upstream unit it names in every sweep, and pins the seven as the only additions; `UnitVocabulary.spec.ts` pins the micro sign. The unit reference is regenerated and `lint:units` passes.

The engine suite is 15,164 tests in 602 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including `lint:units`, the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.
