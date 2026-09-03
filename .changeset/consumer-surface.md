---
"solve-engine": minor
---

The root entry now exports `Value`, `ValueType`, `formatValue` and the `FormattingSettings` type, so reading and displaying a result needs no import from `solve-engine/vm` or `solve-engine/format`. Both subpaths keep exporting them; this is the same binding under the name a first-time reader reaches for.

```ts
import { createEngine, ValueType, formatValue } from "solve-engine";
```

The worker DTO `SerializedValue` is renamed `SerializedWorkerValue`. The old name stays as a deprecated alias for at least one minor release. The root entry's `SerializedValue`, the snapshot shape, is unchanged, and the two carrying one name from two subpaths was the clash this resolves.

The batcher's "onLineResult is not set" warning no longer fires for a host reading `getEventStream()`, which is the documented way to consume live values; it fires only when nothing at all is listening, and its wording names both options.
