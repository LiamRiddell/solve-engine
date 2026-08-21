---
"solve-engine": minor
---

Live values now stream back from the worker.

The off-main-thread harness shipped with one of its three points deferred: a value that resolves inside the worker AFTER a request already answered had no way home. A document parsed off-thread came back with its synchronous and pending results, but when a currency rate, a weather reading or a historical FX rate settled a moment later, that resolution stayed trapped in the worker and the host never saw it. Live data is a headline feature, and off-thread it did not arrive. This completes the async-streaming point deferred from the initial worker slice.

`WorkerEngine` gains two subscriptions:

```ts
const stop = engine.onResolved((lines) => {
  for (const { lineNumber, value } of lines) render(lineNumber, value.text);
});

engine.onAsyncError(({ queryKey, packageId, error }) => {
  console.warn(`${packageId} could not resolve ${queryKey}: ${error.message}`);
});
```

These are subscriptions rather than per-call promises because a resolution is tied to no single request: it belongs to whichever document is current when the value lands. `onResolved` delivers a batch, since the engine collapses every resolution that settles in one tick into one update, and each line arrives already re-evaluated as a `SerializedValue` the host can render without a further round-trip. `onAsyncError` carries the same structured `EngineError` an in-process resolver failure would surface. Both return an unsubscribe function.

The worker holds one engine and one document context, so the most recent evaluate call is the live one. Parsing a new document supersedes the old one: a value still resolving for the superseded document is dropped at the engine's own staleness guard rather than delivered against the current document. That guard is the existing per-resolution `AbortSignal`, the same mechanism the cancellation point already leans on, so a stale resolution never reaches the host as if it were current.

The other two points are unchanged and still hold: results cross as a serialisable DTO, never as a raw `Value`, and an `AbortSignal` on a call still maps onto a `cancel` message worker-side. `solve-engine/worker` remains a separate, side-effect-free entry point.
