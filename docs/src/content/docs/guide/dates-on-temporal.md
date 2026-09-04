---
title: Dates on Temporal
description: Computing dates through the Temporal API, in a time zone you choose, with every result unchanged.
---

Every date the engine works with is an instant: a number of milliseconds since
1 January 1970, with no time zone attached. Every question it answers about a
date is a calendar question about that instant: which day it falls on, what the
same time a month later is, whether it is a Saturday, how it is written out.
Answering needs a time zone and a set of calendar rules, and by default the
engine takes both from the JavaScript `Date` object, which reads the zone of the
process it runs in and nothing else.

This page is about the other ways to answer them, both of which let you choose
the zone. The one it is named after is `Temporal`: opt-in, behind its own entry
point, and a host that does not opt in ships none of it. The other is
[`dateCalendarInZone`](#choosing-a-zone-without-temporal), which names a zone on
the `Date` backend everyone already has, and needs nothing installed. If all you
want is a zone, start there.

## What Temporal is

`Temporal` is the JavaScript standard library's replacement for `Date`. Where
`Date` is one number wearing the process's time zone, `Temporal` has a type for
each thing a date can be: an instant, a calendar date with no time, a wall-clock
time, and a date-time pinned to a named zone such as `Asia/Tokyo`. The last of
those is what `Date` cannot express, and it is why the engine can compute a
document in Tokyo from a server in London once it has `Temporal` to hand.

It is new enough that not every runtime has it. Node 26 ships it switched on;
Node 22 and 24, which the engine also supports, do not (Node 24 keeps it behind
`--harmony-temporal`). Current Chrome, Edge, Firefox, Deno and Bun have it;
Safari does not, in any stable release. Where the runtime has none, a polyfill
supplies it.

## Why the engine does not bundle it

The engine imports no `Temporal` and no polyfill, and that is deliberate. The
smallest polyfill, `temporal-polyfill` 1.0.4, adds 20.4 KB gzipped (58.6 KB
minified) to a bundle, measured by bundling its entry with esbuild and
compressing with gzip at level 9. A host doing plain arithmetic, or one whose
users never type a date, should not pay that, and a host on Node 26 or a
current browser already has a native `Temporal` that a bundled polyfill would
only duplicate.

So the backend takes the implementation from you. Import it from
`solve-engine/temporal`, hand it whichever `Temporal` you have, and pass the
result as the engine's `calendar` option. The entry is reached by nothing else
in the package: a smoke test walks every chunk the root entry loads and refuses
one that carries the backend's code, so `import { createEngine } from
"solve-engine"` is the same bundle whether or not this entry exists.

## Choosing a zone without Temporal

A time zone and a calendar implementation are two different asks, and most hosts
only have the first. `dateCalendarInZone` answers it on the `Date` backend that
ships in the box: it takes an IANA zone name and hands back a backend that reads
that zone as "local", with no polyfill, no extra entry point and nothing added
to the bundle.

```ts
import { createEngine, dateCalendarInZone } from "solve-engine";

const engine = createEngine({ calendar: dateCalendarInZone("Asia/Tokyo") });
```

Everything the next section says about what a zone changes applies here too: a
date literal is midnight in Tokyo, `9:00am` is nine o'clock there, `today` is
Tokyo's day, and a day step across a daylight-saving change holds the wall clock
rather than adding twenty-four hours. Reading the zone data is the same
`Intl.DateTimeFormat` the `Date` backend already uses for `time in Paris`, so
the answers come from the runtime's own IANA database.

A zone this runtime cannot format with is refused where you name it, with a
coded `DATE_ZONE_UNKNOWN` error, rather than answering in some other zone once
per line:

```ts
dateCalendarInZone("Europe/Atlantis");
// throws: dateCalendarInZone("Europe/Atlantis") is not a time zone this runtime knows.
```

There is deliberately no `date.zone` configuration field beside it. The zone
belongs to the calendar backend, which already owns what "local" means; a second
place to say it is how the two come to disagree.

The one thing this does not give you is `Temporal`'s own answer for a wall clock
a daylight-saving change skipped or repeated. 01:30 on a spring-forward morning
never happened, and on a fall-back morning it happened twice, so the instant it
names is a choice; `Temporal` makes that choice explicitly with
`disambiguation: 'compatible'` and this backend makes it with an offset lookup,
and the two can differ by an hour for exactly those readings. Every other
answer is the same, which is what the rest of this page is about.

## Opting in

### With the runtime's own Temporal

On Node 26 or a current browser, `globalThis.Temporal` is the implementation.
Pass it directly.

```ts
import { createEngine } from "solve-engine";
import { createTemporalCalendar } from "solve-engine/temporal";

const calendar = createTemporalCalendar(globalThis.Temporal, { timeZone: "Asia/Tokyo" });
const engine = createEngine({ calendar });
```

TypeScript 5.9 does not yet declare `Temporal` in its standard library, so the
property is not typed. `createTemporalCalendar` takes a `TemporalLike`, a
structural description of the small part of the namespace the backend uses,
and a typed read of the global fits it:

```ts
import { createTemporalCalendar, type TemporalLike } from "solve-engine/temporal";

const native = (globalThis as { Temporal?: TemporalLike }).Temporal;
if (native === undefined) throw new Error("this runtime has no Temporal; install a polyfill");
const calendar = createTemporalCalendar(native);
```

A value that is not a usable `Temporal` (a missing `Now.instant`, say) is
refused at construction with a coded `TEMPORAL_IMPLEMENTATION_INVALID` error
naming the member, rather than failing inside the first date computed.

### With a polyfill

Where the runtime has no `Temporal`, install one and pass its export. The
`temporal-polyfill` package is MIT-licensed and the one the engine's own test
suite uses:

```ts
import { Temporal } from "temporal-polyfill";
import { createTemporalCalendar } from "solve-engine/temporal";

const calendar = createTemporalCalendar(Temporal, { timeZone: "Europe/Paris" });
```

Its default entry hands back the runtime's native `Temporal` when there is one
and its own implementation otherwise, so the same line serves both kinds of
host; `temporal-polyfill/implementation` always gives the polyfill's own.
Installing it globally (`temporal-polyfill/global`) works too, after which
`globalThis.Temporal` is the value to pass.

### Displaying dates and running in a worker

Two things sit outside the engine and are told about the backend separately.
`formatValue` is a free function with no engine in hand, so it reads the
backend from its settings: pass the same one, and a date displays in the zone
it was computed in.

```ts
import { formatValue } from "solve-engine/format";
import { DEFAULT_FORMATTING_SETTINGS } from "solve-engine/format";

formatValue(engine.evaluateExpression("today"), { ...DEFAULT_FORMATTING_SETTINGS, calendar });
```

A worker cannot receive it from the main thread: a backend is an object of
functions, and functions do not cross a `postMessage` boundary. A host running
the engine behind `solve-engine/worker` bakes the backend into its worker entry,
the way it bakes in a custom package, and the runtime applies it to the
formatting the main side sends:

```ts
import { startWorkerRuntime } from "solve-engine/worker";
import { createTemporalCalendar } from "solve-engine/temporal";

startWorkerRuntime(transport, { calendar: createTemporalCalendar(globalThis.Temporal, { timeZone: "Asia/Tokyo" }) });
```

## What changes: the time zone

The `Date` backend reads the process's zone. The `Temporal` backend reads the
zone it was built with, `timeZone`, which defaults to the runtime's own so that
leaving it out changes nothing. Name a zone, and every date the engine computes
is computed there: `today` is that zone's day, a date literal is midnight there,
`9:00am` is nine o'clock there, and `days in February 2024` is read there.

At 22:00 UTC on 26 August 2026 it is still Wednesday in New York and already
Thursday in Tokyo, and two engines built in those zones say so:

```ts
const tokyo = createEngine({ calendar: createTemporalCalendar(Temporal, { timeZone: "Asia/Tokyo" }) });
const newYork = createEngine({ calendar: createTemporalCalendar(Temporal, { timeZone: "America/New_York" }) });

tokyo.evaluateExpression("today as weekday").value;   // "Thursday"
newYork.evaluateExpression("today as weekday").value; // "Wednesday"
```

A zone the implementation does not know is refused at construction with a
coded `TEMPORAL_TIME_ZONE_UNKNOWN` error, so a misspelt zone is a configuration
fault seen once rather than a `RangeError` inside every date.

The backend also takes a `now` option, a function answering the current
instant in epoch milliseconds, for a test that needs a fixed date. It exists
because fake-timer libraries replace `Date.now`, which the `Date` backend reads,
but not `Temporal.Now`.

## What does not change: every result

That is the whole of the observable difference. Every other answer is the same
whichever backend an engine computes with, and this is a constraint the
backend is built to rather than a hope: `Temporal` and `Date` disagree by design
about an instant past the range `Date` represents (a `RangeError` against
`NaN`), a fractional millisecond (a throw against truncation), a day past the
end of a month (a clamp against a roll into the next month) and a year from 0
to 99 (read literally against read as the 1900s), and the backend reproduces
`Date`'s reading of each. A month step still clamps to the end of the month, a
working-day count still skips the same weekends, a named-zone conversion still
answers the same wall-clock time:

```solve
31/01/2024 + 1 month // Thursday, February 29, 2024
2nd Tuesday of March 2026 // Tuesday, March 10, 2026
working days between 01/01/2024 and 31/01/2024 // 23
3pm Tokyo in Delhi // 11:30 AM
```

These are proven on the `Date` backend by the documentation's own test, and a
differential suite (`packages/engine/__tests__/temporal/`) runs every documented
example and a corpus of date and time forms through both backends at fifteen
pinned instants, the daylight-saving days of five zones among them, and
asserts the two answers are identical: the value's type, its display, and a
date's instant to the millisecond. `npm run test:temporal` goes further and
runs the whole of the engine's date and time suites with every engine on the
`Temporal` backend, in London, New York and Auckland, polyfilled on Node 22 and
native on Node 26.

## The boundary

- **Two implementations, one known defect.** `temporal-polyfill` 1.0.4 reads
  London as GMT between 16 March and 13 April 1947, a year with three
  transitions, where `Intl`, `Date` and the native `Temporal` all say BST.
  Across thirteen zones and the years 1840 to 2120 it is the only place the
  polyfill and the runtime disagree; the differential suite excludes that
  window under the polyfill and asserts the defect is still there, so the
  exclusion goes when the polyfill is fixed.
- **Strings outside the ISO 8601 format.** `"…" to date` admits only the
  format, so both backends read the same strings. Given a string outside it
  directly, the `Date` backend may guess through the runtime's legacy parser
  (`"2019/04/01"` reads as local midnight in V8) where the `Temporal` backend
  answers `NaN`; nothing in the engine passes such a string.
- **Spans that cross a daylight-saving change.** `days between two dates` counts
  whole calendar days, so `days between 28 March 2026 and 30 March 2026` is
  `2 days` in every zone even where the clocks moved between them. Subtracting
  one date from another is still elapsed time in milliseconds, so
  `30 March 2026 - 28 March 2026` reads `47:00` in London and `48:00` where
  nothing changed that weekend. That is the engine's own arithmetic and the same
  on both backends.
- **The offsets of local mean time.** Before a zone adopted standard time
  (London in 1847, New York in 1883) its offset was not a whole number of
  minutes. `Date` truncates it to whole minutes, and the backend does the same,
  so `as iso8601` on an 1840 date shows the same offset either way.
- **The engine's inline offload worker** computes with the `Date` backend; the
  public `solve-engine/worker` runtime takes the option as shown above.
