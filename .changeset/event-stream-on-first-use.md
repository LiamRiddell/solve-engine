---
"solve-engine": patch
---

Constructing an engine no longer builds an event stream nobody asked for

`AsyncResolutionBatcher` created its `ReadableStream` in its constructor, so
every engine built one whether or not anything ever read it. A `ReadableStream`
is not free to build: its start algorithm queues promise reactions, and those
are only collected once the host yields to the microtask queue. A host that
builds engines in a synchronous loop, a batch job, a test suite, a server
rendering many documents in one turn, never yields, so the reactions accumulated
for the length of the loop.

| engines built in one synchronous loop | before  | now    |
| ---                                   | ---     | ---    |
| retained per engine                   | 12.5 KB | 0.1 KB |
| 6,400 engines                         | 78 MB   | 0.8 MB |

Measured with `--expose-gc`, forcing a collection either side, so the figures
are what survives collection rather than what has yet to be collected.

The stream is built on first use now, and *use* is deliberately wider than
*subscribe*. The stream buffers up to its high-water mark with no reader
attached, so a consumer that subscribes after some events have already flowed
still receives them. Building it only when someone subscribes would have dropped
exactly those, so the emit path asks for it too. An engine that never resolves
anything asynchronously and never subscribes is the only one that never builds
it, which is nearly all of them.

Nothing about delivery changed: the same events reach the same consumers in the
same order, a cancelled stream is still not rebuilt, and `clear()` still leaves
the batcher able to serve a new subscriber. `listenerCount` answers without
building a stream to answer with, since it is asked by hosts deciding whether to
subscribe at all.

## Verification

6 new tests asserting an engine builds no stream on construction, none after an
ordinary expression, one as soon as a consumer asks, the same one every time, a
listener count that does not create one, and a thousand engines in a synchronous
loop leaving no streams behind. The batcher's own 67 stream and delivery tests
cover the behaviour that had to stay the same, including a subscriber that
arrives after the event it wants.

Found by a differential fuzz of the incremental evaluator: it constructs an
engine per case and died of this on a 256 MB heap.
