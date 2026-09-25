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
rates the engine fetches itself, `Open-Meteo` for weather, and for the packages
that take a host's fetch (stocks, crypto, knowledge, historical currency) a
`provider` option, `host` by default.

Three boundaries. A failed fetch returns an Error value, which is not a figure and
carries no record, so do not stamp one. The record is set once, as the value
arrives; do not change it on a value you have already returned, because the
engine shares that value between every line that reads it. And a line the reader
froze (`... frozen`) never reaches your resolver once its answer is kept: the
engine answers it from its own store, so a resolver needs no special case for
[frozen answers](/syntax/frozen-answers/).

## A complete reference

The currency package is the smallest built-in that does all of this: a symbol
and an `in` parselet for the syntax, and `CurrencyAsyncResolver` for the fetch.
Read it alongside this page for the parts the skeleton above leaves to you.
