---
"solve-engine": minor
---

Miles per imperial gallon can be written: `35 mpg imperial in l/100km` is 8.07 l/100km, and the trip recipe reads its UK figure in imperial gallons

A UK brochure quotes fuel economy in miles per imperial gallon, and `mpg` is miles per US gallon. There was no way to say the other one: the word after `mpg` was taken by the cooking form as an ingredient, so `35 mpg imperial` was refused with a message about mass and volume, and the trip recipe paired `35 mpg` with a price in pounds per litre, understating the fuel by about a sixth (#736).

| line | before | now |
| --- | --- | --- |
| `35 mpg imperial in l/100km` | `"mpg" is not a recognized mass or volume unit` | 8.07 l/100km |
| `35 mpg uk in l/100km` | `"mpg" is not a recognized mass or volume unit` | 8.07 l/100km |
| `35 UK mpg in l/100km` | throws `Undefined variable: UK` | 8.07 l/100km |
| `8.07 l/100km in mpg imperial` | throws `Unexpected token after expression: "imperial"` | 35.00 mpg imperial |
| `35 mpg imperial in mpg` | `"mpg" is not a recognized mass or volume unit` | 29.14 mpg |
| `fuel for 300 miles at 35 mpg imperial` | throws `Unexpected token after expression: "imperial"` | 38.97 litre |

`mpg imperial`, `imperial mpg`, `mpg uk`, `mpg UK` and `UK mpg` are one fuel-economy unit of 1.609344 km per 4.54609 litres, joined by the multi-word unit rule and shown as written. Each converts both ways like `mpg`, through `km/l` and the reciprocal `l/100km`, and cancels in unit algebra against the imperial gallon it is per (`300 miles / 35 mpg imperial` is 8.57 imperial gallons). The travel forms read it: the trip recipe's British car is now `35 mpg imperial` at £1.50 a litre (£58.45, where US gallons gave £48.67), its American car keeps `35 mpg` at a price per US gallon, and the fuel-economy and travel pages name which gallon each spelling means.

The boundary: a bare `mpg` stays the US gallon, the documented convention, and no gallon is chosen from the reader's locale. The cooking form's claim on any word after a quantity is wider than this and is left as it was: `35 mpg foo` still reaches it and is refused there. `uk` is read in both cases.

## Verification

`Issue736_imperialMpg.spec.ts` holds 40 tests: every spelling in `l/100km`, both directions, `km/l`, the travel forms and unit algebra; what must not break (`mpg`, `l/100km`, a real ingredient conversion, `uk` and `UK` as names); unit tests of the ratio, the spellings, `convertUnit`, `convertRate`, `rateForm`, `isNamedRate` and the trip arithmetic, including zero and negative economies; and adversarial cases (prototype words after `mpg`, which also led `rateForm`, `isNamedRate` and the fuel-rate lookup to read own properties only, text edges, markup, a two-thousand-term sum, a named economy with a what-if and a check, a typo, the numeric edges).

The full suite (`npm run test:full`) passed, 17,821 of 17,825 tests in 634 suites with 4 skipped, including the proven docs examples. `npm run typecheck`, `lint:comments`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:dispatch-size` are clean, and the generated unit reference is regenerated for the new spellings.
