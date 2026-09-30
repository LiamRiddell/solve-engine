---
"solve-engine": patch
---

The unit reference lists every spelling `ExtendedUnits.ts` defines, including the five spread from a list and the ones written as quoted keys

The generator read `ExtendedUnits.ts` one `key: { measure, toBase }` line at a time (#782), so the spellings of miles per imperial gallon, spread into the table from `IMPERIAL_MPG_SPELLINGS`, were accepted by the engine and missing from the page that claims to list every spelling. A test written to catch that found a second gap: a spelling with a space is a quoted key (`"US cup": { ... }`), and those were left out too. `scripts/lib/extended-units.mjs` now reads bare keys, quoted keys and a spread of a list with a shared definition, and fails the run on a spread of any other shape, or one that names a list or a constant the file does not export.

| row | before | now |
| --- | --- | --- |
| miles per imperial gallon | missing | `mpg imperial`, `imperial mpg`, `mpg uk`, `mpg UK`, `UK mpg`, headed "mile per imperial gallon" |
| US cup | `cups` only | `cups`, `US cup`, `US cups` |
| metric cup, imperial cup, typographic point | missing | listed, with their plurals |
| knot | `kn` | `kn`, `knots` |

The boundary: only the page changes, not which spellings the engine accepts. A ratio is still read without evaluating the file's text, and a named constant is read only when a spread uses it.

## Verification

`Issue782_spreadSpellingsListed.spec.ts` (14 tests) holds that every spread spelling is read at its ratio, that the reader finds exactly the keys `EXTENDED_UNITS` has, spread or not, and that the page lists the spread row; unit tests of `readExtendedEntries` and `ratioValue` with a spread, a quoted key, a constant, an unknown spread shape, an undefined list, an empty file and list, prototype words as spellings, code- and markup-shaped ratios, zero, a negative and a constant that names itself. The page was regenerated with `npm run stats:units` after `npm run build`, and `npm run lint:units` passes.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
