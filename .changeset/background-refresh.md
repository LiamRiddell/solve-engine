---
"solve-engine": minor
---

Add proactive background refresh for live async values (issue #212).

Async resolution was pull-based: a live value refetched only when its line was
re-evaluated (a keystroke) and had gone stale. A note left open, showing
`stock(AAPL)` or `100 USD in GBP`, held whatever it last resolved. Nothing
refetched it in the background, so a document a reader was looking at rather than
editing silently aged.

Background refresh drives the refetch for you, for the values currently on
screen, and pushes the fresh result to the host over the existing event stream.

| | before | now (opted in) |
| --- | --- | --- |
| a live line, note left open | holds the last resolved value | refetches on its own cadence and updates |
| a line the reader edited away | (n/a) | stops refreshing at once, no leaked timer or request |
| a headless or batch host | pull-only | pull-only, unchanged (off by default) |

Two knobs, independent, both per resolver:

- `staleTimeMs` (as before) governs the pull path: how long a value stays fresh
  before the next re-evaluation refetches it.
- `refetchIntervalMs` (new) governs the push path: how often an on-screen value
  refetches on its own. A live quote might set a minute, an FX rate a few
  minutes, an immutable historical close nothing at all.

```ts
const engine = createEngine({ config: { backgroundRefresh: { enabled: true } } });

const stocks = createStocksPackage({
  fetchQuote: async (ticker, signal) => { /* ... */ },
  refetchIntervalMs: 60_000, // refresh an on-screen quote once a minute
});
```

The fresh value arrives as a `lines-updated` event on `getEventStream()`, the
same stream the pull path uses, so a host already consuming it needs no changes.

The boundaries are deliberate:

- **Off by default.** It needs timers and a live editor consuming the stream, so
  a headless or batch host leaves it off and pays nothing.
- **Per-resolver cadence, not one global timer.** The interval comes from the
  resolver, the same place `staleTime` does; a value with no cadence stays
  pull-only.
- **Only what is live.** A value no line references any more stops at once, so an
  open note leaks no timers or network.
- **Back-pressure and failure.** A refetch still running when the next is due is
  skipped rather than stacked, and a failed one is swallowed, the pull path
  surfaces the failure on the next re-evaluation.

query-core stays and owns the fetching, dedup and cache; this wires its
background refetch to the live values on screen and the host re-render, rather
than reimplementing a cache.

## Verification

`npm run verify` (typecheck, the test suite, build, and the single-file and
bundled smoke consumers). A new suite proves the manager in isolation (the
timers, change detection, liveness, back-pressure and teardown), the resolver
surface (`refetchIntervalMs` producing a working refetch, no cadence staying
pull-only), and the engine wiring (off by default, present only when enabled,
stopped on clear, and a background refetch reaching the event stream).
