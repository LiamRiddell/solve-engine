---
title: Embedding the engine
description: Creating an engine, configuring it, and reading results.
---

```ts
import { createEngine } from "solve-engine";

const engine = createEngine({ locale: "en" });
```

The `locale` option decides the language the engine reads its keywords in and
how it reads numbers: which character marks the decimal and which groups
thousands. It takes a language code (`en`, `de`, `fr`) or a full tag such as the
`de-DE` a browser reports, which reads as its language; any other code reads as
English. See [locales](/guide/locales/) for what each language pack accepts.

The order of an ambiguous date such as `03/04/2026` is a separate setting,
because it is a question of region rather than language: a German engine reads
it as 3 April, as an English one does. It is `config.date.inputOrder`, and
`'locale'` with `config.date.inputLocale` takes it from a region such as `en-US`
(see [date literals](/syntax/date-literals/)). The shape of the week, its
weekend days and the day it starts on, is `config.date.weekend` and
`config.date.firstDayOfWeek`, and otherwise comes from the region of the locale
tag, as [working days](/syntax/working-days/#which-days-are-the-weekend) sets
out.

## Configuration

The `diagnostics` and `config` options enable diagnostics and override
configuration. Both are optional.

```ts
const engine = createEngine({
  config: {
    validation: {
      maxExpressionLength: 1000,
      maxComplexity: 500,
    },
  },
});
```

`config` is an `EngineConfigOverride`, merged per section over the defaults: name
only the fields you change and every other field keeps its default.

An option, a section or a setting the engine does not have is ignored, and the
engine says so with a console warning that names the nearest real one, since a
misspelling otherwise passes without a word. `createEngine({ network: { enabled:
false } })` warns that `network` belongs under `config`, where it switches
live data off; at the top level it did nothing, and live data stayed on. A
warning rather than a refusal, because a host typed against a newer release may
pass an option an older engine does not know.

One section is a policy rather than a limit: `network.enabled`, on by default,
is the switch a host uses to stop every live-data fetch (weather, currency, and
any package resolver). With it off, those forms answer with an error naming the
setting instead of making a request. See
[switching live data off](/guide/async-and-live-data/#switching-live-data-off).

One option is a component rather than a setting: `calendar`, the backend the
engine computes dates with (which local day an instant falls on, what a month
later is, how a date is written out). It defaults to the built-in `Date`
backend, read in the process's time zone, and leaving it unset changes nothing.
It is the seam for a `Temporal` backend, available at `solve-engine/temporal`
(`createTemporalCalendar`), that carries a time zone of its own; see
[one calendar backend](/architecture/design-decisions/#one-calendar-backend-with-date-as-the-default).

`random` does for randomness what `calendar` does for the clock. Unset, `roll`,
`pick`, `shuffle`, `coin`, `uuid` and `random()` draw from `Math.random`, fresh on
every run. Given a seed, any number or text, every draw is the same on every run
and every machine, and a line's draw changes only when that line is edited, which
is what a test, a snapshot or a shared worked example needs.

```ts
const engine = createEngine({ random: { seed: 42 } });
engine.setRandomSeed(7);         // reseed later, or pass undefined to unseed
```

A document can also seed itself with a `random seed 42` line, which takes
precedence over the option (see [randomness](/syntax/random/)). When the seed in
force changes, lines that drew under the old one are dropped from the cache and
draw again. A worker host passes the same `random` option to its client's
`init()`. A seeded draw is repeatable, not unpredictable: do not use one for a
password or a security token.

Safety limits exist because the engine is designed to run on untrusted input as
someone types. They bound expression length, parse complexity, instruction
count, stack depth, and how many elements a range or matrix may be expanded to
by `map`/`reduce` (`vm.maxCollectionSize`, 100000 by default, which is what
stops a typo like `sum(x, 1:100000000)` from allocating until the host runs out
of memory). Two more bound a whole note rather than one line: the work its
cross-line forms do in one pass, and the elements its answers keep. Each
produces a clear error rather than hanging; the
[security page](/guide/security/) lists every limit and its setting.

## Knowing what registered

A package that fails to register (an `engineVersion` the engine does not satisfy,
a keyword a built-in owns, no name) is left out and logged by default, so one bad
package cannot stop the engine being built. `strict: true` throws the package's
coded `EngineError` from the constructor instead, and `onPackageError` is told
of each failure while the rest register. `getRegisteredPackages()` lists the
names that did register, in order:

```ts
const engine = createEngine({
  extraPackages: [myPackage],
  onPackageError: (pkg, error) => showToReader(`${pkg.name} did not load: ${error.message}`),
});
engine.getRegisteredPackages().includes("my-package");
```

A host whose readers see no console, a notes app, say, is the case for the
callback: a package that did not load is otherwise met as a parse error on every
line that uses it.

## Reading a result

```ts
import { ValueType } from "solve-engine/vm";

const value = engine.evaluateExpression("2 + 2");

value.type;        // ValueType.Number
value.toNumber();  // 4
value.unit;        // undefined
```

## Clearing state

An engine accumulates variables and cached results. Call `clear()` to reset it
between documents rather than constructing a new one, which is cheaper. It also
forgets the document's [frozen answers](/syntax/frozen-answers/), which belong to
the document; carry them to the next session in a snapshot.

```ts
engine.clear();
```

## Asking what if

A host often wants to show a note as it would read with different inputs: a
scenario panel, a "what would this cost at 5%" button, two options side by side.
`whatIf` evaluates the whole note with some of its inputs held at other values,
and changes nothing while it does:

```ts
const text = [
  "deposit = 100000",
  "rate = 4%",
  "payment = monthly repayment on deposit over 25 years at rate",
  "payment * 12",
].join("\n");

const scenario = engine.whatIf(text, { deposit: 150000, rate: "5%" });
// line by line: 150,000   5.00%   876.89   10,522.62

engine.parseDocument(text);
// the note itself, unchanged: 100,000   4.00%   527.84   6,334.04
```

It returns the same `ParsingResult` that `parseDocument` does, so a host reads a
scenario exactly as it reads the note. An override is held on every line,
including the line that sets it, which is why line one of the scenario reads
150,000: every line below it reads the override, and so does the line itself. A
[what-if line](/syntax/what-if/) inside the note answers within the scenario,
its own inputs applied on top of the host's.

Nothing about the engine changes. The pass runs in a scratch engine built like
this one (the same packages, configuration, locale, calendar and random seed)
and is thrown away afterwards, so this engine's variables and cached results are
as they were, and an editor wired to it notices nothing.

An override is one of three things:

| Override | Read as |
| --- | --- |
| a number, `150000` | that number |
| text, `"$120"`, `"5%"`, `"3 kg"` | an expression evaluated on its own, so it keeps its unit |
| a `Value` | itself |

Text is a value rather than a formula over the note: `"deposit * 2"` is
refused, since `deposit` has no value outside the note.

It is the same re-run the `line 4 with deposit = 150000` form uses, over the
whole note instead of up to one line, and it reads the note the way
`parseDocument` does, from the top down. It never fetches live data: a line
reading a value this engine has already fetched reads it, and a line still
waiting for one answers with an error saying so. It throws, rather than
guessing, in four cases:

| Code | When |
| --- | --- |
| `WHAT_IF_OVERRIDE_INVALID` | a name is not a variable name, or a value is not a finite number, text that evaluates, or a `Value` |
| `WHAT_IF_INPUT_NOT_USED` | no line of the note uses an overridden name, which is almost always a misspelling |
| `WHAT_IF_WRITES_GLOBAL` | a line sets a `global :name`, which other documents read, so the scenario would reach them |
| `DOCUMENT_TOO_LARGE` | the note is longer than `parseDocument` accepts |

## Snapshotting and restoring state

That accumulated state, the variables, the user-defined functions, and the
per-line result and bytecode caches, lives only in memory. `toJSON()` captures
it as a plain object, and `fromJSON()` restores it onto a fresh engine, so a
host can persist a session, warm-start a process, or move a document between
contexts without re-evaluating the whole thing from scratch.

```ts
import { createEngine, ExpressionEngine } from "solve-engine";
import { BUILTIN_PACKAGES } from "solve-engine/packages";

const engine = createEngine({ locale: "en" });
engine.parseDocument(":price = 100\ndouble(x) = x * 2\n:total = double(price)");

const state = engine.toJSON(); // a plain, JSON-safe object
const json = JSON.stringify(state); // store it anywhere

// Later, in another process:
const restored = ExpressionEngine.fromJSON(JSON.parse(json), { packages: BUILTIN_PACKAGES });
restored.evaluateExpression("double(total)"); // 400, with no re-evaluation
```

The snapshot is plain JSON. It survives `JSON.stringify` and `JSON.parse`
unchanged: `bigint`s are written as strings, non-finite numbers (`Infinity`,
`NaN`) are named rather than turned into `null`, and the compiled bytecode is
carried as ordinary arrays.

### Passing the same packages back

`fromJSON` rebuilds the engine with the snapshot's own locale but, by default,
no packages, exactly as the constructor does. Pass the **same** `packages` set
the snapshot was taken with (`BUILTIN_PACKAGES` for a full engine).

```ts
const restored = ExpressionEngine.fromJSON(state, { packages: myPackages });
```

The order of that list does not matter, and neither does what else the process
has registered. A package function is reached through a number the process
hands out as packages register, so the same function has a different number in
another process, or when the packages arrive in another order. The snapshot
therefore records each call by the package and function behind it, and
`fromJSON` points each call at the function by that name on the restored engine.
A snapshot that calls a function none of the packages provides is refused with
`SNAPSHOT_PACKAGE_MISSING`, rather than restored to run whatever sits at the old
number.

Snapshots written before this (format version 1) still restore. They do not name
their calls, so a cached line that calls a package function is left out and
recompiles when it is next evaluated; everything else restores as before.

`fromJSON` also accepts `config`, `diagnostics`, `calendar` and a `locale` override, all
matching the constructor.

### What is and is not carried

- **Carried:** variables, user-defined functions, the line cache (each line's
  result, compiled bytecode, and the variables it reads and writes, so
  incremental re-evaluation still works), and the expression-keyed bytecode
  cache.
- **Not carried: resolved async values.** Weather, stock, and currency results
  are point-in-time and must be re-fetched, not restored stale (see
  [Async and live data](/guide/async-and-live-data/)). Every line backed by an
  async resolver is dropped from the snapshot, along with any variable whose
  most recent definition came from one, so a restored engine re-fetches rather
  than serving a value from another moment.
- **Carried on request: frozen answers.** A line the reader ended with `frozen`
  asked for its answer to be kept, so it is the one live line a snapshot keeps.
  Its answer, with the moment it was frozen and the sources behind it, is written
  to the snapshot's `frozen` field, and the line and any variable it defines are
  carried like any other line. A restored engine answers those lines from the
  snapshot with no network. A snapshot written before frozen answers existed has
  no `frozen` field and restores exactly as it did. See
  [keeping an answer fixed](/guide/async-and-live-data/#keeping-an-answer-fixed).
- **Not carried: package-contributed state.** Only core engine state is
  snapshotted for now; a package opt-in is planned.
- **Left out: values the format cannot hold yet.** A symbolic (algebra)
  result, a colour, a bill split, a chart and an IP subnet have no snapshot form
  yet. A variable or cached line holding one is left out of the snapshot, and
  `toJSON()` does not throw: one algebra line should not make a whole notepad
  impossible to save. After `fromJSON` the name is undefined until the host
  re-evaluates the document, which defines it again; everything else in the
  snapshot restores as usual.

### Refusing an incompatible snapshot

Every snapshot carries a format version. `fromJSON` restores the versions it
knows (1 and 2) and refuses anything else, or any object that is not a snapshot
at all, with a coded `SNAPSHOT_VERSION_MISMATCH` error rather than restoring it
wrongly.

```ts
import { EngineError } from "solve-engine/errors";

try {
  ExpressionEngine.fromJSON(fromAnOlderEngine);
} catch (e) {
  if (e instanceof EngineError && e.code === "SNAPSHOT_VERSION_MISMATCH") {
    // Regenerate the snapshot, or re-evaluate the document from source.
  }
}
```
