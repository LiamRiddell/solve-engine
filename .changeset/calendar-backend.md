---
"solve-engine": minor
---

Every date the engine computes now goes through one calendar backend, and the backend is an engine option.

```ts
import { createEngine } from "solve-engine";
import { DATE_CALENDAR } from "solve-engine/engine";

const engine = createEngine({ calendar: DATE_CALENDAR });
```

The `calendar` option takes a `CalendarBackend`, the interface behind which the engine reads which local day an instant falls on, steps days and months, walks working days, reads `now`, parses and writes ISO 8601, formats a date and resolves a named time zone. It defaults to the built-in `Date` backend, which is the code the engine has always run moved behind the interface method by method, so an engine that sets nothing computes exactly what it did before: every date result, in every zone, is unchanged. The option exists so a later release can ship a `Temporal` backend, behind its own entry point, that carries a time zone of its own; the engine still imports no polyfill.

An `as` converter now receives the same optional execution context a plugin function does, `(value, context?) => Value`, so a converter that reads a date computes through the engine's backend rather than a module-level default. A converter that ignores the second argument is unchanged.

Every site the engine owns reads the option: the VM's date opcodes, the plugin functions and `as` converters, the rules that fuse a date literal, and the parser for the forms that read a literal while parsing (`days in <period>`, the stocks and historical-currency date phrases). Two sites sit outside the engine and are told separately. `formatValue` is a free function with no engine in hand, so `FormattingSettings` gains an optional `calendar` field: pass the same backend the engine was given and a date displays in the zone it was computed in; leave it out and the display reads the `Date` backend, as before. A worker runtime takes it on a new `WorkerRuntimeOptions.calendar`: a backend is an object of functions and does not cross the message boundary, so a host with its own bakes it into its worker entry, as it does for a custom package, and the runtime applies it to the formatting the main side sends. The inline offload worker computes with the `Date` backend.
