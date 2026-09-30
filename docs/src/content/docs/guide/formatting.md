---
title: Formatting results
description: Turning a value into display text, and controlling how.
---

Evaluation and presentation are separate. The engine produces a value; turning
it into text is a second step you control.

```ts
import { formatValue } from "solve-engine/format";

formatValue(value); // "= 3,000.00 m"
```

The leading `= ` marker suits an editor result gutter. Strip it when rendering
elsewhere.

## The engine's own formatter

An engine knows two things the free `formatValue` does not: the calendar it
computed its dates with, which decides the day a date falls on, and the locale
it was built for. `engine.formatValue` writes a value with both, so it is the
call to reach for when the value came from that engine:

```ts
const german = createEngine({ locale: "de-DE", calendar: dateCalendarInZone("Pacific/Kiritimati") });

german.formatValue(german.evaluateExpression("€1250")); // "= 1.250,00 €"
german.formatValue(german.evaluateExpression("naechste freitag")); // a Friday, in Kiritimati
```

The German engine reads the German date words (`naechste freitag` rather than
`next friday`; see [locales](/guide/locales/)), and the examples below go back
to an English `engine`.

The free formatter, given no settings, writes numbers in `en-US` and dates in
the host process's own zone. For an engine built with neither a locale nor a
calendar the two agree; for one built with another zone they can disagree on
the day, because an instant that is Friday in Kiritimati is still Thursday in
London for most of that day.

The engine's settings are the defaults with its calendar and a number locale
from its `locale` option (`de-DE` writes `de-DE`; the default `en`, and a tag
`Intl` has no number data for, write `en-US`). `engine.getFormattingSettings()`
returns them, for a host that formats elsewhere. A worker runtime writes its
results with its engine's settings in the same way.

## Settings

`formatValue` takes an optional second argument,
[`FormattingSettings`](/api/format/interfaces/formattingsettings/), grouped by
value type: decimal places for floats, units and percentages, padding for hex,
the locale used for the decimal separator, the date form, and the calendar
backend a date is read with. `engine.formatValue` takes the same object as its
second argument.

