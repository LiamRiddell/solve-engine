---
"solve-engine": minor
---

Add constants and health helpers (issues #256, #257).

Two utilities to round out the everyday-maths set, each its own on-by-default,
removable package.

## Constants

Named physical and mathematical constants, reached by name. Where a constant has
a unit it arrives as a proper quantity, so it converts and takes part in unit
arithmetic.

| expression | result |
| --- | --- |
| `speed of light` | `299792458.00 m/s` |
| `gravity` | `9.81 m/s²` |
| `gravity * 70 kg as N` | `686.47 N` |
| `tau` | `6.28` |
| `golden ratio` | `1.62` |

`gravity` is an acceleration, so gravity times a mass composes to a newton
through the 2.8.0 derived-unit algebra. Also included: `avogadro`, `planck`,
`boltzmann`, `elementary charge`, `gas constant`, `electron mass`, `proton mass`.
`pi` and `e` already exist and are untouched.

## Health

Everyday health and fitness sums, as functions with the numbers in the stated
units (kilograms and metres, or kilometres and minutes).

| expression | result |
| --- | --- |
| `bmi(70, 1.75)` | `22.86` |
| `pace(10, 50)` | `5:00 /km` |
| `speed(10, 50)` | `12.00 km/h` |

`pace` and `speed` are the two ways of reading the same effort: time per
distance, and distance per time.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
constants and health pages are proven live). New tests:
`packages/constants/Constants.spec.ts` and `packages/health/Health.spec.ts`.
