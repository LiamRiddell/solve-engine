---
"solve-engine": minor
---

Every error code the engine and its built-in packages raise is catalogued, exported, documented on a generated reference page, and kept whole by a lint (#769)

An error code is the short fixed name the engine gives a kind of failure (`INCOMPATIBLE_UNITS`, `UNEXPECTED_END_OF_INPUT`), for the program showing a note rather than the person reading it: a host branches on it to underline a line, offer a fix or count failures. A host could only learn the codes by meeting them. `INCOMPATIBLE_UNITS`, which the quick start teaches a host to read, was in no exported list, and 221 of the 251 codes the source raised were in none, so a host had no way to check a code it had written into its own program, and nothing stopped a code being renamed.

Every code is now in a catalogue: an exported `as const` object with a sentence on each code saying when it arises. The engine's own are in `CoreErrorCodes`, in sections by the part of the engine that raises them, and each built-in package has its own (`MatrixErrorCodes`, `TablesErrorCodes`, `UomErrorCodes`). `solve-engine/packages` exports them together, with a check for a code a host has met:

```ts
import { ERROR_CODE_CATALOGUES, isCataloguedErrorCode } from "solve-engine/packages";

ERROR_CODE_CATALOGUES.CoreErrorCodes.INCOMPATIBLE_UNITS; // "INCOMPATIBLE_UNITS"
isCataloguedErrorCode("INCOMPATIBLE_UNITS");             // true
isCataloguedErrorCode("CRYPTO_QUERY_FAILED");            // true: a run-time pattern
isCataloguedErrorCode("NOT_A_CODE");                     // false
```

| | before | now |
| --- | --- | --- |
| codes a host can look up | 30 of 251, in a few package catalogues | 506, in 52 catalogues, and 2 run-time patterns |
| `INCOMPATIBLE_UNITS` | in no exported list | `ERROR_CODE_CATALOGUES.CoreErrorCodes.INCOMPATIBLE_UNITS` |
| a reference a person can read | none | [Error codes](/guide/error-codes/), each code with when it arises and whether it arrives thrown, as a value, or either |
| a code raised that no catalogue lists | nothing noticed | `npm run lint:error-codes` fails, in `verify:ci` and the CI docs job |
| a code renamed or removed | nothing noticed | a snapshot test fails |

The reference page is generated from the catalogues' doc comments (`npm run docs:error-codes`), and the lint fails when the two differ, so the page cannot drift from the source. A code built at run time from a data source's name, `<NAMESPACE>_QUERY_FAILED` for a resolver made with `createQueryResolver`, is listed as a pattern, which `isCataloguedErrorCode` matches.

`DatetimeErrorCodes` in the core error module is renamed `DatetimeZoneErrorCodes`, since the date-reading package exports a catalogue of the same name and the catalogue keys each list by its export name. It holds the date codes raised outside the date package: the time zone codes, and the calendar's weekday check. The old export was not reachable from a public entry point, so no host import changes.

The boundary: a catalogue lists what the engine ships. A package from outside this repository can answer with codes of its own, and `isCataloguedErrorCode` answers `false` for them, which is not a fault; the [functions and operators guide](/packages/functions-and-operators/) says how a package author names and exports theirs. A code a host can receive keeps its name from now on, as [versioning and support](/guide/versioning-and-support/) says, so the list only grows; its message may still be reworded in a patch.

## Verification

Four specs guard the catalogue. `ErrorCodeCatalogueSnapshot.spec.ts` (11 tests) fails on a code renamed or removed, and on one added without being added to the snapshot, and tests `isCataloguedErrorCode` against inherited property names, look-alike characters, a huge string and a value that is not a string. `ErrorCodeReachability.spec.ts` (379 tests) gives every catalogued code either a line that produces it, checked on each run, or a stated reason no line can (a host API refusal, a package-authoring fault, live data, an engine invariant). `ErrorCodesCheck.spec.ts` (16 tests) runs the lint over fixtures: an uncatalogued code, a template that matches no pattern, an entry with no doc comment and a stale page each fail it. `Issue769_errorCodeCatalogue.spec.ts` (6 tests) fills twenty-two forms across the packages with the numeric, text and prototype edges, and runs the document edges through both passes, and every code that reaches a host is catalogued.

The full suite (`npm run test:full`) passed, 18,768 of 18,772 tests in 653 suites with 4 skipped, with `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:error-codes`, `lint:stats`, `lint:size` and `lint:units`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
