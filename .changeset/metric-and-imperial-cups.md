---
"solve-engine": minor
---

The metric and imperial cups can be written: `1 metric cup in ml` is 250 ml, `1 imperial cup in ml` is 284.13 ml, and `US cup` names the default

`cup` is the US customary cup, and the only other cup was the US legal cup, so a recipe from Australia, New Zealand or Canada (the metric cup) or an older British one (the imperial cup, half an imperial pint) could not be converted as written: `metric` and `imperial` were undefined variables, and the cooking page never said which cup `cup` is (#752).

| line | before | now |
| --- | --- | --- |
| `1 metric cup in ml` | throws `Undefined variable: metric. Did you mean metre or metres?` | 250.00 ml |
| `1 imperial cup in ml` | throws `Undefined variable: imperial` | 284.13 ml |
| `1 US cup in ml` | throws `Undefined variable: US` | 236.59 ml |
| `2 metric cups flour in grams` | throws `Undefined variable: metric. Did you mean metre or metres?` | 265.00 grams |
| `1 1/2 metric cups in ml` | throws `Undefined variable: metric. Did you mean metre or metres?` | 375.00 ml |
| `300g butter in metric cups` | `"metric" is not a recognized mass or volume unit` | 1.25 metric cups |

Each is a volume unit of two words, singular and plural, joined by the multi-word unit rule the way `imperial pint` already was, so it takes a mixed number, an ingredient and a conversion like any other volume. The imperial cup is exactly half the imperial pint (`2 imperial cups in imperial pints` is 1.00), and `US cup` is the table's own `cup`. The cooking page now says which cup is which, with the spellings.

The boundary: a bare `cup` stays the US cup, since changing it would move every recipe answer already written. `US` is upper case only (`us` is an English word), and `metric` and `imperial` on their own stay ordinary words and names (`metric = 5` is a variable). The cup is not chosen from the reader's locale, and the metric tablespoon and teaspoon are not spelled; `tbsp` and `tsp` remain the US spoons.

## Verification

`Issue752_metricAndImperialCups.spec.ts` holds 46 tests: each cup's size and plural, the ingredient conversions and mixed numbers, what must not break (`metric ton`, `imperial pint`, `US legal cup`, `c`, the US cup and prose), unit tests of the extended entries, the derived multi-word list, the lexer vocabulary and the multi-word rule (ordinary, spacing, case, a qualifier after a name, prototype words), and adversarial cases from the three sides (prototype words in the qualifier's place, look-alike characters, markup, a two-thousand-term sum, a value from the line above with a check and a what-if, the numeric edges, CRLF). `AdversarialFeatureSweep.spec.ts` gains the qualified-unit forms. `UnitConversionInvariants.spec.ts` now names the cubic metre as the base an extended volume states its ratio in.

The fast suite (the `npm run test:ci` run) passed, 15,949 of 15,953 tests in 617 suites with 4 skipped, and the suites it leaves out passed on their own under the full configuration: `LexerFuzz`, `LexerVocabularyFuzz`, `LongDocumentRobustness` and `heavy/MemoryLeak`. `npm run typecheck`, `lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` are clean, and the proven docs examples pass. `lint:units` was not run, since it reads the built package; the generated unit reference needs regenerating for the new spellings.
