---
"solve-engine": minor
---

Under a locale that is not English, an answer's words follow it: a unit's long name (`3,11 Meilen`), where a currency symbol goes (`5,00 €`), and a weekday or month name (`Dienstag`)

A host formats answers in the reader's locale through `numberResult.decimalSeparatorLocale`, and the numbers and dates followed it while the words beside them did not, so a German reader saw `3,11 miles`, `€5,00` and `Tuesday` beside `Dienstag, 10. März 2026`. Unit names were English because the formatter wrote the spelling the value carried (#754); each currency had one fixed placement, the English one (#755); and `as weekday` and `as month` answered finished English text a formatter could not localise (#757).

Each is now taken from the runtime's own `Intl` data, under the formatter's tag (`de` below):

| line | before | now |
| --- | --- | --- |
| `5 km in miles` | 3,11 miles | 3,11 Meilen |
| `2 days` | 2 days | 2 Tage |
| `3600 seconds in hours` | 1 hour | 1 Stunde |
| `10 kg` | 10,00 kg | 10,00 kg |
| `€5` | €5,00 | 5,00 € |
| `€1234.5` | €1.234,50 | 1.234,50 € |
| `-€5` | -€5,00 | -5,00 € |
| `$5` | $5,00 | 5,00 $ |
| `5 SEK` | 5,00 kr | 5,00 kr |
| `2026-03-10 as weekday` | Tuesday | Dienstag |
| `2026-03-10 as month` | March | März |

A unit's name takes the grammatical form its count does, which `Intl` chooses from the count and the places shown (`1 Tag`, `3 Tage`, and Polish's `2 dni` and `2,00 mili`). Forty-three units have a name this way, those `Intl` sanctions (lengths, masses, volumes, times, data sizes, temperatures). A currency symbol takes only its place and spacing from the locale: the symbol itself (`$` for every dollar), the places, the exact rounding and the sign rule (#554) stay the engine's. A weekday or month answer is still the English text, and records which name it holds in a new `Value.calendarName` sidecar, carried by `toJSON`, the worker DTO and snapshots, so `(2026-03-10 as weekday) == "Tuesday"` is still true and only what is shown changes. English tags (`en-US`, `en-GB`, `en-IN`) write exactly what they did, and so does a tag `Intl` has no data for, or a runtime built with English locale data only, which is checked rather than trusted.

A new optional `wordsResult: { spelling: "engine" }` keeps the engine's own words and placement with the locale's digits and separators (`3,11 miles`, `€5,00`), for a host that writes answers back into the note. A de-DE engine reads `1.250,00 €` back as the same money, but not `3,11 Meilen` or `Dienstag`. The formatting and locales guides, and the currency and weekday pages, say how each renders.

Existing specs that pinned the English words or placement under a non-English tag were updated to the new answers: `Issue656_nativeFractionDigits`, `Issue721_engineFormatValue`, `Issue725_resultsAsJson`, `Issue726_localesPage` (through the locales page's table), `Issue753_unitWordCountAndMoneyRates`, `Issue827_workerEngineFormatting` and `FormatUomGrouping`.

The boundary: output only. Typing unit, weekday or month names in another language is the language-pack work, and not part of this. A unit written as a symbol (`km`, `kg`, `h`), and a unit `Intl` has no name for (`nautical miles`), keep the engine's spelling, since a symbol reads the same in every language and a name cannot be invented. Text built from a name (`"on " + (2026-03-10 as weekday)`) is new text, in English. The zone answers of #757 are not part of this change: a time in another zone (`10:00 London in Tokyo`) and a time difference are still English text. The fix that issue proposes, a time of day as a Datetime carrying its zone and its day shift, needs the time-of-day grain that the dates batch (#708, pull request #832) introduces in the same files, so it follows that batch rather than building a second shape for the same value.

## Verification

`Issue754_localUnitNames.spec.ts` holds 27 tests, `Issue755_currencyPlacement.spec.ts` 30 and `Issue757_weekdayAndMonthNames.spec.ts` 22: each issue's table under `de` and with the engine's spelling; English tags unchanged; the boundary (symbols, a unit and a code with no name or symbol, shared symbols, exact half-cent rounding, text built from a name, zone answers); plural forms in German, Polish and Arabic, native digits, and right-to-left locales; every sanctioned unit and every displayed currency under six locales; a de-DE engine reading its own currency answers back; unit tests of `localisesWords`, `withLocalUnitName`, `localCurrencyPlacement` and `localCalendarName` with ordinary, boundary and hostile arguments; `clone`, `recycle`, `toJSON`, the worker DTO and a snapshot round trip, a malformed snapshot refused by name; both document passes agreeing; and the adversarial cases (prototype words as a unit, a currency, a tag and a date, look-alike and markup text, two thousand distinct tags within time, leap days and dates before 1970, zero, negative zero and huge amounts). Gates run: `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` all clean; the proven docs examples and the hardening and integration suites passed (7,274 tests in 88 suites); and the fast suite passed, 21,154 of 21,158 tests in 682 suites with 4 skipped. `lint:units` needs a build and was not run: the unit reference page is regenerated with the stats. `npm run verify` and the bundled-consumer contract were not run for this change.
