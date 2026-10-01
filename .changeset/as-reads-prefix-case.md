---
"solve-engine": patch
---

`as` reads a unit's prefix in its own case: `5 W as mW` is 5,000 milliwatts, where it was five millionths of a megawatt

`as` lower-cased its target before looking the converter up, and the derived units were registered under lower-case names, so `mw`, `mj` and `mpa` could only mean the megawatt, the megajoule and the megapascal. A prefix is carried by its case (`m` is milli, `M` mega), so every milli target through `as` answered in mega, while `in` read the same spelling correctly (#824). The same folding reached `in` through the rule that sends `in <converter>` to `as`: `1 V in MV`, a unit the table does not spell, answered in millivolts.

| line | before | now |
| --- | --- | --- |
| `5 W as mW` | 5e-6 MW | 5,000.00 mW |
| `5 J as mJ` | 5e-6 MJ | 5,000.00 mJ |
| `5 Pa as mPa` | 5e-6 MPa | 5,000.00 mPa |
| `5 MW as mW` | 5.00 MW | 5,000,000,000.00 mW |
| `1 W as pW` | `Unknown converter "as pw"` | 1,000,000,000,000.00 pW |
| `1 V in MV` | 1,000.00 mV | `"MV" is not a unit.` |
| `5 W as mw` | 5e-6 MW | `"as mw" could be "as mW" or "as MW": write the unit with its prefix in its own case (m is milli, M is mega, p is pico, P is peta)` |

The converter registry now keeps a name registered with capitals in its own spelling beside the lower-case key, and `as` tries the target as typed first. A lower-case spelling that two names share (`mw` for `mW` and `MW`) is refused by name (`AS_CONVERTER_AMBIGUOUS_CASE`), and one that would turn a prefix into another (`MV` when only `mV` exists) is refused too (`AS_CONVERTER_PREFIX_CASE`), rather than read as either. The derived units register every prefix the unit table spells before the newton, joule, watt, watt-hour and pascal (pico to peta), and the millivolt and kilovolt, so `as` and `in` agree on each.

The boundary: a letter that is not a prefix still folds, so `as n` is the newton and `as KWH` the kilowatt-hour, and a converter whose name is a word (`as ISO8601`, `in ROMAN`) is matched without regard to case as before. `u` is not read as `µ`: `as uW`, like `in uW`, is not a unit. A package that registers only lower-case names sees no change; the as-converters guide now says how a capitalised name is matched.

## Verification

`Issue824_asPrefixCase.spec.ts` holds 41 tests: the issue's lines; each `m`/`M` and `p`/`P` pair before the watt, joule, pascal, newton and watt-hour through `as` and `in`, agreeing; every prefix before each; the refusals and the folds that stay; the registry's parts (a case pair, re-registration by a new engine, unregistering one of a pair, the lower-case collision, prototype words); both document passes and one engine's compile cache; and the adversarial cases (prototype words and look-alike prefixes, a value from the line above, and the numeric and text edges). `AdversarialFeatureSweep.spec.ts` gains the five forms over the numeric edges. The packages, hardening, bugs, lexer, explain, coverage and integration suites passed (10,912 tests in 401 suites), and the proven docs examples passed.
