---
"solve-engine": minor
---

A package can declare words for units the engine already has, and a unit a document defines is a conversion target

A language package needs to say that a word in its language means a unit the engine already has, `Meile` for the mile, and no package field declared that (#762). `lexerVocabulary.units` adds a spelling with no meaning, so `2 Meile in km` was refused as two things that do not measure the same, and a hand-written normaliser rule converted into the word but not from it, answering under the base unit. A document's own definition expanded its name only after a number, rewriting it as a ratio times the base unit, which has no meaning as a target, so `84 days in sprints` said sprints is not a unit.

`IEnginePackage.unitAliases` maps each word to a unit the engine reads (`{ Meile: "mile", Tage: "days" }`). A new normaliser rule, `uom:unit-alias`, reads an alias where a unit is read, after a value and after `in`, `into` or `to`, and the `uom:user-unit` rule now reads a document's unit in both places too. Either way the quantity stays in the unit it stands for, so it converts and adds as that unit does, and a unit label (`Value.unitLabel`, a name and how many of the unit one of it is) writes the answer under the word the reader typed. A definition of exactly one unit is a rename, and a quantity written in it is shown under the name. Rounding to a number of places rounds the count the reader sees and keeps the name.

| line | before | now |
| --- | --- | --- |
| `5 km in Meile` (with `1 Meile = 1 mile`) | "Meile" is not a unit. Did you mean mile? | `3.11 Meile` |
| `84 days in sprints` (with `1 sprint = 2 weeks`) | "sprints" is not a unit. Did you mean pints or points? | `6 sprints` |
| `84 days in sprint` | "sprint" is not a unit. Did you mean pint or point? | `6 sprint` |
| `3 Tage` (with `1 Tage = 1 day`) | `3 day` | `3 Tage` |
| `2 Meile` (package alias) | `2.00 Meile`, which did not convert | `2.00 Meile` |
| `2 Meile in km` (package alias) | Cannot convert Meile to km | `3.22 km` |
| `5 km in Meile` (package alias) | "Meile" is not a unit | `3.11 Meile` |
| `6 sprints in kg` | a duration cannot be converted to a mass | a duration cannot be converted to a mass |

Registration refuses an alias the engine could never read, a word it already reads as a unit, a keyword or a function, with `PLUGIN_UNIT_ALIAS_UNREACHABLE`, and a target that is not a unit it reads with `PLUGIN_UNIT_ALIAS_TARGET_UNKNOWN`. Two packages aliasing one word is a compatibility warning, the later is in force, and unregistering it hands the word back. The new package guide, [Words for units](/packages/unit-aliases/), walks through the field with a proven table, the routing table in [authoring a package](/packages/authoring-a-package/) gains its row, and [defining your own units](/syntax/custom-units/) gains the conversion-into form.

The boundary: an alias is read after a value and as a conversion target, never mid-sentence, and it is matched exactly, with no plural guessed; a document's plural is still its name with one `s` added, so `3 Wochen` after `1 Woche = 1 week` is refused. Arithmetic on a labelled quantity answers in the unit it stands for (`2 Meile * 2` is `4.00 mile`), and an alias is not read inside a compound unit. This is the mechanism, not the word lists: the German and French packs declare no aliases yet, which is the 3.0 language packs' work.

## Verification

`Issue762_unitAliases.spec.ts` holds 142 tests: the issue's twelve lines through both passes, every row of the guide's table, unit tests of `UnitAliasTable`, `unitAliasRule`, the extended `userUnitExpansionRule`, `unitLabelToken` and `labelQuantity` with ordinary, boundary and hostile arguments, the label through formatting, JSON, the worker DTO and a snapshot (and a malformed one refused), registration's refusals and hand-back, and the adversarial cases (prototype words as aliases and as a document's unit, markup-shaped and look-alike words, a thousand aliases, an alias beside a variable and in prose, a document's definition over a package's, a plural, a unit that does not fit, a check, a tag and a what-if through it, an edit to a definition, the numeric edges, negative zero, a decimal-comma ratio, CRLF). `CrossPathDocumentFeatures.spec.ts` gains the conversion-into form through both passes, a live edit, a deletion and the single-line refusal, and the adversarial sweep gains its templates.

The full suite (`npm run test:full`) passed, 23,820 of 23,824 tests in 709 suites with 4 skipped, as did `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords` and `lint:dispatch-size` (`executeBytecode` at 46,484 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
