---
title: Writing an async data source
description: Plugging your own live data into the engine with an async resolver.
---

The built-in async lookups are currency, weather and stocks. To resolve
something else, exchange rates from your own service, prices from your own API, a
value from a database, you register an async resolver.

This is the async half of a package. It assumes you have read
[writing a package](/packages/authoring-a-package/), because a data source needs
two things: a piece of **syntax** that triggers it (a symbol, a function name, a
phrase) and a **resolver** that fetches the data. This page is the resolver.

## The contract

A resolver implements
[`IAsyncResolver`](/api/resolvers/interfaces/iasyncresolver/): a namespace, a
`preflight` check, and a `destroy` for cleanup.

```ts
import type { IAsyncResolver, AsyncCheckResult } from "solve-engine/resolvers";
import { uomValue, type Value } from "solve-engine/vm";

class RatesResolver implements IAsyncResolver {
  readonly namespace = "myrates";

  preflight(tokens, bytecode, packageId, signal): AsyncCheckResult | null {
    const pair = readPairFromTokens(tokens); // your syntax, your parse
    if (!pair) return null;                  // this line is not for us

    const queryKey = `${packageId}:rates:${pair.from}:${pair.to}`;
    if (this.cache.has(queryKey)) return null; // already have it, run synchronously

    return {
      queryKey,
      packageId,
      signal,
      resolver: this.fetchRate(pair, signal),
    };
  }

  private async fetchRate(pair, signal): Promise<Value> {
    const res = await fetch(`https://example.com/rate/${pair.from}/${pair.to}`, { signal });
    const rate = await res.json();
    this.cache.set(/* queryKey */, rate);
    return uomValue(rate.value, pair.to);
  }

  destroy() {
    this.cache.clear();
  }
}
```

Register it on the package alongside the syntax that triggers it:

```ts
engine.registerPackage({
  name: "my-rates",
  asyncResolvers: [new RatesResolver()],
  // prefixParselets / infixParselets: the syntax, see writing a package
});
```

## Resolvers that never reach a network

A host can switch live data off (`network.enabled: false`, see [switching live
data off](/guide/async-and-live-data/#switching-live-data-off)). With it off the
engine does not call a resolver's `preflight` at all, so no request is ever
started. A resolver that reads engine state rather than a network, one that
waits for a value another line declares, or looks up a table the host loaded up
front, declares itself `local` and keeps running:

```ts
class TableResolver implements IAsyncResolver {
  readonly namespace = "mytable";
  readonly local = true;
  // preflight and destroy as above
}
```

Leave it unset for anything that fetches. The setting is the host's promise that
nothing leaves the process, and a fetching resolver marked `local` would break
that promise on the host's behalf.

A plugin function that fetches on a cache miss (because its input is known only
when the line runs, so preflight had nothing to scan) is the other place a
request can start. The engine refuses the promise such a function returns when
live data is off, but by then the request has already left. Check the setting
the function is handed before starting one:

```ts
const pluginFunction = (args: Value[], context?: LineExecutionContext) => {
  const queryClient = context?.queryClient;
  const cached = queryClient?.getQueryData(keyFor(args));
  if (cached !== undefined) return cached as Value;
  if (context?.networkEnabled === false) {
    return errorValue("NETWORK_DISABLED", "Live data is switched off for this engine (network.enabled is false)");
  }
  if (queryClient === undefined) return errorValue("MYRATES_NO_CACHE", "No engine cache to fetch into");
  return queryClient.fetchQuery({ queryKey: keyFor(args), queryFn: ({ signal }) => fetchIt(args, signal) });
};
```

The built-in historical exchange rate does exactly this for `x in GBP on
2024-01-15`, where the source currency is the value of `x` and preflight cannot
see it.

## Reading the engine's cache

Each engine keeps what its resolvers fetched in a cache of its own, a TanStack
Query `QueryClient`. A plugin function reads that cache from the execution
context it is handed, `context.queryClient`: the engine running the line puts
its own cache there, on the first pass, on the re-run when a value lands, and in
a what-if pass, which runs on a scratch engine with its own. So two engines in
one process each read their own cache, whichever of them ran last.

`preflight` is handed the same cache as its last argument, so the two halves of
a resolver meet in one place. A resolver built with `createQueryResolver` reads
the context for you.

The boundary: `getActiveQueryClient()`, the one module-level slot a plugin
function used to read the cache from, still works and is deprecated. The engine
used to publish its cache there before each line and put the previous one back
around every nested run, and a re-run that missed one of those steps read
another engine's cache. The engine sets it at every plugin call now, so an old
handler keeps reading the right cache, but new code should read the context.
The slot is removed in 3.0.

## Preflight runs before the VM, and stays synchronous

`preflight` is called before an expression executes, for every expression unless
you [name the opcodes you watch](#name-the-opcodes-you-watch), so it has to be
cheap. Its only job is to answer one question: is all the data this line needs
already cached?

- **Yes**, or the line is not ours: return `null`. The expression runs normally.
- **No**: start the fetch, return an `AsyncCheckResult` carrying the promise, and
  return immediately. The engine skips execution and reports `Pending`.

Do not `await` inside `preflight`. It creates the promise and hands it back; the
engine waits on it, caches the result, and re-evaluates the line. That
re-evaluation finds the data cached, so `preflight` returns `null` and the line
produces a real value. The [pending lifecycle](/guide/async-and-live-data/) is
the consumer's side of this same loop.

## Name the opcodes you watch

A compiled expression is a list of small numbered instructions, called opcodes:
push a number, push a string, add, call a plugin function, read a global. A
`preflight` is a scan of that list for the few instructions it can act on, and
it returns `null` for a line that has none of them. A document has far more
plain lines than live ones, so by default most of what a resolver does is say
"not mine".

`watchedOpcodes` names those instructions up front. For a line that contains
none of them the engine gives the `null` itself, without calling `preflight`,
and a line no registered resolver could intercept skips the preflight
altogether, along with the per-evaluation `AbortSignal` and its link to the
keystroke.

```ts
import { OpCode } from "solve-engine/parser";

