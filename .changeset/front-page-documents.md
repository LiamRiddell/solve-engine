---
"solve-engine": patch
---

The README and the introduction show a document, with a name read across lines and the document features working together

The README's "Named values, across lines" block held a single line, `:subtotal = 240`, so the name was never read anywhere, and neither the README nor the introduction mentioned what-if, category tags, sections, checks or tracing, the features that make a note more than a column of sums (#784). Both pages now explain what a document is before they show one, with two proven blocks each:

```text
:subtotal = 240              = 240
:tax = :subtotal * 20%       = 48
:subtotal + :tax             = 288
```

```text
# Trip
nights = 3                         = 3
rate = £95                         = £95.00
flights: £420 #travel              = £420.00
hotel: nights * rate #travel       = £285.00
total of #travel                   = £705.00
check total of #travel <= £800     = ✓

# Questions
line 5 with nights = 4             = £380.00
inputs of line 6                   = £705.00 (line 6) <- £420.00 (line 4), £285.00 (line 5) <- [nights 3 (line 2), rate £95.00 (line 3)]
```

Each form links its page (category tags, checks, what-if, tracing inputs, sections). `parseDocument` and `evaluateDocument` agree on every line of both blocks.

The boundary: two forms are left off the front page on purpose, as the issue records. Goal seek needs the incremental entry point, which the README would have to name: `solve line 3 for rate = £330` gives `= £110.00` through `evaluateDocument` (the pound sign the issue saw dropped is kept today) and a refusal through `parseDocument`. And `total of section "Trip"` added to the block above gives `= £803.00` through both entry points, since it adds the inputs `nights` and `rate` to the two costs; whether a section total should count its inputs is left for its own issue. Neither is changed here.

## Verification

`Issue784_frontPageDocuments.spec.ts` holds 8 tests: both blocks on both pages, the name read below its definition, each document form present, both passes agreeing with each other and with the stated answers, the trip block identical on both pages, a single line refusing rather than guessing, an edit flowing down, and CRLF. `DocExamples.spec.ts` proves both pages' blocks.

Gates run: the full suite (`npm run test:full`) ran 24,912 tests in 728 suites: 24,907 passed and 4 were skipped. The one failure was the #729 spec that keeps explain-before-show exemptions honest, since the unit reference's new headlines explain before each table and its exemption no longer named anything; the exemption is removed and that spec passes on a rerun. `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:links`, `lint:units`, `lint:ci-parity` and `lint:jest-configs` passed. `npm run verify:ci`, the docs site build and the bundled-consumer contract were not run whole for this change; CI runs them.
