---
title: The same answer on every run
description: What makes a result change between runs and machines, and the setting that pins each one.
---

A document is deterministic when it gives the same answers every time it is
evaluated, on every machine. Most lines are: `2 + 2` is 4 anywhere. A few read
something from outside the document, such as the time, the machine's time zone,
a random number or a live exchange rate, and those change from run to run.
That is what a reader wants from `today` in a notes app, and what a test, a
snapshot, a cache keyed on a result or a report regenerated next month does not
want.

This page lists every such input the engine has and the setting that pins it.
Pin the ones a document can reach, and its answers stop depending on when and
where it ran.

```ts
import { createEngine, dateCalendarInZone } from "solve-engine";

const engine = createEngine({
  calendar: dateCalendarInZone("UTC", { now: () => Date.UTC(2026, 0, 1) }),
  random: { seed: 42 },
  config: { network: { enabled: false } },
});

engine.formatValue(engine.evaluateExpression("today")); // "= Thursday, January 1, 2026"
```

## The clock

`today`, `now`, `tomorrow`, `next friday` and every line counted from one of
them read the calendar backend's clock. By default that is the real time, so the
answer moves on every run. Give the backend a clock of its own, a function
answering the moment in epoch milliseconds (the milliseconds since the start of
1970), and the date is fixed:

```ts
dateCalendarInZone("UTC", { now: () => Date.UTC(2026, 0, 1) });
createTemporalCalendar(Temporal, { timeZone: "UTC", now: () => Date.UTC(2026, 0, 1) });
```

Both backends check the clock the same way. One that is not a function is
refused when the backend is built, and a reading that is not a moment in time
(`NaN`, an infinity, a number past the range a date can hold), or a clock that
throws, is refused on the line that read it with `DATE_CLOCK_INVALID`. A
fake-timer library that replaces `Date.now` pins the `Date` backend's default
clock but not `Temporal.Now`, which is the reason the option exists.

## The time zone

Which day an instant falls on depends on the zone it is read in: at 22:00 UTC
it is already tomorrow in Tokyo. An engine given no calendar computes in the
host process's zone, so the same document can answer a different day on a
server in London and a laptop in Sydney. Name the zone to pin it:
`dateCalendarInZone("UTC")`, or the `Temporal` backend's `timeZone`.

The default calendar option, `"auto"`, computes on `Temporal` where the runtime
has it and on `Date` where it does not. The two are held to the same answers,
so this does not move a result, but a host that must not depend on the runtime
at all passes a backend itself. [Dates on Temporal](/guide/dates-on-temporal/)
covers both backends and the zone in full.

## Random draws

`roll`, `pick`, `shuffle`, `coin`, `uuid` and `random()` draw from
`Math.random` unless told otherwise, so they differ on every run. A seed makes
them repeat: `createEngine({ random: { seed: 42 } })`, or a `random seed 42`
line in the document itself, which takes precedence. With a seed, a line's draw
changes only when that line is edited. See [random](/syntax/random/).

## Live data

Currency conversions, weather, stock prices and the other live-data forms fetch
from a public service, and the answer is whatever the service says at that
moment. `config: { network: { enabled: false } }` stops every fetch before it is
made, and each live-data line answers with a `NETWORK_DISABLED` error naming the
setting. Exchange rates a host supplies itself
(`currencyExchangeService.primeRates`) keep working with the network off, which
is how a test gets a fixed conversion.

The switch is the `enabled` field inside the `network` section. `network: false`
is not it: a section is merged field by field over the defaults, a `false` in
place of the section has no fields to merge, and the network stays on. See
[security](/guide/security/) for what the switch does and does not stop.

## Values shared between documents

A `global :name` variable is shared by every engine in the same JavaScript
realm (one page, one worker, one Node process), which is the point of it: one
document sets a rate and another reads it. It also means a document that reads
a global answers with whatever another document wrote last. A run that must not
depend on other documents keeps globals out of the document, or evaluates in a
realm of its own.

## Writing the answer out

The text a value is written as depends on the formatter's settings as well as
the value. The free `formatValue` with no settings writes numbers in `en-US` and
dates in the host process's zone, which for an engine computing in another zone
can name a different day from the one it computed. `engine.formatValue` writes
with the engine's own calendar and locale, and a worker runtime does the same,
so neither depends on the machine: an engine locale `Intl` has no number data
for (`xx`) is written in `en-US` there, rather than in whatever locale the
machine runs in. A host that passes `numberResult.decimalSeparatorLocale` itself
passes a tag `Intl` knows, since the free formatter hands it to `Intl` as it is.
[Formatting results](/guide/formatting/) covers the settings.

## Errors

An `EngineError` records the moment it was built, `error.timestamp`, and its
`toJSON()` includes it, so two runs that fail the same way serialise to
different text. Compare a failure by its `code` and `message`, which are stable,
rather than by the whole serialised error.

The boundary: this page covers what the engine itself reads from outside a
document. A package a host adds can read anything (a clock, a file, a service of
its own), and pinning that is the package's to document.
