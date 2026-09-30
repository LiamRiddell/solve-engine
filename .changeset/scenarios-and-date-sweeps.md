---
"solve-engine": minor
---

Named scenarios are kept in a note and read with `line 3 under bull`, and a sweep steps a date: `line 3 for start from 2026-01-01 to 2026-04-01 step 1 month`

A what-if asks one question at a time, and a reader could not keep a bull case and a bear case in the note to read any line under either; a sweep stepped numbers, percentages and quantities, but not dates (#744). `scenario bull with price = $120, qty = 5` now declares a scenario, and `line 3 under bull` reads line 3 with its inputs in force. A sweep between two dates steps by a length of time.

| line | before | now |
| --- | --- | --- |
| `scenario bull with price = $120, qty = 5` | throws `Expected an operator or the end of the line, but found "bull"` | `bull: price = $120.00, qty = 5` |
| `line 3 under bull` | throws `Expected an operator or the end of the line, but found "under"` | `$600.00` |
| `line 3 for start from 2026-01-01 to 2026-04-01 step 1 month`, over `working days between start and finish` | `SWEEP_RANGE_NOT_NUMERIC` | `[261, 239, 219, 197]` |

A scenario is the what-if it stands for: `line 3 under bull` is `line 3 with price = $120, qty = 5`, worked out where the asking line stands, through the same re-run, so every what-if refusal is a scenario's too (a line in the span that sets a `global :name`, a goal seek or a what-if inside the span, live data not yet fetched, an input no line uses). The declaration answers a summary of its inputs, and a block total passes over it as it passes over a check. A scenario is found among the lines above the asking line; none (`SCENARIO_UNKNOWN`) or two of one name (`SCENARIO_DUPLICATE`) is refused by name. Inserting a line moves a scenario read's target with the line it meant, as it does for a what-if. The spelling is `under` because `in`, `as`, `to`, `with` and `for` already mean something after a line reference; `line 2 in bull` stays a conversion. `scenario` and `under` are claimed only in these shapes, so a variable named either still works. A package's plugin function can ask the same question through `context.readScenario(name, line)`, documented in the functions guide.

A date sweep steps the way `<date> + <duration>` moves a date, through the calendar code both now share (`vm/CalendarShift.ts`): a month from 31 January lands on 28 February (29 in 2024) and then 31 March, and a day step across a clock change keeps the time of day, while an hour step is elapsed time. The limit of 1,000 values applies; a step that is not a length of time is refused (`SWEEP_DATE_STEP_NOT_DURATION`), as is a step in working days.

The boundary: a scenario overrides inputs of this note only, and one whose span sets a `global :name` is refused, as a what-if is, until a re-run has a scratch scope for globals. A scenario is not read inside another scenario's or a what-if's re-run. A line whose answer is a date cannot be swept, since a list holds numbers and quantities. `engine.whatIf` does not take a scenario by name; a host passes the inputs, as before.

## Verification

`Issue744_scenariosAndDateSweeps.spec.ts` holds 30 tests: two scenarios read through both passes, a scenario read in arithmetic and a check, the declaration passed over by a block total, values read where the asking line stands, the note untouched, every refusal, a declaration below the reader, the declaration's own refusals (an input twice, seventeen inputs), `scenario` and `under` as variable names, scenarios named like a unit and like a prototype word, the single-expression refusal; date sweeps by month, week and backwards, month ends and a leap year, a day step across the London clock change, a range of one date and a year step, the refusals, a line that answers a date; unit tests of both normaliser rules, `scenarioDeclaredIn`, `isScenarioDeclarationText`, both plugin handlers and `shiftByCalendarUnit`; and adversarial prototype words, text edges and markup, an edit reaching the reader, nesting, two hundred reads in one note, a sweep of exactly 1,000 dates and one more, and CRLF. `CrossPathDocumentFeatures.spec.ts` holds the cross-path case: both passes agreeing, an edit in a live editor, an inserted line moving the target, a refusal through both passes, and the single-expression refusal. The fast suite (`npm run test:ci`), the type checks, the lints and the proven docs examples passed.
