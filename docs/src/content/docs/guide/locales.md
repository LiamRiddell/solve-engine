---
title: Locales
description: Which language an engine reads typed numbers and keywords in, and how a result is written out for a reader's region.
---

A locale is the set of conventions a place writes numbers and words in. The
same characters mean different numbers in different places: `1.000` is one
thousand to a German reader and one to an English one, and a German writes two
and a half as `2,5`, which is not a number at all in English. The engine keeps
two locale settings, one for each direction, because reading what someone typed
and writing an answer for them are separate questions.

- The engine's `locale` option chooses the language pack the engine **reads**
  with: its keywords (`mal` is times in German) and what a typed number means.
- The formatter's `numberResult.decimalSeparatorLocale` setting chooses how a
  result is **written**: the decimal mark, the digit grouping, the digits
  themselves, and the names of weekdays and months.

```ts
import { createEngine } from "solve-engine";
import { formatValue, DEFAULT_FORMATTING_SETTINGS } from "solve-engine/format";

const engine = createEngine({ locale: "de-DE" });
const value = engine.evaluateExpression("€1.250");

formatValue(value, {
  ...DEFAULT_FORMATTING_SETTINGS,
  numberResult: { decimalSeparatorLocale: "de-DE" },
}); // "= €1.250,00"
```

A host usually passes the reader's own tag to both, `navigator.language` in a
browser, so that the engine reads the way the reader types and answers the way
they read.

## What each language pack reads

Three packs ship: English (`en`), German (`de`) and French (`fr`). Each decides
which character groups thousands (the separator that makes `1,000,000` readable)
and which marks the decimal. The table shows what each engine answers for the
same typed characters, written out with the default output settings, which are
American English. That is why the German engine's two thousand five hundred
shows as `2,500`: the value is two thousand five hundred, and the formatter,
not the reading, chose the comma.

| Typed | `en` | `de` | `fr` |
| --- | --- | --- | --- |
| `2.5` | `2.50` | refused | `2.50` |
| `$9.99` | `$9.99` | refused | `$9.99` |
| `2.500` | `2.50` | `2,500` | `2.50` |
| `1.234.567` | `1,234,567` | `1,234,567` | `1,234,567` |
| `1,000` | `1,000` | `1` | `1` |
| `1,500` | `1,500` | `1.50` | `1.50` |
| `1,234,567` | `1,234,567` | refused | refused |
| `1.234,567` | refused | `1,234.57` | refused |
| `12345.678` | `12,345.68` | refused | `12,345.68` |
| `2.5 fps` | `2.50 frames/s` | refused | `2.50 frames/s` |
| `2,5` | refused | refused | refused |
| `5/2` | `2.50` | `2.50` | `2.50` |

An English engine reads `.` as the decimal point and `,` as a thousands group.
The digits after the point are not grouped, so `1.234,567`, which is German for
one thousand two hundred and thirty-four point five six seven, is refused rather
than read as 1.234567.

A German engine reads `.` as a thousands group, so `2.500` is two thousand five
hundred and `1.234.567` is over a million. A group is always three digits, so a
dot followed by one, two, or four or more digits (`2.5`, `9.99`, `3.14159`) is
not a German group: it is an English decimal typed into a German engine, and so
is a first group longer than three digits (`12345.678`). The
engine cannot use it either way without guessing, and guessing wrong makes
`$9.99` nine hundred and ninety-nine dollars, so it is refused with
`INVALID_NUMBER_LITERAL` and a message that names the locale:

```text
"2.5" is not a number in the de locale: "." groups thousands there, so it is followed by exactly three digits, as in 2.500 (two thousand five hundred).
```

A number read by a form of its own, such as a frame rate (`2.5 fps`), is read by
the same rule, so a German `2.500 fps` is two thousand five hundred frames a
second, as the bare number is.

A French engine reads a dot as a decimal point, as English does. Its thousands
group is a space, which a typed number cannot carry (`1 000` is refused) and
which [pasted text](/syntax/pasted-text/) is read with.

German and French both mark the decimal with a comma. Where a comma is followed
by exactly three digits the engine reads it as that decimal comma, which is why
`1,500` is one and a half there. A comma followed by one or two digits (`2,5`)
is not read yet in any pack, so a German or French engine writes a fraction as a
division (`5/2`) for now. A literal with a second decimal mark after its comma
(`1,234,567`), or in French a dot decimal beside a comma one (`1.234,567`), has
no reading in a comma-decimal locale, and is refused rather than cut short at
the second mark. In German `1.234,567` is a thousands group and a decimal
comma, and reads as one thousand two hundred and thirty-four and a bit.

## Region tags

