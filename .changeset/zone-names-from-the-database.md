---
"solve-engine": minor
---

Every place in the time zone database has a name: `time in Kathmandu`, `time in Kolkata` and `time in Hobart` answer

A reader asking the time in a place the engine had not been told about got a refusal. The zone table was written by hand and held about ninety cities, so Kathmandu, Kolkata and Hobart, all zones in the IANA database, were refused, and Kolkata was refused even though Mumbai and Delhi resolved to `Asia/Kolkata` (#698).

| line (at noon UTC on 11 March 2026) | before | now |
| --- | --- | --- |
| `time in Kathmandu` | `Expected a city or zone name after "time in"` | 5:45 PM |
| `time in Kolkata` | `Expected a city or zone name after "time in"` | 5:30 PM |
| `time in Hobart` | `Expected a city or zone name after "time in"` | 11:00 PM |
| `time in Ho Chi Minh` | `Expected a city or zone name after "time in"` | 7:00 PM |
| `time difference between Kathmandu and Kolkata` | `Expected a city or zone name after "time difference between"` | Kathmandu is 15 minutes ahead of Kolkata |

- **Generated, then committed.** `scripts/generate-zone-names.mjs` writes `calendar/generated/ZoneNames.generated.ts` from the zones the runtime lists, 418 on Node 22 and 24, taking the last part of each identifier as the place: `Asia/Kathmandu` gives `kathmandu`, `America/Argentina/Buenos_Aires` gives `buenos aires`. It is run by hand, like the unit table's generator, so the table changes when someone regenerates it rather than when a runner's Node is upgraded. It adds 393 names.
- **Old and new spellings.** The runtime keeps fourteen zones under an older identifier (`Asia/Calcutta`, `Europe/Kiev`), so the generator stores the current one and answers to both names: `Kolkata` and `Calcutta`, `Kyiv` and `Kiev`, `Ho Chi Minh` and `Saigon`.
- **Beneath the hand-written table.** Every hand-written name keeps its meaning, and the hand-written table carries what the database cannot: countries, abbreviations, cities with no zone of their own (Mumbai), and `San Juan`, which reads as Puerto Rico rather than the Argentine province.
- **Left out, with reasons.** Ordinary words (`Easter`, `Christmas`, `Reunion`, `Wake`, `Center`, `Oral`), names a better-known place elsewhere holds (`Cordoba`, `Merida`, `Chatham`, `Norfolk`, `Petersburg`), county zones in Indiana, Kentucky and North Dakota, and the Antarctic research stations, several named after people (`time in Davis` should not answer for a base in Antarctica). Each is listed with its reason in the generator, and a spec asserts they stay out.

A single-word name is read as a place only where a zone is expected, so `kathmandu = 4` is still an ordinary variable. A name of more than one word is fused into one token as `New York` always was; a line that used such a pair of words as prose was already refused and still is. The published package grows by the table's size, which the package-size figures record.

The boundary: a zone identifier is still not typed directly (`Asia/Kathmandu` reads the slash as division), and a hyphenated place is written with spaces (`Port au Prince`, not `Port-au-Prince`), for the same reason.

## Verification

`Issue698_generatedZoneNames.spec.ts` holds 43 tests: a generated name through each form that reads a zone, old and new spellings agreeing, the hand-written table winning, every excluded name refused, every generated name a plain word or a fused place token, every generated zone one the calendar backend computes in, and single-word names still free as variables. The generator produces the same table on Node 22 and Node 24.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
