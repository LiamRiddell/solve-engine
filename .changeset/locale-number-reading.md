---
"solve-engine": patch
---

Locales: a German engine refuses a dot decimal rather than reading it a hundred times too large, a regional tag reads as its language, native digits run past the decimal mark, and Indian grouping is read beside the rupee

Four locale faults from the 2026-09-25 survey, and a fifth found while fixing them. Most gave a number that looked like an answer and was not one.

**A German engine refuses a dot decimal (#654).** German groups thousands with a point, and the parser removed every point from a literal whatever followed it, so `2.5` was 25 and `$9.99` was $999.00. A German thousands group is always three digits, so a point followed by one, two, or four or more digits is an English decimal typed into a German engine. The engine cannot use it either way without guessing, so it is now refused with `INVALID_NUMBER_LITERAL`, naming the locale, at both parse sites. Under `createEngine({ locale: "de" })`, with results written in the default settings:

| line | before | now |
| --- | --- | --- |
| `2.5` | 25 | refused: "2.5" is not a number in the de locale: "." groups thousands there, so it is followed by exactly three digits, as in 2.500 (two thousand five hundred). |
| `$9.99` | $999.00 | refused |
| `1.5 km` | 15.00 km | refused |
| `0.5` | 5 | refused |
| `12.5%` | 125.00% | refused |
| `9.99 EUR` | €999.00 | refused |
| `2.500` | 2,500 | 2,500 |
| `1.234.567` | 1,234,567 | 1,234,567 |
| `17.11.2025` | Monday, November 17, 2025 | Monday, November 17, 2025 |

What stays: `2.500` is two thousand five hundred and `1.234.567` over a million, since a three-digit group is how German writes them, and a dotted date is a date. English and French engines read `2.5` as before. Reading `2,5` as two and a half is the decimal comma, which this does not add: `2,5` is refused in every engine, as it was, and a German engine writes a fraction as a division (`5/2`) until it is read. Pasted text keeps its own reading, so `numbers in "preis 9.99"` is still 9 and 99 under `de`.

**A regional tag reads as its language (#655).** `getLocale` looked a code up as an exact key of a plain object. `de-DE`, which is what a browser reports, missed `de` and read as English, and a code naming an inherited property (`toString`, `constructor`, `__proto__`, `hasOwnProperty`) returned what the object inherits, which crashed engine construction. A tag now falls back by its language subtag before falling back to English, in any case and with `-` or `_` between the subtags, and a code is looked up as an own key or not at all.

| `locale` | line | before | now |
| --- | --- | --- | --- |
| `de-DE` | `€1.250` | €1.25 | €1,250.00 |
| `de-DE` | `1.000 + 1` | 2 | 1,001 |
| `de-DE` | `1.5 + 1` | 2.50 | refused, as under `de` |
| `toString` | `createEngine({ locale })` | TypeError: Cannot convert undefined or null to object | an English engine |

`formatValue` wrote a regional tag's digits through `Intl` but took its weekday and month names from the language pack's code, which is `en` for any tag without a pack of its own. The names now come from the full tag wherever `Intl` has data for it. With `decimalSeparatorLocale` set:

| tag | `2025-11-17` before | now |
| --- | --- | --- |
| `de-DE` | Monday, November 17, 2025 | Montag, 17. November 2025 |
| `fr-FR` | Monday, November 17, 2025 | lundi 17 novembre 2025 |
| `en-GB` | Monday, November 17, 2025 | Monday, 17 November 2025 |

A tag `Intl` has no data for (`xx`) keeps its language pack's names, English for a code with none, as before, so a date does not follow the machine the engine runs on. The subtag chooses the language pack and nothing else about reading, with Indian grouping (below) the one exception, and no language is added.

**A second decimal mark is refused where the comma marks the decimal.** Found while fixing #655: a German or French engine turned the first comma of `1,234,567` into its decimal point, and `parseFloat` stopped at the second, so it answered 1.234. That reading had reached only `de` and `fr` engines; with regional tags falling back to their language it would have reached every `de-DE` and `fr-FR` host, which read the line as English until now, so it is refused in the same change, by the same code.

| `locale` | line | before | now |
| --- | --- | --- | --- |
| `de` | `1,234,567` | 1.23 | refused: "1,234,567" is not a number in the de locale: "," marks the decimal there, so it appears once, with only digits after it. |
| `fr` | `1,234.56` | 1.23 | refused |
| `de-DE` | `1,234,567` | 1,234,567, read as English | refused |

What stays: `1,000` is one in German and French, as it was, and `1.234,567` is one thousand two hundred and thirty-four and a bit in German.

**The two readings that slipped past (#805, #806).** An English engine read the mirror of #654, a German number typed into it, by dropping its comma, and a German engine let two shapes through: a first group longer than three digits, and a frame rate, whose parselet read its number the English way.

| `locale` | line | before | now |
| --- | --- | --- | --- |
| `en` | `1.234,567` | 1.23 | refused: "1.234,567" is not a number in the en locale: "." marks the decimal there, and the digits after it are not grouped. |
| `de` | `12345.678` | 12,345,678 | refused: "12345.678" is not a number in the de locale: "." groups thousands there, in threes, as in 12.345.678. |
| `de` | `2.5 fps` | 2.50 frames/s | refused, as `2.5` is |
| `de` | `2.500 fps` | 2.50 frames/s | 2,500.00 frames/s |

A list or a call written without spaces is unchanged (`[1.5,234]` is `[1.50, 234]` in English), since a comma there is a separator.

**Native digits run past the decimal mark (#656).** `localiseFixedDecimal`, which writes every quantity, every amount of money and an exact number to a fixed place count, localised the whole part through `Intl` and appended the fraction as the ASCII it arrived in. The fraction's digits now follow the tag's numbering system, leading zeros kept, and so does the whole part when grouping is off, which had the same gap. With `decimalSeparatorLocale` set:

| tag | line | before | now |
| --- | --- | --- | --- |
| `ar-EG` | `3.5 days` | ٣٫50 days | ٣٫٥٠ days |
| `ar-EG` | `£1234.5` | £١٬٢٣٤٫50 | £١٬٢٣٤٫٥٠ |
| `ar-EG` | `3.14159 to 2 dp` | ٣٫14 | ٣٫١٤ |
| `bn` | `3.5 days` | ৩.50 days | ৩.৫০ days |
| `mr` | `£1234.5` | £१,२३४.50 | £१,२३४.५० |
| `fa` | `3.5 days` | ۳٫50 days | ۳٫۵۰ days |
| `ar-EG`, grouping off | `£1234.5` | £1234٫50 | £١٢٣٤٫٥٠ |

The digits follow whatever numbering system `Intl` picks for the tag, so `ar-EG-u-nu-latn` still gives `3.50 days`. This is display only: typed native digits (`٣٫٥`) are not read.

**Indian grouping is read beside the rupee (#657).** In India a hundred thousand is one lakh, written `1,00,000`. The lexer and text extraction read a thousands group only as exactly three digits, so `₹1,00,000` was refused at its first comma and `amounts in "₹1,00,000"` answered `[1]`. The grouping (a first group of one or two digits, then groups of two, then a final three) is now read after `₹` or before `INR` in any engine whose pack groups thousands with a comma, and everywhere in an engine whose tag names India as its region (`en-IN`, `hi-IN`).

| line | before | now |
| --- | --- | --- |
| `amounts in "₹1,00,000"` | [1] | [100,000] |
| `numbers in "₹1,00,000"` | [1, 0] | [100,000] |
| `amounts in "rent ₹12,34,567.89"` | [12] | [1,234,567.89] |
| `₹1,00,000` | refused: Unexpected token after expression: "," | ₹100,000.00 |
| `1,00,000 INR` | refused: Unexpected token after expression: "," | ₹100,000.00 |
| `12,34,567` under `en-IN` | refused: Unexpected token after expression: "," | 1,234,567 |

What stays: a bare `12,34,567` in an English engine with no rupee marker is refused, since outside the convention a group of two digits is not a group and a refusal is safer than a guess. A comma inside a call or a bracket separates arguments and elements, so `[1,00,000]` is three numbers under `en-IN` too. A German or French engine does not read the grouping, since its comma is the decimal mark, and a mixed `1,00,000,000` is refused everywhere.

A new Locales page in the developer guide says what each language pack accepts typed, how a tag is resolved, where Indian grouping is read, and how the formatting tag writes digits and dates. The currency and pasted-text pages show Indian grouping, the pasted-text page says where a typed line and pasted text read differently, and the embedding and formatting guides point to the new page.

**Five pages said more about locales than the engine does (#675).** The embedding guide says `locale` decides the keywords and how numbers are read, and that the order of an ambiguous date is `config.date.inputOrder`: `03/04/2026` is 3 April in a German engine as in an English one. The introduction no longer promises a currency display setting, or settings that default from the engine, since `formatValue` never sees one. The pasted-text page says a typed line in a German engine does not yet accept a decimal comma, where pasted text does. The export tables describe `solve-engine/constants` as configuration defaults and the engine version, which is all it exports.

`UnifiedParsingOptions.localeCode` is deprecated, and goes in 3.0. `parseDocument` never read it: the engine reads keywords and numbers in the `locale` it was created with, so `parseDocument("1.000 + 1", { inputType: "markdown", localeCode: "de" })` on an English engine answers 2. The worker option of the same name is a different one, and is read.

## Verification

A spec per issue under `__tests__/bugs`, with unit tests for the new helpers and, for #654 to #657, an adversarial section: 65 tests for #654 (`isDotDecimal`, `unreadableInLocale`, `localeLiteralRefusal`, both parse tiers refusing together, whole documents, a literal of a hundred thousand digits, a tag of any length); 103 for #655 (`getLocale`, `groupsInLakhs`, `hasSecondDecimalMark`, every prototype word, `__PROTO__`, a non-string and a very long tag as a locale, and dates written through the full tag); 26 for #656 (`localiseFixedDecimal` across numbering systems, a tag `Intl` refuses, a prototype-named tag, a ten-thousand-digit fraction); 73 for #657 (`lakhGroupEnd`, `rupeeMarked`, English and `en-IN` engines, text extraction, whole documents, a long run of pairs); 22 for #805 and #806 (`unreadableInLocale`, `readLocaleNumber`, and the frame-rate form under both locales); and 9 for #675, one per corrected page claim, so a page that drifts from the engine again has a failing test beside it. `AdversarialFeatureSweep.spec.ts` gains Indian grouping in its money group.

The engine suite is 15,502 tests in 608 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #813, including the docs proofs, `lint:sidebar` for the new Locales page, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.
