---
"solve-engine": minor
---

A host can tell that a package failed to register: `strict`, `onPackageError` and `getRegisteredPackages()`

A package that throws while it registers (an `engineVersion` range the engine does not satisfy, a keyword a built-in already owns) was skipped by the constructor with a console error, and nothing a host could call said so: the list of registered packages was private (#718). A host that shows the reader no console met the missing package as a parse error on every line that used it.

| `createEngine({ extraPackages: [oldContract], ... })` | before | now |
| --- | --- | --- |
| default | built without it; a console error | built without it; a console error, as before |
| `strict: true` | not an option | throws `PACKAGE_ENGINE_VERSION_MISMATCH` |
| `onPackageError: (pkg, error) => ...` | not an option | told `old-contract: PACKAGE_ENGINE_VERSION_MISMATCH`; the rest register |
| `engine.getRegisteredPackages()` | private | the names that registered, in order |

A strict engine throws the package's coded `EngineError`, and a callback is told of each failure once, in order, while later packages still register. A strict engine, and one whose callback throws, unregisters the packages it had already registered before throwing, so nothing is left in the registries engines share. `getRegisteredPackages()` returns a copy, and a package unregistered leaves it.

The boundary: the default containment is unchanged, so one bad third-party package still cannot take the whole engine down. `strict` covers registration throws only; collisions between packages that only pick a winner stay warnings, since a package may replace a built-in's grammar on purpose. The mistakes that never throw are the misconfiguration change that ships beside this one. The embedding and package-authoring guides describe both options.

## Verification

`Issue718_strictRegistration.spec.ts` holds 10 tests: a strict engine throwing the package's coded error and leaving nothing in the shared registries, `onPackageError` told of each failure in order, `getRegisteredPackages` listing what registered, and the default unchanged.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
