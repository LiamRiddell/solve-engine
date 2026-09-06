---
"solve-engine": minor
---

`30 days from 3 March 2026`, a date offset in words

The harder, rarer sibling already shipped and the ordinary one did not.
`30 working days from 3 March 2026` has always answered, because that is a fixed
three-word phrase the package fuses; the plain spelling was a parse error, which
is an asymmetry anyone with a deadline, a renewal, a notice period or an invoice
term meets within a week.

| expression | before | now |
| --- | --- | --- |
| `30 days from 3 March 2026` | a parse error | `Thursday, April 2, 2026` |
| `2 weeks after 3 March 2026` | a parse error | `Tuesday, March 17, 2026` |
| `30 days before 3 March 2026` | a parse error | `Sunday, February 1, 2026` |
| `3 months from 3 March 2026` | a parse error | `Wednesday, June 3, 2026` |

The arithmetic was never the gap. `3 March 2026 + 30 days` has always been right,
month clamping included, so this is the spelling and nothing else: each form is
pinned to answer exactly what the operator answers.

A fixed phrase could not cover it, because the unit is part of what the reader
writes and days, weeks, months and years all have to work. So the unit and the
connector are fused instead, which is the shape `days between` already uses.

Fusing is also what keeps the connectors out of each other's way. `after` is the
finance package's own infix, and `$1,000 after 3 years at 7%` still answers
`$1,225.04`, because the word is read this way only when a **time** unit sits
directly in front of it. `30 kg after` is not a duration and cannot offset a
date, so it is untouched too.

`to` is deliberately not claimed. `2 April 2026 to 6 September 2026` already
means something, and quietly turning it into an offset would take that away.

[Date arithmetic](https://liamriddell.github.io/solve-engine/syntax/date-arithmetic/)
gains a proven section, beside the operator spelling it agrees with. It goes
there rather than on the relative-dates page the issue suggested, because that
page has no fixed results and carries no proven examples by design.
