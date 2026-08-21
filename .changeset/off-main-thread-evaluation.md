---
"solve-engine": minor
---

Evaluation can now run off the main thread.

Parsing is synchronous and lands on whichever thread calls it. A 6,000-line document parses in roughly 50ms on a warm desktop, which is fine once and janky on every keystroke, and worse on a phone. The incremental path and viewport evaluation keep a re-parse small, but they do nothing for a first parse or a paste, which still block the caller.

A new `solve-engine/worker` entry wraps the core evaluate methods behind a `postMessage` boundary, so a host can move that work to a Web Worker or a Node `worker_threads` thread without hand-rolling the protocol:

```ts
import { createWorkerEngine, eventTargetTransport } from "solve-engine/worker";

const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
const engine = await createWorkerEngine({ transport: eventTargetTransport(worker) });

const result = await engine.parseDocument(text); // Promise<SerializedParsingResult>
```

The worker entry is two lines: `startWorkerRuntime(eventTargetTransport(self))`.

Three things had to be settled to make this safe:

- **A serialisable result.** A `Value` carries BigInt, matrix objects, symbolic trees and the exact-decimal and rational sidecars, and structured cloning reproduces none of them faithfully (BigInt alone breaks `JSON`). Results cross as a DTO instead: `SerializedParsingResult` / `SerializedParsedLine` / `SerializedValue`, where each value carries its formatted `text`, a numeric reading, and a clone-safe payload (a BigInt as a base-ten string, a matrix as shape plus cells, a range as its bounds). The DTO survives both `structuredClone` and `JSON`, so a host can cache or forward it. A raw `Value` is never posted.

- **Cancellation.** An `AbortSignal` on a call rejects the promise and posts a `cancel` for the same request, which maps onto the engine's existing keystroke signal on the worker side, so a superseded keystroke does not race a stale result home rather than duplicating the mechanism.

- **A structured failure.** A worker-side throw is caught, flattened into a structured error, posted, and rebuilt on the main side, so a caller's `catch` sees the same `EngineError` (code, category, message) it would have seen in-process, never a lost promise.

Both threading targets are reached through one small transport interface. `createLinkedTransports()` runs the whole protocol on one thread for tests and for a host that wants the message-passing shape without a second thread; `eventTargetTransport` and `messagePortTransport` adapt a browser `Worker` and a Node `worker_threads` port onto the same interface.

Packages cross as names rather than objects, since a package carries functions `postMessage` cannot clone: the worker bundles the built-ins and the main side selects among them by name, and a host with a custom package bakes it into its own worker entry. Deferred for a later slice: streaming the async resolver's follow-up live-data events across the boundary. A synchronous or pending result crosses today; a later update does not yet.

Nothing about the synchronous API changes, and `solve-engine/worker` is a separate, side-effect-free entry point, so a bundle that never imports it pays nothing.
