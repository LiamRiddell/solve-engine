---
"solve-engine": minor
---

Bill split and tip: one line that answers "X each".

Splitting a bill had to be divided by hand and typed back in. A `split` clause answers it in place, in either spelling, and a tip written as a percentage composes on one line.

```
split $120 between 3         $40.00 each
$120 split 3 ways            $40.00 each
split $100 between 4 people  $25.00 each
$120 + 18% split 3 ways      $47.20 each
10 split 3 ways              3.33 each
```

The amount stays exact, so `$120 + 18%` is an exact `$141.60` before the split divides it, and money that was exact stays exact. A bare number splits to a bare number, so no currency is invented where none was written.

The boundary is the odd penny. `split $100 between 3` is not a bare `$33.33 each` that quietly loses a penny: the extra penny is named, and the shares add back to the total to the cent.

```
split $100 between 3         $33.33 each, with 1 share paying $33.34
```

`split`, `ways` and `people` are ordinary words everywhere else: read as the split grammar only inside the full shape, so `:split = 5` and a variable named `split` keep working.

## Verification

- A regression spec (16 cases) covers both spellings, the tip composition, the odd-penny reconciliation, the bare-number case, the arity error, and the collision safety.
- 7,784 tests across 343 suites, no failures. `npm run verify` green.
