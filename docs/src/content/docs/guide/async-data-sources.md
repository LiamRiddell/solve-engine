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

## Preflight runs before the VM, and stays synchronous

`preflight` is called for every expression, before it executes, so it has to be
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

## A complete reference

The currency package is the smallest built-in that does all of this: a symbol
and an `in` parselet for the syntax, and `CurrencyAsyncResolver` for the fetch.
Read it alongside this page for the parts the skeleton above leaves to you.
