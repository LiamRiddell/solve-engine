---
"solve-engine": patch
---

A cross-document value notifies its readers when it changes, and stops notifying them when it does not

`GlobalVariableStore.set` decides whether a write is worth telling anyone about, and it was wrong in
both directions at once.

**It told readers nothing when a matrix changed shape and everything when it had not changed at all.**
The comparison guarding the notification opened with an `Array.isArray` test on the payload, which can
never be true: `Value.value`'s union has no array member. The arrays are one level further in, as a
matrix's `data`. So every object-valued cell fell through to `Object.is` on two freshly-built objects,
which is never equal, and a matrix, range, colour, split, chart, address or symbolic cell re-notified
on every evaluation pass for ever. Each of those notifications dirties the whole downstream closure of
every reader, so the cost was not one wasted comparison but a re-evaluation storm proportional to how
many lines read the cell.

**It stayed silent when a value changed in a way only the reader can see.** The comparison looked at
`value`, `unit` and `timedOut`, and skipped every sidecar. But `1.5` and `1.5 to 2 dp` are the same
double and render as `1.5` and `1.50`; `30` and `30 ± 2` are the same double and render as `= 30` and
`= 30 ± 2.0`; a datetime's grain, zone and span decide whether an instant reads as a day, a wall-clock
time or a duration. Those pairs compared equal, the notification was suppressed, and every reader kept
displaying the old rendering with no event that would ever correct it.

The two directions are not equally bad, which is why the comparison is now conservative. A redundant
notification costs a re-evaluation that arrives at the same answer. A missing one is permanent, because
nothing re-reads a cell it was not notified about. So the payload walk is bounded, and a payload too
large to compare within that bound reports "not equal" rather than guessing.

**A value the store held could be one no reader was ever told about.** `set` wrote first and checked
the notification-depth bound second, inside `notify`, which returned before calling any listener. At
the limit the value was therefore stored and announced to nobody. The bound is now checked before the
write, so the store and its readers cannot disagree: either both see the new value or neither does.

The boundary: this is not cross-document cycle detection and does not pretend to be. That bound guards
a host listener that writes back on notification, and it is unreachable from engine code, because both
engine-side listeners are non-reentrant. Cycles that span documents are specified separately in
`docs-internal/plans/CROSS_SCOPE_CELLS.md`.

## Verification

The suite's only cross-document cycle test passed vacuously: it wrote the received value straight back,
so the second hop hit the unchanged-value short-circuit and the recursion stopped at depth 2 without
ever reaching the bound it was named for. It now writes a different value on each hop, asserts that the
engine's bound rather than the test's own guard is what terminates it, and asserts that every value the
store holds is one its listeners were told about. Two further tests cover the object-valued and
sidecar-only cases. All three fail before this change. `npm run verify` passes: 479 suites, 9,123 tests.
