---
"solve-engine": patch
---

An aggregate refuses a value that is not a number, and `min` and `max` of dates give the date

The list aggregates read every operand without a unit as a number, and a value with no numeric reading was read as whatever it happened to convert to. Text became 0 through `parseFloat`, so `total of "Travel"` in a note with a Travel section reported nothing spent. A date became its epoch milliseconds, and a bracketed list or a colour became 0. Each is now refused by name, with `AGGREGATE_NON_NUMERIC`, and the message points at what was probably meant.

| expression | before | now |
| --- | --- | --- |
| `total of "Travel"` | 0 | error: text cannot be added; tag the lines and use `total of #tag` |
| `average of "a", 4` | 2 | error: text cannot be averaged |
| `total of [1, 2, 3]` | 0 | error: a bracketed list; list the values with commas |
| `total of 1:3` | 1,790,121,780,000 | error: a date or time cannot be added |
| `standard deviation of "a", 2, 4` | 1.63 | error: text cannot be used in a standard deviation |
| `larger of "a" and 3` | 3 | error: text cannot be compared |
| `max(25/12/2026, 1/1/2027)` | 1,798,761,600,000 | Friday, January 1, 2027 |

The forms covered are `total of`, `average of`, `median of`, `spread of`, `mode of`, the standard deviations and variances, `min`, `max`, `larger of` and `smaller of`. Numbers, quantities, percentages, booleans (as 1 and 0), hex and big integers are read as before, and `count of` counts anything, text included.

`min` and `max` of a set made only of dates now return the earliest or latest date itself, which is the answer the question has; a date among plain numbers is refused like any other non-number. The `total above` and `total of #tag` forms already refused a non-numeric line and are unchanged.

The boundary: a bracketed list is refused rather than expanded into its members, and a quoted name is refused rather than read as a section heading. Totalling a section by its heading is the section addressing feature, #508. `mode of` on text, where the most frequent word would be an answer, is refused for now rather than given a numeric mode of zero.

## Verification

A new suite pins the reported document, every aggregate's refusal, the named kinds and hints, the forms that still answer, and `min`/`max` over dates. The statistics and number-functions pages gain the refusals and the date answer as proven examples. An A/B run of 3,863 expressions against the previous build differed only on random functions. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
