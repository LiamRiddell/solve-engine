---
"solve-engine": minor
---

Misconfiguration is named when the engine is built: an unknown option, config section or setting, a package with no name, a parselet that can never run, and `expectPackage(...).toBeWellFormed()`

Each of these was a mistake the engine could see when it was built, and each was accepted without a word, to fail at the first line that tripped over it or never (#719). The one that mattered most: a host that wrote `createEngine({ network: { enabled: false } })` believed live data was off, while every place name and currency pair still went to the public endpoints.

| mistake | before | now |
| --- | --- | --- |
| `network: { enabled: false }` at the top level | ignored; live data on | warns that `network` belongs under `config` |
| `config: { validaton: ... }` | ignored | warns, naming `validation` |
| `config.validation.maxExpresionLength` | ignored | warns, naming `maxExpressionLength` |
| `seed: 42` | ignored | warns that it belongs under `random: { seed }` |
| two packages with no name | the second unregistered the first | each refused with `PACKAGE_NAME_MISSING` |
| a prefix parselet for `NUMBER` | warned that the new parselet "silently wins" | warns that the new parselet never runs |

The option checks are warnings, naming the nearest real key or where the option belongs. A package's name is checked at registration, before anything is written. The two warnings for a parselet on a token the parser reads on its own fast path said the opposite of what happens, since the parser takes that token before it consults the registry; both now say the new parselet never runs, and an overwrite anywhere else still says the new parselet replaces the old.

`expectPackage(pkg).toBeWellFormed()` in `solve-engine/testing` checks a package before it ships, and reports every problem at once: it has a name and registers; no parselet claims a fast-path token; every token type of its own has a `tokenCategories` entry; no keyword, operator, phrase or call is keyed to one token while its parselet waits for another; and every plugin function a parselet calls by name is declared, found by compiling the package's own words in the shapes a line puts them in. Run over the built-in packages it found 44 token types with no highlighting category, among them `CLOCK_TIME`, the `TAG_` and `TABLE_COLUMN_` aggregates and the weather phrases, which an editor left unstyled; each now has one.

The boundary: validation checks shape, not intent. It does not decide whether a collision was meant, and an unknown option is a warning rather than a refusal, since a host typed against a newer release may pass an option an older engine does not know. `toBeWellFormed` sees a plugin call only in the shapes it compiles, so an expression test is still the proof that a form works, and a token read inside another parselet's grammar (the `and` of `between X and Y`) is not reported. The built-in packages keep their parselets on fast-path tokens, registered for introspection. The embedding guide describes the warnings, and the testing guide describes `toBeWellFormed`.

## Verification

`Issue719_misconfiguration.spec.ts` holds 25 tests: each misplaced option, section and setting named with the nearest real one, every real option and optional setting passing without a word (with a spec reading `Configuration.ts` so a new optional setting cannot be reported as unknown), nameless packages and orphaned resolvers refused by code, and every built-in package well formed.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
