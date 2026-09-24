---
"solve-engine": patch
---

A refusal names a measure in words, not by its table key

The unit tables key every two-word measure as one camelCase token, and a refusal dropped the key into its sentence as it was: `2 mpg * 3 m` answered "fuelEconomy and length cannot be multiplied". Every measure now has a reader's name, so the same sentence reads "fuel economy and length cannot be multiplied".

| expression | before | now |
| --- | --- | --- |
| `2 mpg * 3 m` | fuelEconomy and length cannot be multiplied | fuel economy and length cannot be multiplied |
| `2 Mbps + 3 kg` | dataRate and mass cannot be added | data rate and mass cannot be added |
| `2 px in m` | a cssLength cannot be converted to a length | a CSS length cannot be converted to a length |
| `2 l100km in kg` | a fuelConsumption cannot be converted to a mass | fuel consumption cannot be converted to a mass |
| `2 ppm * 3 kg` | partsPer and mass cannot be multiplied | proportion and mass cannot be multiplied |
| `2 kvar in m` | a reactivePower cannot be converted to a length | a reactive power cannot be converted to a length |
| `2 lpm + 3 m` | volumeFlowRate and length cannot be added | volume flow rate and length cannot be added |

The names come from one table beside the existing ones for a duration and a luminous intensity, and a measure added later without an entry is split into lowercase words rather than printed as its key. The fuel price check in the travel package names the measure the same way. Only the wording of a refusal changes: every error code is unchanged, so a host that branches on the code is unaffected.

The boundary: the measure a completion item carries as its `detail` is still the table key (`fuelEconomy`), because it is data a host may match on rather than a sentence, and changing it is an API change of its own.

Fixes #571.

## Verification

A new suite names every measure in both unit tables through its representative unit, checks that the table of representatives covers every measure so a new one cannot slip past, and sweeps sums, products and conversions of each against a length and a mass, asserting that no refusal contains a camelCase measure key. `npm run verify:ci` passes: 11,356 tests across 526 suites, with the bundled-consumer contract.
