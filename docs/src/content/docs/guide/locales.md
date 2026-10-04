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

engine.formatValue(value); // "= €1.250,00", from the engine's own locale
```

`engine.formatValue` takes the output tag from the engine's `locale` option, so
the two halves agree unless the host says otherwise; the default `en`, and a
tag `Intl` has no number data for, write `en-US`. A worker runtime writes its
results the same way.

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
| `2,5` | refused | `2.50` | `2.50` |
| `1,5000` | refused | `1.50` | `1.50` |
| `1.500,5` | refused | `1,500.50` | refused |
| `1 500` | refused | refused | `1,500` |
| `max(1,5; 2)` | refused | `2` | `2` |
| `max(1,5, 2)` | `5` | `2` | `2` |
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
group is a space: `1 500` is fifteen hundred, and so is `1 500` written with the
narrow no-break space the engine itself writes between French groups, or with an
ordinary no-break space. A group after the space is exactly three digits and the
first group is one to three, so `1 50` and `12345 678` are two numbers side by
side and refused, as `5 3` is. A German or English engine does not group with a
space.

## The decimal comma

German and French both mark the decimal with a comma: two and a half is `2,5`.
In either engine, and in their regional tags (`de-DE`, `fr-CA`), a comma
between two digits is that decimal comma, whatever follows it: `2,5`, `1,50`,
`1,500` and `1,5000` are all read as a decimal, so `1,500` is one and a half,
never fifteen hundred. It is read in money (`€9,99`), in a quantity (`1,5 km`),
in a percentage (`12,5%`) and in a list, as a number is anywhere else.

A literal with a second mark after its decimal comma (`1,500,000`), or in French
a dot decimal beside a comma one (`1.234,567`), has no reading, and is refused
rather than cut short at the second mark. In German `1.234,567` is a thousands
group and a decimal comma, and reads as one thousand two hundred and thirty-four
and a bit.

### Separating a function's arguments

A comma separates a function's arguments in English: `max(1, 2)` is the larger
of one and two. Where a comma is also the decimal mark, `max(1,5, 2)` could mean
either the larger of one and a half and two, or the largest of three numbers.
The engine never guesses between them. In a German or French engine:

- A comma **between two digits** is always the decimal comma, inside a call or
  a bracket as much as outside one.
- A `;` separates arguments, as a spreadsheet in those languages does:
  `max(1,5; 2)` is 2.
- A comma **with a space after it** still separates arguments, since a decimal
  comma never has one: `max(1, 2)` and `max(1,5, 2)` are both 2.

| Typed under `de` | Reads as | Answer |
| --- | --- | --- |
| `max(1,5; 2)` | the larger of 1.5 and 2 | `2` |
| `max(1,5, 2)` | the larger of 1.5 and 2 | `2` |
| `max(1; 2)` | the larger of 1 and 2 | `2` |
| `max(1,2)` | the largest of one number, 1.2 | `1.20` |
| `max(1,5,2)` | one literal with two decimal commas | refused |
| `rgb(255,0,0)` | one literal with two decimal commas | refused |
| `rgb(255; 0; 0)` | three arguments | `rgb(255, 0, 0)` |

A matrix keeps `;` for its rows, so inside `[...]` the elements of a row are
separated by a comma and a space, and the rows by `;`: `[1,5; 2,5]` is a column
of 1.5 and 2.5, and `[1,5, 2,5]` a row of them. A `;` in a call inside a matrix
separates that call's arguments, and one in a matrix inside a call separates the
matrix's rows: each belongs to the bracket it is written in.

The boundary: the reading follows the engine's locale only, never a guess made
line by line. An English engine is unchanged, so there `1,500` is fifteen
hundred, `max(1,5, 2)` is 5, and `;` is not an argument separator. A tag with no
pack of its own (`es`, `it`, `nl`) reads as English too, even though the engine
writes that tag's answers with a decimal comma (see
[writing results](#writing-results)); an answer written for such a tag cannot yet
be typed back into it. Outside a call a `;` separates nothing, so
`1,5 + 2,5; 3` is refused.

## The words each pack reads

A language pack is a keyword table as well as a number format, and it
**replaces** English rather than adding to it. A German engine reads `mal` for
times and `von` for of, and no longer reads `times` or `of`; a French engine
reads `fois` and `si ... alors ... sinon`, and no longer reads `if ... then ...
else`. The words that come from the engine's packages rather than from the
keyword table, the unit names (`km`, `lb`), the currency codes, and phrases such
as `half of` and `20% off`, are read the same in every pack. Symbols are never
translated: `+`, `^`, `%` and `!` mean the same everywhere.

| Typed | `en` | `de` | `fr` |
| --- | --- | --- | --- |
| `3 times 4` | `12` | refused | refused |
| `3 mal 4` | refused | `12` | refused |
| `3 fois 4` | refused | refused | `12` |
| `3 plus 4` | `7` | `7` | `7` |
| `10 teilen 2` | refused | `5` | refused |
| `10 diviser 2` | refused | refused | `5` |
| `2 potenz 3` | refused | `8` | refused |
| `2 puissance 3` | refused | refused | `8` |
| `10 mod 3` | `1` | `1` | `1` |
| `10% of 200` | `20` | refused | refused |
| `10% von 200` | refused | `20` | refused |
| `half of 10` | `5` | `5` | `5` |
| `20% off $50` | `$40.00` | `$40.00` | `$40.00` |
| `5 km to miles` | `3.11 miles` | refused | refused |
| `5 km in miles` | `3.11 miles` | `3.11 miles` | refused |
| `konvertieren 5 km in miles` | refused | `3.11 miles` | refused |
| `5 kg + 2 lb` | `5.91 kg` | `5.91 kg` | `5.91 kg` |
| `true and false` | `false` | refused | refused |
| `vrai et faux` | refused | refused | `false` |
| `if 1 > 0 then 1 else 2` | `1` | refused | refused |
| `si 1 > 0 alors 1 sinon 2` | refused | refused | `1` |
| `sin(0)` | `0` | `0` | `0` |
| `sqrt(16)` | `4` | refused | refused |
| `round(2.567, 2)` | `2.57` | refused | refused |
| `floor(7/2)` | `3` | refused | refused |
| `ceil(7/2)` | `4` | refused | refused |
| `max(1, 2)` | `2` | `2` | `2` |
| `wurzel(16)` | refused | refused | refused |
| `runden(7/2)` | refused | refused | refused |
| `aufrunden(7/2)` | refused | refused | refused |
| `abrunden(7/2)` | refused | refused | refused |
| `15.03.2024` | `Friday, March 15, 2024` | `Friday, March 15, 2024` | `Friday, March 15, 2024` |

The dates and times words follow the same rule: `today`, `now` and
`next monday` in English, `heute`, `jetzt` and `naechste montag` in German, and
`aujourdhui` (without its apostrophe, which a word cannot hold), `maintenant`
and `prochain lundi` in French. They answer from the clock, so they are not in
the table.

Three gaps in the German and French packs are worth knowing before choosing
one:

- **Functions.** Both keep `sin`, `cos`, `tan`, `log`, `abs`, `min` and `max`,
  and lose the English `sqrt`, `round`, `floor` and `ceil`. The German names the
  table lists (`wurzel`, `runden`, `aufrunden`, `abrunden`) are recognised as
  function names but have no function behind them yet, so they are refused
  with `Unknown function`.
- **Converting in French.** The French pack has no word for `in` or `to`, so a
  French engine cannot convert units or currencies in words.
- **Words for true, false and if in German.** The German pack has none, so a
  German engine has no conditional and no truth values.

## Region tags

A tag names a language and, often, a region: `de-DE` is German as written in
Germany, `de-AT` in Austria, `en-GB` British English. The engine has one pack
per language, so a tag with no pack of its own reads as its language's pack:
`de-DE`, `de-AT` and `de-CH` read as `de`, and `fr-FR` and `fr-CA` as `fr`. The
language is matched in any case, and `de_DE`, the spelling some operating
systems use, reads as `de` too.

| Typed | `de` | `de-DE` | `fr-FR` | `en-GB` |
| --- | --- | --- | --- | --- |
| `€1.250` | `€1,250.00` | `€1,250.00` | `€1.25` | `€1.25` |
| `1.5 + 1` | refused | refused | `2.50` | `2.50` |
| `3 mal 4` | `12` | `12` | refused | refused |

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
since it reads the comma as its decimal mark, so `₹1,00,000` there is a literal
with two decimal commas and refused. In an English engine a comma inside a call
or a bracket separates arguments and elements, so `[1,00,000]` is a list of
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
- **Only the German and French packs read a decimal comma.** Every other tag
  reads as English, including those whose answers the engine writes with one.
- **The formatter is the other half.** A pack decides what a typed line means,
  never how the answer is written: that is `numberResult.decimalSeparatorLocale`
  in the [formatting settings](/guide/formatting/), which `engine.formatValue`
  takes from the engine's tag.
- **Pasted text is read by its own rules.** `numbers in` and `amounts in` read
  a German engine's text in German, and do not refuse what a typed line would:
  `numbers in "preis 9.99"` is 9 and 99 in a German engine. See
  [pasted text](/syntax/pasted-text/#the-number-format-is-the-engines).
- **The date-entry order** a typed numeric date is read in is a separate setting,
  `date.inputOrder`; see [date literals](/syntax/date-literals/).
