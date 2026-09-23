---
"solve-engine": patch
---

A value that is still loading renders as a placeholder, not as its internal cache key

`formatValue` had a case for every value type that carries a payload of its own
except one. A `Pending` value stores its deduplication query key in `.value`, so
it fell through to the default case and that key was rendered as the answer:

| line | before | now |
| --- | --- | --- |
| `global :total`, awaiting a declaration | `= global:total` | `…` |
| `100 USD in GBP`, rate not yet fetched | `= currency:USD:GBP` | `…` |

This is the same leak that was fixed for `Error` values, one type along in the
same switch. That case has a comment recording it: before the fix an error
displayed its raw code rather than its message. `Pending` was missed.

There is no result prefix on the placeholder, for the reason the `Error` case
drops it too. A line whose value has not arrived has no answer yet, and
prefixing it with `= ` presents one. `…` is what the
[formatting guide](https://liamriddell.github.io/solve-engine/guide/formatting/)
already teaches a host to render for this type, so the built-in formatter now
agrees with the documented example instead of contradicting it.

The boundary: this changes the built-in formatter only. A host that inspects
`value.isPending()` and renders its own affordance, which the formatting guide
recommends and which is what a host with a spinner does, is unaffected.

## Verification

Two unit tests in the FormatEngine suite, asserting that a pending value neither
contains its query key nor carries a result prefix. Both fail before the change
with the exact strings in the table above. `npm run verify` passes: 479 suites,
9,123 tests.