Name only what you change. A settings object is merged over the defaults
group by group, and field by field within a group, so everything it leaves out
keeps its default (or, for `engine.formatValue`, the engine's own setting):

```ts
import { formatValue } from "solve-engine/format";

formatValue(value, { unitOfMeasurementResult: { decimalPlaces: 0 } }); // "= 3,000 m"
formatValue(value, { calendar }); // a date read in that backend's zone
```

A complete settings object, such as `DEFAULT_FORMATTING_SETTINGS` spread and
changed, is used exactly as it is, and an edit made to it in place is seen on
the next call. A group that is not an object, and a key that is not a group, are
ignored rather than thrown on, so a settings object from an older or newer host
still formats. `mergeFormattingSettings(base, overrides)` is the same merge, for
a host that keeps its own settings and layers a user's choices over them.

The groups are `floatResult`, `numberResult`, `hexResult`,
`unitOfMeasurementResult`, `percentageResult`, `matrixResult` (see
[long lists](#long-lists-and-matrices) below), `wordsResult` and `dateResult`.
The last chooses how a date is written out: `"long"`, the spelled-out default
(`"= Friday, March 15, 2024"`), or one of the numeric forms `"iso"`
(`"= 2024-03-15"`), `"dmy"` (`"= 15/03/2024"`) and `"mdy"` (`"= 03/15/2024"`);
[Displaying dates](/syntax/displaying-dates/) covers it from the reader's side.
`wordsResult` is covered under [the locale tag](#the-locale-tag) below. Every
group's fields are listed in the
[API reference](/api/format/interfaces/formattingsettings/).

## Shorter numbers

Two optional fields in `floatResult` make answers shorter to read. Both are off
by default, so a host that sets neither sees exactly what it saw before.

`trimTrailingZeros` drops the zeros that only pad a number out to its decimal
places. The places are a budget, two by default, and a number with fewer digits
than that is normally filled with zeros so a column of answers lines up: `1.5`
shows as `1.50`. With the field set, it shows as `1.5`. It applies to a plain
number, a list's entries, a quantity and a percentage.

`compactFrom` is a size from which a number is written in compact form, the
form `as compact` writes on a single line: a figure rounded to three significant
digits with a letter for its scale, `k` for thousands, `M` for millions, `B` for
billions and `T` for trillions. `1500000` shows as `1.5M` once the setting is
`1000000` or less.

```ts
const shorter = { floatResult: { trimTrailingZeros: true, compactFrom: 1_000_000 } };

formatValue(engine.evaluateExpression("1.5"), shorter);         // "= 1.5"
formatValue(engine.evaluateExpression("2.5 km"), shorter);      // "= 2.5 km"
formatValue(engine.evaluateExpression("0.1 + 0.2"), shorter);   // "= 0.3"
formatValue(engine.evaluateExpression("12.5%"), shorter);       // "= 12.5%"
formatValue(engine.evaluateExpression("1500000"), shorter);     // "= 1.5M"
formatValue(engine.evaluateExpression("-2500000"), shorter);    // "= -2.5M"
formatValue(engine.evaluateExpression("$3,300,000"), shorter);  // "= $3.3M"
formatValue(engine.evaluateExpression("999999"), shorter);      // "= 999,999"
```

What each leaves alone, and why:

- **Money keeps its currency's places.** `$1.50` stays `$1.50` with
  `trimTrailingZeros` set, because the cents of a price are part of how it is
  written, not padding. Money does take the compact form (`$3.3M`).
- **A line that names its precision keeps it.** `3.14159 to 4 dp` asked for four
  places and shows `3.1416`, and `1500000 to 2 dp` shows `1,500,000.00` rather
  than `1.5M`.
- **A measurement with a tolerance keeps its full form**
  (`1,500,000 ± 20,000.0`), since the digits of the spread are the point of it.
- **The compact form stops at the trillions.** A number of a thousand trillion
  or more has no letter left to shorten it with, so it keeps its ordinary form:
  `2^64` still shows every digit rather than `1.84e+19`. A threshold below
  `1000` acts as `1000`, for the same reason at the other end.

Compact is a display rounding, as `as compact` is. `1.5M` reads back in as
1,500,000, but `1234567` shows as `1.23M`, which reads back as 1,230,000, and a
de-DE engine does not read the German `1,5M` back at all. A host that copies
answers back into a note should leave `compactFrom` off.

## Currency places

An amount of money is shown to its currency's minor unit, the smallest amount
that currency is paid in: two places for the dollar, none for the yen, three for
the Kuwaiti dinar, and a figure of its own for each cryptocurrency (see
[money precision](/syntax/money-precision/#each-currencys-own-places)). That
applies whatever `unitOfMeasurementResult.decimalPlaces` holds, because a
setting of two was the default long before currencies had their own figures,
and a host that never touched it did not ask for two places of yen. The setting
still bounds a price per unit (`¥31.5/kWh`), which keeps at least the minor unit
and up to `decimalPlaces`.

A host that wants every currency to one place count, as before, sets
`unitOfMeasurementResult.currencyPlaces` to `"setting"`. `"currency"` is the
default, and what a missing field reads as, so a settings object built before
the field existed keeps compiling and gets the minor units.

```ts
import type { FormattingSettings } from "solve-engine/format";

// Typed, so "setting" stays the literal the field takes rather than a string.
const oneCountEverywhere: FormattingSettings = {
  ...DEFAULT_FORMATTING_SETTINGS,
  unitOfMeasurementResult: { decimalPlaces: 2, currencyPlaces: "setting" },
};

formatValue(engine.evaluateExpression("¥1000 / 3"));                     // "= ¥333"
formatValue(engine.evaluateExpression("¥1000 / 3"), oneCountEverywhere); // "= ¥333.33"
```

Either way, a line that names its places (`¥1000 / 3 to 2 dp`) is shown to them.
The setting changes only what is shown: a split still shares out the currency's
smallest unit, so a yen bill split three ways pays whole yen under either
setting (`¥33.00 each` under `"setting"`).

## The locale tag

`numberResult.decimalSeparatorLocale` is the tag a result is written for, and it
takes any tag the runtime's `Intl` knows, not only the engine's three language
packs. It chooses the decimal mark and the digit grouping, the digits themselves
(every digit of `3.5 days` is Arabic-Indic under `ar-EG`, the fraction included:
`٣٫٥٠ يوم`), and the names of weekdays and months in a spelled-out date
(`Montag, 17. November 2025` under `de-DE`).

```ts
formatValue(engine.evaluateExpression("£1234.5"), {
  ...DEFAULT_FORMATTING_SETTINGS,
  numberResult: { decimalSeparatorLocale: "de-DE" },
}); // "= 1.234,50 £"
```

### The words beside the number

Under a tag that is not English, the words in an answer follow the tag's
language too, wherever the runtime's `Intl` has them. Three kinds of word move:

- **A unit's long name.** A unit the reader wrote as a word (`miles`, `days`,
  `litres`) is named in the tag's language, in the grammatical form its count
  takes: `3,11 Meilen`, `1 Stunde`, and Polish's several plural forms. `Intl`
  names forty-three of the engine's units this way (lengths, masses, volumes, times, data
  sizes, temperatures); any other keeps its English name. A symbol (`km`,
  `kg`, `h`) is written as it is in every language.
- **Where a currency symbol goes.** The symbol takes the place the tag gives it,
  after the amount with a space under `de-DE` (`5,00 €`), before it under `ja`.
  The symbol itself stays the engine's, so `$` stays `$` for every dollar, and
  the places, the rounding and the sign rule are unchanged: `-€5` is `-5,00 €`.
- **A weekday or month name** answered by `as weekday` or `as month`: `Dienstag`,
  `März`. The value is still the English text, so
  `(2026-03-10 as weekday) == "Tuesday"` is still true; only what is shown
  changes.

```ts
const de = { numberResult: { decimalSeparatorLocale: "de" } };

formatValue(engine.evaluateExpression("5 km in miles"), de);          // "= 3,11 Meilen"
formatValue(engine.evaluateExpression("3600 seconds in hours"), de);  // "= 1 Stunde"
formatValue(engine.evaluateExpression("10 kg"), de);                  // "= 10,00 kg"
formatValue(engine.evaluateExpression("€1234.5"), de);                // "= 1.234,50 €"
formatValue(engine.evaluateExpression("$5"), de);                     // "= 5,00 $"
formatValue(engine.evaluateExpression("2026-03-10 as weekday"), de);  // "= Dienstag"
```

An English tag (`en-US`, `en-GB`, `en-IN`) writes exactly what it always did,
and so does a tag the runtime has no data for, or a runtime built with English
locale data only, which is checked rather than trusted.

A localised answer is for reading. A de-DE engine reads `1.234,50 €` back in,
but not `3,11 Meilen` or `Dienstag`: typing units and day names in another
language is not part of this. A host that writes answers back into the note
(committing a result as text) sets `wordsResult` to keep the engine's own
spelling, while the digits and separators still follow the tag:

```ts
import type { FormattingOverrides } from "solve-engine/format";

const forTheNote: FormattingOverrides = { numberResult: { decimalSeparatorLocale: "de" }, wordsResult: { spelling: "engine" } };

formatValue(engine.evaluateExpression("5 km in miles"), forTheNote);  // "= 3,11 miles"
formatValue(engine.evaluateExpression("€5"), forTheNote);            // "= €5,00"
```

Only these three kinds of word move. A time in another zone and a time
difference (`10:00 London in Tokyo`, `time difference between London and
Tokyo`) are answered as English text and stay English under every tag.

A tag `Intl` has no data for (`xx`) takes its weekday and month names from the
language pack instead, English for a code with none, so a date does not change
with the machine the engine runs on. A tag `Intl` cannot read at all makes
formatting a number throw `Intl`'s `RangeError`, so a mistyped setting is seen. See
[locales](/guide/locales/#writing-results) for the full table.

## Long lists and matrices

A list or a matrix is written out element by element, so the text grows with
it, and so does the time spent writing it. `map(10*x, 0:99999)` is a list of a
hundred thousand numbers: evaluating it takes a small fraction of a second, and
writing all of it out is 888,791 characters that nobody reads in a result
column.

`matrixResult.maxElements` is a ceiling on how many elements are written. Past
it, a list shows its first elements and counts the rest, and a matrix (a grid of
rows and columns) shows the whole rows that fit and counts the rows left out. A
matrix whose single row is already wider than the ceiling shows only its shape,
rows by columns. The elements left out are never formatted, so the cost is
bounded along with the text:

```ts
import type { MatrixData } from "solve-engine/vm";

const list = engine.evaluateExpression("map(10*x, 0:99999)");
const grid = engine.evaluateExpression("[1, 2, 3; 4, 5, 6; 7, 8, 9]");

formatValue(list, { matrixResult: { maxElements: 5 } }); // "= [0, 10, 20, 30, 40, and 99,995 more]"
formatValue(grid, { matrixResult: { maxElements: 7 } }); // "= [1, 2, 3; 4, 5, 6; and 1 more row]"
formatValue(grid, { matrixResult: { maxElements: 2 } }); // "= [3x3 matrix]"
formatMatrixAligned(list.value as MatrixData, { matrixResult: { maxElements: 5 } });
// "[ 0  10  20  30  40 ]\nand 99,995 more"
```

A host that displays results sets it; the docs notepad and the playground use
1,000. The ceiling is opt-in, and absent by default, because `formatValue`'s
full text is also the stable, assertable form the API and the worker carry: a
host that reads a list back out of its text needs all of it. A value that is
not a whole number of at least 1 (zero, a negative, `NaN`, a string) sets no
ceiling, and a fraction is rounded down. A line's [trace](/guide/tracing-lines/)
shortens a list the same way, at ten elements.

The boundary: this bounds the time spent writing a result, not what the value
costs to hold. A hundred-thousand-element list is still a hundred thousand
numbers in memory while its document is open.

## Formatting yourself

Nothing obliges you to use the built-in formatter. A value exposes its type, its
raw payload and its unit, which is enough to render however your product needs,
and is often less code than fighting the settings for an unusual layout.

The payload is not always the number a reader sees, so read it by type. A
percentage is held as a fraction (`25%` is `0.25`), a date as an instant in
epoch milliseconds (the milliseconds since the start of 1970), and a clock
duration such as `9:30 - 8:30` as a length in milliseconds. A list, a string, a
complex number and a symbolic result have no single number at all, and
`toNumber()` gives `0` for them rather than throwing, so a renderer that calls
it on everything shows a plausible wrong answer. The sketch below changes the
layout of the kinds it names and hands every other kind to `formatValue`:

```ts
import { formatValue } from "solve-engine/format";
import { DATE_CALENDAR } from "solve-engine/engine";
import { ValueType, type Value } from "solve-engine/vm";

function render(value: Value): string {
  switch (value.type) {
    case ValueType.Uom:
      // A clock duration is held in milliseconds; the formatter writes it as 1:00.
      if (value.datetimeSpan) return formatValue(value).replace(/^= /, "");
      return `${value.toNumber().toLocaleString()} ${value.unit}`;
    case ValueType.Percentage:
      // Held as a fraction: 25% is 0.25.
      return `${(value.toNumber() * 100).toLocaleString()}%`;
    case ValueType.Datetime: {
      // Held as an instant; the calendar says which day it falls on.
      const { year, month0, day } = DATE_CALENDAR.fields(value.toNumber());
      return `${day}/${month0 + 1}/${year}`;
    }
    case ValueType.Pending:
      return "…";
    case ValueType.Error:
      return "";
    default:
      return formatValue(value).replace(/^= /, "");
  }
}
```

It covers a measurement (`3000 m` renders as `3,000 m`), money (`$5` renders as
`5 USD`, since a currency is a unit), a percentage (`25%`), a date
(`2024-03-15` renders as `15/3/2024`), a pending value and an error. Every other
kind (a plain number, a list, a string, a boolean, a complex number, a matrix, a
symbolic result) takes the built-in formatter's text with the marker stripped:
`1/3` renders as `0.33` and `[1, 2, 3]` as `[1, 2, 3]`.

The date branch reads the instant in the host process's own zone, the zone an
engine given no `calendar` computes in. A date that names a zone
(`3 April 2026 in Tokyo`), or an engine given another calendar backend, is read
in that zone instead: `engine.formatValue` does this on its own, and the free
`formatValue` does it when passed the engine's backend (`{ calendar }`), as
[Dates on Temporal](/guide/dates-on-temporal/) shows. A custom renderer would
read its fields from that backend (`engine.getFormattingSettings().calendar`)
rather than from `DATE_CALENDAR`.

Handle `Pending` and `Error` explicitly. They are ordinary value types rather
than exceptions, so a formatter that assumes every value is a finished number
shows a stray `0` the moment a currency line is still loading, because
`toNumber()` gives `0` for both.
