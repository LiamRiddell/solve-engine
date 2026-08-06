---
title: Formatting results
description: Turning a value into display text, and controlling how.
---

Evaluation and presentation are separate. The engine produces a value; turning
it into text is a second step you control.

```ts
import { formatValue } from "solve-engine/format";

formatValue(value); // "= 3000.00 m"
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
  unitOfMeasurementResult: { decimalPlaces: 0, unitNames: false },
}); // "= 3000 m"
```

The groups are `floatResult`, `numberResult`, `hexResult`,
`unitOfMeasurementResult` and `percentageResult`. Their fields are listed in the
[API reference](/api/format/interfaces/formattingsettings/).

## Formatting yourself

Nothing obliges you to use the built-in formatter. A value exposes its type, its
raw payload and its unit, which is enough to render however your product needs,
and is often less code than fighting the settings for an unusual layout.

```ts
import { ValueType } from "solve-engine/vm";

function render(value): string {
  switch (value.type) {
    case ValueType.Uom:
      return `${value.toNumber().toLocaleString()} ${value.unit}`;
    case ValueType.Percentage:
      return `${value.toNumber()}%`;
    case ValueType.Pending:
      return "…";
    case ValueType.Error:
      return "";
    default:
      return String(value.toNumber());
  }
}
```

Handle `Pending` and `Error` explicitly. They are ordinary value types rather
than exceptions, so a formatter that assumes every value is a finished number
will render "NaN" the moment a currency line is still loading.