A tag names a language and, often, a region: `de-DE` is German as written in
Germany, `de-AT` in Austria, `en-GB` British English. The engine has one pack
per language, so a tag with no pack of its own reads as its language's pack:
`de-DE`, `de-AT` and `de-CH` read as `de`, and `fr-FR` and `fr-CA` as `fr`. The
language is matched in any case, and `de_DE`, the spelling some operating
systems use, reads as `de` too.

| `locale` | `€1.250` | `1.5 + 1` |
| --- | --- | --- |
| `de` | `€1,250.00` | refused |
| `de-DE` | `€1,250.00` | refused |
| `fr-FR` | `€1.25` | `2.50` |
| `en-GB` | `€1.25` | `2.50` |

Any other code reads as English, including one with no pack at all (`xx`) and
one that happens to name a built-in JavaScript property (`toString`,
`__proto__`), which builds an ordinary English engine.

The region chooses nothing about reading, with one exception: Indian grouping,
below.

## Indian grouping

In India a hundred thousand is one lakh and is written `1,00,000`, and ten
million is one crore, `1,00,00,000`: the last three digits form a group, and
every group before them is two digits. The engine reads this grouping in two
places.

- **Beside a rupee marker**, in any engine whose pack groups thousands with a
  comma: after the `₹` sign or before the code `INR`. See
  [currency](/syntax/currency/#indian-grouping) for the worked examples.
- **Everywhere**, in an engine whose tag names India as its region: `en-IN`,
  `hi-IN` and the other Indian tags, which read as English otherwise.

| Typed | `en` | `en-IN` |
| --- | --- | --- |
| `₹1,00,000` | `₹100,000.00` | `₹100,000.00` |
| `12,34,567 INR` | `₹1,234,567.00` | `₹1,234,567.00` |
| `12,34,567` | refused | `1,234,567` |

A bare `12,34,567` stays refused in an English engine: outside the Indian
convention a group of two digits is not a group, and a refusal is safer than a
guess. A German or French engine does not read Indian grouping even beside `₹`,
since it reads the comma as its decimal mark. In every engine a comma inside a
call or a bracket separates arguments and elements, so `[1,00,000]` is a list of
three numbers.

## Writing results

`numberResult.decimalSeparatorLocale` takes any tag the runtime's `Intl` knows,
and the answer is written the way that tag writes numbers and dates.

| Tag | `3.5 days` | `£1234.5` | `₹1234567.89` | `2025-11-17` |
| --- | --- | --- | --- | --- |
| `en-US` (the default) | `3.50 days` | `£1,234.50` | `₹1,234,567.89` | `Monday, November 17, 2025` |
| `de-DE` | `3,50 days` | `£1.234,50` | `₹1.234.567,89` | `Montag, 17. November 2025` |
| `fr-FR` | `3,50 days` | `£1 234,50` | `₹1 234 567,89` | `lundi 17 novembre 2025` |
| `en-IN` | `3.50 days` | `£1,234.50` | `₹12,34,567.89` | `Monday, 17 November 2025` |
| `ar-EG` | `٣٫٥٠ days` | `£١٬٢٣٤٫٥٠` | `₹١٬٢٣٤٬٥٦٧٫٨٩` | `الاثنين، ١٧ نوفمبر ٢٠٢٥` |
| `ar-EG-u-nu-latn` | `3.50 days` | `£1,234.50` | `₹1,234,567.89` | `الاثنين، 17 نوفمبر 2025` |

A tag whose script has digits of its own (Arabic-Indic for `ar-EG`, Bengali for
`bn`, Devanagari for `mr`) writes every digit in them, the fraction included. A
host that wants Latin digits passes a tag that asks for them, as
`ar-EG-u-nu-latn` does: the `-u-nu-latn` ending names the Latin numbering
system.

Weekday and month names follow the tag wherever `Intl` has data for it. Where
it has none (`xx`), the names come from the language pack instead, English for
any code without one, so the answer does not depend on the machine the engine
happens to run on. A tag `Intl` cannot read at all (`de_DE`, which `Intl` spells
`de-DE`) makes formatting a number throw `Intl`'s own `RangeError`, so a typo in
the host's configuration is seen rather than hidden behind different output.

## What a locale does not do

- **Typed native digits are not read.** An `ar-EG` engine writes `٣٫٥٠`, but
  typing `٣٫٥` is not read as three and a half.
- **The decimal comma is only partly read.** `2,5` is refused in every pack,
  and a German or French engine reads a comma as a decimal only before exactly
  three digits.
- **Pasted text is read by its own rules.** `numbers in` and `amounts in` read
  a German engine's text in German, and do not refuse what a typed line would:
  `numbers in "preis 9.99"` is 9 and 99 in a German engine. See
  [pasted text](/syntax/pasted-text/#the-number-format-is-the-engines).
- **The date-entry order** a typed numeric date is read in is a separate setting,
  `date.inputOrder`; see [date literals](/syntax/date-literals/).
