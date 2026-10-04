---
"solve-engine": minor
---

The German and French packs add their words to English rather than replacing them, their function names run, and French converts with `en`

A language pack's keyword table replaced the English one, so a German engine read `mal` and no longer read `times`, `of`, `sqrt`, `round`, `true` or `if`, and a French engine had no word for a conversion at all (#833). The German pack listed `wurzel`, `runden`, `aufrunden` and `abrunden` as function names, but the table a call is dispatched through knew only English names, so each was read as a call and refused as an unknown function. And the German pack read `in` as `TO`, which converts a unit alike, while a zone conversion asks for `IN` by type, so `3pm London in Tokyo` was refused naming the word it received.

A pack's table is now every English keyword with the pack's own words beside it (`withEnglishKeywords`), and a pack names the built-in each of its function names runs (`ILocale.functionNames`). German reads `in` as English does. French gains `en` as its conversion word, and `racine`, `arrondi`, `plancher` and `plafond`; German's `kubikwurzel`, `zufall`, `zeichen` and `ganzzahl` run too.

| line | before | now |
| --- | --- | --- |
| `wurzel(16)` under `de` | Unknown function: wurzel | `4` |
| `sqrt(16)` under `de` | Undefined function: sqrt | `4` |
| `runden(7/2)` under `de` | Unknown function: runden | `4` |
| `3pm Tokyo in Dubai` under `de` | Expected "in <city>" after the zone name | `10:00 AM` |
| `3 times 4` under `de` | refused | `12` |
| `10% of 200` under `de` | refused | `20` |
| `if 1 > 0 then 1 else 2` under `de` | refused | `1` |
| `5 km in m` under `fr` | Unexpected token after expression: "in" | `5,000.00 m` |
| `5 km en m` under `fr` | Unexpected token after expression: "en" | `5,000.00 m` |
| `convertir 5 km en m` under `fr` | refused | `5,000.00 m` |
| `racine(16)` under `fr` | Undefined function: racine | `4` |

[Locales](/guide/locales/) is rewritten to match: its matrix of what each pack reads, which a spec proves cell by cell, now shows every English line reading the same under all three packs, with the pack's own names and conversion words beside them.

The boundary: every word a pack reads, in English or its own language, is a keyword under that pack and so no longer a variable name there, as `times` is not one in English; under `fr` that now includes `en` and the four function names. French `multiplier` keeps the pack's meaning, the verb, so the English `as multiplier` converter is not read under `fr`; it is the one word a pack spells like an English keyword with another meaning. A package's phrases and unit names stay English in every pack, and `map(wurzel, ...)` reads a function argument by its English name only. Rebuilding the packs as full translations is the 3.0 language packs.

## Verification

`Issue833_localePacksAddToEnglish.spec.ts` holds 172 tests: the issue's lines, every English built-in callable by name under `en`, `de` and `fr`, that no English keyword reads differently under a pack but the one listed, each pack's function names against the English one they run, a conversion and two zone conversions under each pack, unit tests of `withEnglishKeywords` and `builtinIndexFor` with ordinary, boundary and hostile arguments, and the adversarial cases (prototype words as calls and targets, the text edges, look-alike spellings, a deep nest, a German document through both passes, a check, a what-if, an explanation and a snapshot round trip, the numeric edges through `wurzel` and `racine`, and region tags). `Issue726_localesPage.spec.ts` proves the rewritten matrix, and two `FrenchLocale.spec.ts` guards that pinned the refused names now pin the answers. The adversarial sweep gains the pack's words over the numeric edges.

The full suite (`npm run test:full`) passed, 23,820 of 23,824 tests in 709 suites with 4 skipped, as did `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords` and `lint:dispatch-size` (`executeBytecode` at 46,484 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
