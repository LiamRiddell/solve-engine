---
"solve-engine": patch
---

A value that cannot be fetched settles, and stops starving the event loop

The re-evaluate loop the async guide tells hosts to write, read the event stream
and re-evaluate the lines each event names, was unbounded against a resolver
whose value never becomes ready. Worse than unbounded: every hop of it is a
microtask, and the microtask queue drains completely before a single timer runs.

Measured against a resolver that always fails, through the documented loop:

| | before | now |
| --- | --- | --- |
| rounds before it stopped | 3,000, the test's own cap | 6 |
| preflights, so fetches started | 1,501 | 4 |
| did a `setTimeout(..., 0)` armed beforehand fire? | no | yes |

Two changes, and either alone leaves half the problem.

**A repeated failure stops being announced.** The batcher is what tells a host a
line changed, and the host answering that by re-evaluating the line is what
starts the next fetch, so declining to announce is what ends the round trip.
Three consecutive failures for a query, because a transient failure is ordinary,
a flaky network or a service restarting, while a resolver that is genuinely down
will not be up by the tenth attempt. A key that succeeds clears its own count, so
an outage followed by a recovery is not held against it.

The promise is still awaited rather than abandoned when the bound is reached. An
earlier attempt returned before the await, which left the rejection unhandled,
and in a host process an unhandled rejection is a crash rather than a log line.

**A chain of flushes yields to the event loop.** Once several have run without a
macrotask getting a turn, the next one is scheduled as a timer rather than a
microtask, so timers, I/O and a host's own deadlines keep running. The counter
that decides this is reset by a macrotask, so it can only be high while the loop
is denying one, and it corrects itself the moment one lands. Four chained flushes
before yielding, since an ordinary document settling several values wants them
collapsed into as few passes as possible.

[Async and live data](https://liamriddell.github.io/solve-engine/guide/async-and-live-data/)
gains a section on what a host should do when a resolver never becomes ready, and
says plainly that the engine stopping the machine spinning is not a substitute for
showing the reader what happened.
