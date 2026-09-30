---
"solve-engine": patch
---

A conversion asked the other way round reads every unit a conversion reads: `km in 1 furlong`, `mW in 1 W`, `USD in 1 EUR`

The reversed form (`km in 1 mile`, how many of the first unit make one of the second) lower-cased the unit and looked it up in the generated unit table alone, so an extended unit such as the furlong or the carat, a currency, and a unit whose case matters were each refused with `Unexpected token after expression: "1"` (#825). It now asks the same case-sensitive question the rest of the unit system asks (`namesAUnit`), so `mW` is the milliwatt and `MW` the megawatt. Separately, the "did you mean" for an undefined name offered a unit spelling the lexer leaves out as ordinary English: `1 turn` suggested `turns`, and `1 turns` suggested `turn`, each of which fails the same way. It now searches only the spellings the lexer reads as a unit.

| line | before | now |
| --- | --- | --- |
| `km in 1 furlong` | throws `Unexpected token after expression: "1"` | 0.20 km |
| `g in 1 carat` | throws `Unexpected token after expression: "1"` | 0.20 g |
| `mW in 1 W` | throws `Unexpected token after expression: "1"` | 1,000.00 mW |
| `MHz in 1 GHz` | throws `Unexpected token after expression: "1"` | 1,000.00 MHz |
| `1 turn` | `Undefined variable: turn. Did you mean turns?` | `Undefined variable: turn` |
| `1 point` | `Undefined variable: point. Did you mean pint or points?` | `Undefined variable: point. Did you mean pint?` |

The boundary: the form is as narrow as it was. The line must start with the unit, and what follows `in` must be a plain amount and a unit (or `a`/`an`), so `days in February 2020` is still its own question and a signed amount (`km in -1 mile`) is not read this way. A conversion target still suggests from the whole unit table, since an excluded spelling such as `points` is read as a unit after `in` (`1 mm in points` is 2.83 points). `kcal` and `cal` are not units at all today, so `kJ in 1 kcal` is refused as before; adding them is not part of this. The converting-units page gains a section on the reversed form.

## Verification

`Issue825_reversedConversionUnits.spec.ts` holds 43 tests: the reversed form with an extended unit, a case-sensitive unit and a currency at a primed rate, each agreeing with the forward form; the rule's own `isReversibleUnit` over ordinary, wrong-case, non-unit-token and inherited-property arguments; every excluded spelling, its plural and its stem checked never to be suggested; `typeableUnitNameIndex` holding only lexed spellings; and the adversarial cases (prototype words as either unit, look-alike and markup-shaped text, a long line, the numeric edges as the count, a value from the line above through both document passes). `AdversarialFeatureSweep.spec.ts` gains the reversed form's template.

The fast suite (`npm run test:ci`) passed, 15,959 of 15,963 tests in 617 suites with 4 skipped, including the proven docs examples, and `npm run lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, with the engine and its specs type-checked by `tsc --noEmit`.
