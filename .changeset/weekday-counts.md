---
"solve-engine": minor
---

`fridays between two dates` counts the weekday

Planning against a weekday is an ordinary thing to want and there was no form
for it. The nearest approximation ignores which weekday the range starts and
ends on, so it is wrong at both ends.

| expression | before | now |
| --- | --- | --- |
| `fridays between 01/06/2026 and 31/08/2026` | a parse error | `13` |
| `how many fridays between 01/06/2026 and 31/08/2026` | a parse error | `13` |
| `mondays between 01/06/2026 and 31/08/2026` | a parse error | `14` |
| `weeks between 01/06/2026 and 31/08/2026` | `13 weeks` | `13 weeks` |

Those are the same three months in each row. The range holds fourteen Mondays
and thirteen of everything else, because 1 June 2026 and 31 August 2026 are both
Mondays, which is exactly what `weeks between` cannot tell you: it answers
thirteen whichever weekday you meant.

Every weekday name is taken, in the plural a person counting writes and in the
singular the lexer already knows, and `until` and `since` count against today
the way their unit siblings do. Only the singulars were lexer keywords, since
those are the forms a date needs (`next friday`), so the plural is recognised in
this one place rather than claimed globally.

**Both endpoints are included.** A range written to a Friday was written to
include it, and someone counting shifts or rent days means the ones on the
boundary. It follows that a single day counts as one if it is that weekday and
none if it is not, and that `fridays until` a Friday counts today. Order does
not matter either: a weekday falls in a range the same number of times whichever
end you start from.

The boundary is holidays. This counts calendar weekdays and does not consult a
holiday calendar, because a Friday that is a public holiday is still a Friday.
`working days between` is the form that skips them, and it already exists.

[Date differences](https://liamriddell.github.io/solve-engine/syntax/date-differences/)
gains a proven section, with the Monday range beside the week count so the
difference between the two questions is visible.
