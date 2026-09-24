---
"solve-engine": patch
---

Every built-in package is exported from `solve-engine/packages`, and `errorValue` from `solve-engine/vm`

Each syntax page names its package and says to register it explicitly for a slimmer engine, but 21 of the 41 packages it names had no export, so a host building a slim engine could not include them. Two, `PAYROLL_PACKAGE` and `SHOPPING_PACKAGE`, were not even exported from the module that assembles `BUILTIN_PACKAGES`. The plugin function guide also imported `errorValue` from `solve-engine/vm`, which did not export it, so its worked example did not compile.

| import | before | now |
| --- | --- | --- |
| `import { GOALSEEK_PACKAGE } from "solve-engine/packages"` | undefined | the package |
| `import { PAYROLL_PACKAGE } from "solve-engine/packages"` | undefined | the package |
| `import { errorValue } from "solve-engine/vm"` | undefined | the function |

The others now exported are the chart, colour, constants, cooking, encoding, geometry, coordinates, hash, health, IP, numerals, random, ratio, shopping, statistics, text, travel, uncertainty and web packages. Nothing changes for a host that uses `createEngine()`, which registers all of them already.

The boundary: this adds exports and removes none. A new spec ties the list to the docs, so a package a syntax page names without an export fails the build.

Fixes #556 and #557.

## Verification

A new spec checks that every package a syntax page names, and every package in `BUILTIN_PACKAGES`, is exported from `solve-engine/packages`, and that `errorValue` is exported from `solve-engine/vm`. Every value import in the docs' TypeScript examples was checked against the built entry points. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