class RatesResolver implements IAsyncResolver {
  readonly namespace = "myrates";
  // The scan reads the unit names PUSH_STRING carries, so a line with no
  // string constant cannot be a conversion.
  readonly watchedOpcodes = [OpCode.PUSH_STRING];
  // preflight and destroy as above
}
```

The declaration is a promise about your own `preflight`: for a line containing
none of the listed opcodes, it would have returned `null`. List every opcode the
scan keys on. Where there is a choice, name the one an ordinary line does not
carry: the built-in currency resolver watches `PUSH_STRING`, which every unit
name arrives as, rather than the `ADD` its scan also checks, because `ADD` is in
nearly every line and declaring it would spare nothing. A resolver built with
`createQueryResolver` declares `CALL_PLUGIN` and `CALL_PLUGIN_WIDE` for you.

The boundary: leave it unset and nothing changes, `preflight` runs for every line
as it always has, so the cost of not declaring is speed, never a missed lookup.
And a line that calls a plugin function is preflighted by every resolver
whatever it declared, since that is the one shape whose pending path the virtual
machine itself relies on.

## The query key is the deduplication

Two lines asking `100 USD` and `250 USD` in the same pair should share one fetch.
The `queryKey` is how the engine knows they are the same request: build it from
what the query depends on, not from the whole expression. Same key, one fetch,
both lines updated when it lands.

## Honour the signal

The `signal` is an `AbortSignal` that fires when the evaluation it belongs to is
superseded, because the user kept typing, or the engine was cleared. Pass it to
`fetch` so a stale request is cancelled rather than resolving into a document
that has moved on. This is what stops a slow response from overwriting a newer
answer.

## Limiting requests in flight

A document can ask for hundreds of values at once: a pasted list of places, each
on its own line, is one weather lookup per line. Started together, those are
hundreds of connections to one service from the reader's own address, which a
service may throttle or block, and which a hostile document could use on
purpose. A resolver built with `createQueryResolver` runs at most six fetches at
once and queues the rest, in the order they were asked for. `maxConcurrent` sets
the number:

```ts
const { resolver, pluginFunction } = createQueryResolver({
  namespace: "tides",
  pluginFunctionIndex: TIDES_FN,
  fetchQuery: (port, signal) => fetchTide(port, signal),
  maxConcurrent: 2,          // this service allows two connections per client
  timeoutMs: 8_000,
});
```

The contract for a queued fetch:

- **The timeout starts when the fetch does.** `timeoutMs` counts the request,
  not its wait for a slot, so a long queue does not time out requests that never
  ran.
- **A fetch that ignores its signal still gives its slot back at the deadline.**
  The resolver stops waiting for it then, and the line gets the timeout error; a
  request already sent cannot be recalled.
- **A query asked for again while it waits shares the one fetch**, as it does
  once running, because the query key is the deduplication.
- **A query cancelled while it waits leaves the queue** and never fetches: the
  signal `fetchQuery` would have been given aborts first, as it does when the
  query client cancels the query.

The limit is one per resolver, shared by every engine in the process that
registers the package. It is a positive whole number, or `Infinity` to switch it
off, and any other value is refused when the package is built.

The boundary: this bounds how many requests run together, not how many run. A
document of 500 places still makes 500 lookups, six at a time; a rate per minute
is not part of it. A resolver you write by hand, without `createQueryResolver`,
has no limit unless it keeps one of its own.

## Refreshing on a schedule

By default a resolved value refreshes only when its line is re-evaluated and has
gone stale. To keep an on-screen value fresh while a note sits open, declare a
cadence on the `AsyncCheckResult` your `preflight` returns: `refetchIntervalMs`
is how often to refetch, and `refetch` forces a fresh fetch, past your cache, and
returns the new value.

```ts
return {
  queryKey,
  packageId,
  signal,
  resolver: this.fetchRate(pair, signal),
  refetchIntervalMs: 60_000,                    // refresh an on-screen rate once a minute
  refetch: () => this.fetchRate(pair, this.refreshSignal),
};
```

The engine drives the refetch for the values currently on screen and pushes each
fresh result to the host on the event stream, the same one the pull path uses. It
does nothing unless the host enabled background refresh (`backgroundRefresh.enabled`),
and a value with no cadence stays pull-only. A value no line references any more
stops at once, and a refetch still running when the next is due is skipped rather
than stacked, so give `refetch` an `AbortSignal` you own and abort in `destroy()`.
The [pending lifecycle](/guide/async-and-live-data/#refreshing-on-a-schedule) is
the consumer's side of this.

## Saying where a value came from

A figure a resolver fetches is true at one moment according to one provider, and
a host can only say so if the value does. Every `Value` has a `sources` field for
that: a list of records naming the provider, how the figure was obtained, and
when (see [where a live value came from](/guide/async-and-live-data/#where-a-live-value-came-from)
for what a host does with it). Set it on the value your fetch returns, and the
engine carries it through every line computed from that value; you do nothing
further.

```ts
private async fetchRate(pair, signal): Promise<Value> {
  const res = await fetch(`https://example.com/rate/${pair.from}/${pair.to}`, { signal });
  const rate = await res.json();
  const value = uomValue(rate.value, pair.to);
  value.sources = [{
    provider: "Example Rates",   // who supplied it, as a reader should see it
    kind: "live",                // or "historical" for a figure for a past day
    fetchedAt: Date.now(),       // when it arrived, in epoch milliseconds
    subject: `${pair.from}/${pair.to}`,
  }];
  return value;
}
```

A resolver built with `createQueryResolver` does this for you: it stamps each
value its `fetchQuery` returns with a `live` record whose `provider` is the
option of that name (the namespace if you leave it out), whose `subject` is the
query, and whose `fetchedAt` is the moment the fetch returned. A value that
already carries `sources` is left as it is, which is how a package records what
only it knows. The stocks package's historical close does this:

```ts
const value = uomValue(quote.close, quote.currency ?? "USD");
value.sources = [{ provider, kind: "historical", fetchedAt: Date.now(), subject: ticker, asOf: isoDate }];
return value;
```

The built-in packages name their providers: `Frankfurter` and `CoinGecko` for the
rates the engine fetches itself (live rates, and historical rates for a past day),
`Open-Meteo` for weather, and for the packages that take a host's fetch (stocks,
crypto, knowledge) a `provider` option, `host` by default. A host that replaces
the historical exchange rate with its own names it with `historicalProviderName`.

Three boundaries. A failed fetch returns an Error value, which is not a figure and
carries no record, so do not stamp one. The record is set once, as the value
arrives; do not change it on a value you have already returned, because the
engine shares that value between every line that reads it. And a line the reader
froze (`... frozen`) never reaches your resolver once its answer is kept: the
engine answers it from its own store, so a resolver needs no special case for
[frozen answers](/syntax/frozen-answers/).

## A built-in source a host can replace

A package can ship a working source and still let a host bring its own. The
currency package's historical rate is the worked example. `createCurrencyPackage`
takes a `historicalRateProvider` option:

| Value | What answers `100 USD in GBP on 2024-01-15` |
| --- | --- |
| left out | the built-in Frankfurter provider (the European Central Bank's reference rates) |
| a function | the host's function, which takes precedence |
| `null` | nothing: the line reports `HISTORICAL_RATES_NOT_CONFIGURED` |

The provider's contract is small: `(from, to, isoDate, signal) => Promise<number |
{ rate, asOf }>`. It receives upper-case currency codes, the day as `YYYY-MM-DD`
and the signal to pass to `fetch`; it returns the rate, with `asOf` when the rate
it found was published for an earlier day (a weekend asked for, Friday answered).
Three things are the package's job, not the provider's, and hold whichever
provider answers: the query key and its never-stale cache (a past day's rate does
not change), the timeout, and refusing an answer that is not a finite, positive
number rather than converting through it.

The built-in provider decides its own boundary before any request and says why
in the error: a day before 4 January 1999 (`HISTORICAL_RATE_DATE_OUT_OF_RANGE`,
since earlier figures are not ECB reference rates), a day after today (the same
code), and a currency the ECB does not quote (`HISTORICAL_RATE_UNSUPPORTED_CURRENCY`).
A host provider that throws an `EngineError` with one of those two codes has its
refusal shown as it is; anything else it throws becomes
`HISTORICAL_RATE_QUERY_FAILED`, named with the pair and the day.

The same provider can be built with a stub fetch, which is how its tests run
without the network:

```ts
import { createFrankfurterHistoricalRateProvider } from "solve-engine/packages";

const provider = createFrankfurterHistoricalRateProvider({
  fetch: async () => new Response(JSON.stringify([{ date: "2024-01-15", base: "USD", quote: "GBP", rate: 0.78441 }])),
});
```

Tests that call a real service belong outside the gates: the engine's own run
only with `SOLVE_LIVE_NETWORK=1` (`npm run test:live`), where a timeout, a 5xx
and a 429 count as outages rather than failures.

## A complete reference

The currency package is the smallest built-in that does all of this: a symbol
and an `in` parselet for the syntax, `CurrencyAsyncResolver` for the live fetch,
and `uom/HistoricalCurrency.ts` with `uom/FrankfurterHistoricalRates.ts` for the
dated one. Read them alongside this page for the parts the skeleton above leaves
to you.
