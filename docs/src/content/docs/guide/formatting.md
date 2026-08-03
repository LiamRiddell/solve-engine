---
title: Formatting results
description: Turning a value into display text, and controlling how.
---

Evaluation and presentation are separate. The engine produces a value; turning
it into text is a second step you control.

```ts
import { formatValue } from "solve-engine/format";

formatValue(value); // "= 300.00 cm"
```

The leading marker suits an editor gutter. Strip it when rendering elsewhere.

## Settings

Formatting takes optional settings covering decimal places, thousands
separators, currency display and date format. They default from the engine's
locale.

```ts
formatValue(value, {
  decimalPlaces: 4,
  useThousandsSeparator: false,
});
```

## Formatting yourself

Nothing obliges you to use the built-in formatter. A value exposes its type, its
raw payload and its unit, which is enough to render however your product needs.
