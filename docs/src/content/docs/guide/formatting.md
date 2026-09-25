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

## Settings

`formatValue` takes an optional second argument, a full
[`FormattingSettings`](/api/format/interfaces/formattingsettings/) object
grouped by value type: decimal
places for floats, units and percentages, padding for hex, and the locale used
for the decimal separator.

It is a complete object, not a patch. Passing a few loose keys will not merge
with the defaults, it will leave the rest undefined and throw. Spread
`DEFAULT_FORMATTING_SETTINGS` and override the group you care about:

```ts
import { formatValue, DEFAULT_FORMATTING_SETTINGS } from "solve-engine/format";

formatValue(value, {
  ...DEFAULT_FORMATTING_SETTINGS,
  unitOfMeasurementResult: { decimalPlaces: 0 },
}); // "= 3,000 m"
```

The groups are `floatResult`, `numberResult`, `hexResult`,
`unitOfMeasurementResult`, `percentageResult` and `dateResult`. The last chooses
how a date is written out: `"long"`, the spelled-out default
(`"= Friday, March 15, 2024"`), or one of the numeric forms `"iso"`
(`"= 2024-03-15"`), `"dmy"` (`"= 15/03/2024"`) and `"mdy"` (`"= 03/15/2024"`);
[Displaying dates](/syntax/displaying-dates/) covers it from the reader's side.
Every group's fields are listed in the
[API reference](/api/format/interfaces/formattingsettings/).

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
in that zone instead: `formatValue` does this when it is passed the engine's
backend as `FormattingSettings.calendar`, as
[Dates on Temporal](/guide/dates-on-temporal/) shows, and a custom renderer
would read its fields from that backend rather than from `DATE_CALENDAR`.

Handle `Pending` and `Error` explicitly. They are ordinary value types rather
than exceptions, so a formatter that assumes every value is a finished number
shows a stray `0` the moment a currency line is still loading, because
`toNumber()` gives `0` for both.
