---
"solve-engine": minor
---

The engine computes dates on `Temporal` wherever the runtime has one.

`Temporal` is the JavaScript standard library's replacement for `Date`, and it is no longer a curiosity: Chrome, Edge, Firefox and Opera ship it, Node ships it from 26, and it covers about 71% of browsers by usage. Where it is absent (Node 22 and 24, Safari, iOS) the engine falls back to `Date`, which is what every engine computed with before.

Nothing is asked of a host to get this, and no polyfill is bundled. What the engine carries is the adapter, the code that translates its calendar contract onto whichever implementation it finds.

| root bundle, gzipped | bytes |
| --- | --- |
| before | 98,981 |
| now, with the adapter | 100,626 |
| had a polyfill been bundled instead | about 118,000 |

The adapter costs 1,645 bytes. The smallest polyfill is 20.4 KB gzipped, twelve times that, and on a runtime that already has `Temporal` it would only duplicate what is there. A smoke test walks every chunk the root entry loads and fails if one names a polyfill package, or if the adapter has gone missing and the engine can no longer prefer `Temporal` at all.

The `calendar` option pins the choice when it matters.

| `calendar` | what the engine computes on |
| --- | --- |
| omitted, or `"auto"` | `Temporal` where the runtime has it, `Date` otherwise |
| `"temporal"` | `Temporal`, refusing to build an engine on a runtime without one |
| `"date"` | `Date`, whatever the runtime has |
| a backend | the one you built, from a polyfill or bound to a time zone |

Pin `"date"` when a result must not depend on where it was computed, and `"temporal"` when you would rather an engine refuse to start than quietly compute on `Date`; that refusal is a coded `CALENDAR_TEMPORAL_UNAVAILABLE` error naming both ways out.

No result changes. The two backends are held to the same answers, which is what makes preferring one safe rather than a coin toss: `npm run test:temporal` runs the date suites under both in three time zones, and a differential suite compares them case by case. A reader on Firefox and a reader on Safari see the same number.

The boundary: this changes which implementation computes a date, not what a date means. The engine's payload is still epoch milliseconds with no zone attached, so a `Temporal` engine does not yet answer a question a `Date` engine could not. What it buys is the ground for the zone-aware work to stand on, and one fewer reason to reach for a polyfill.
