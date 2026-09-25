---
"solve-engine": patch
---

Goal seek refuses a target that re-runs the note, re-runs no longer fill the value pool, a trace shows a large value short, and a sweep says when its steps together reach the budget

Four faults found by the survey before 2.40.0 and listed as known issues in its release notes. Each let a short note spend far more time or memory than its answer needed, and each is now bounded or refused by name.

**Goal seek refuses a target that holds a what-if or a sweep (#604).** A what-if already refuses to re-run a line holding another what-if, so one question cannot set off another. Goal seek was the exception: it re-runs its target up to a hundred times, and a sweep on the target re-ran the whole note on every one of those runs. It now answers with a named refusal on its first probe. It refuses whether or not the algebra could have inverted the line, so the answer does not depend on the line's shape.

| note, through `evaluateDocument` | before | now |
| --- | --- | --- |
| a 1,000-step sweep of line 73, then `solve line 74 for k = 3000.5` | 12,166 ms, 371 MB still held afterwards, then "did not converge" | the whole note in 350 ms, and "Goal seek cannot target a line that holds a what-if or a sweep, since every one of its probes would re-run the document again. Target a line without one." |
| six such goal-seek lines | 75,921 ms, 2,232 MB held | each refused by name |

A target that only reads a what-if line's answer, rather than holding the what-if, still solves. The batch pass refused goal seek before and still does.

**Re-runs no longer fill the value pool (#605).** The engine keeps a small pool of reusable values for the lines on screen, so scrolling allocates nothing. A what-if or sweep's re-runs, goal seek's probes and reads of a table column all ran while the pool was on, and every value they made stayed in it for as long as the note was open. Re-runs and probes now make ordinary values, and the pool stops growing at 16,384, about twenty times what the heaviest example in these docs uses.

| note, through `evaluateDocument` | values held before | now |
| --- | --- | --- |
| 100 lines, then one 1,000-step sweep | 200,205 | 1,205 |
| the same 100 lines, then five such sweeps | 1,000,229 | 5,229 |
| a 1,000-row table, then 1,000 reads of its column | 1,003,001 | 16,384 |

**A trace shows a large value short (#606).** `inputs of line N` formatted every traced value in full before it checked the trace's length, and a 100,000-element list is 787,929 characters that took about 2.3 s to format, once for each line of the trace holding it. A list of more than ten values now shows its first ten and a count, a matrix of more than a hundred cells shows its shape, and a text of more than eighty characters shows its first eighty and a count. The cut comes before the formatting, so the work is bounded as well as the text.

| note | before | now |
| --- | --- | --- |
| five lines each holding `map(x*1, 1:100000)`, then `inputs of line 5` | 12,079 ms, then refused as too long | 112 ms: `z [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 99,990 more] (line 5) <- ...` |
| `v = map(x*1, 1:100000)`, then `inputs of line 1` | 3,201 ms and 787,929 characters | `v [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 99,990 more] (line 1) reads no other line` |

`engine.traceLine()` returns values rather than text and is unchanged.

**A sweep says when its steps together reach the budget (#607).** A line may create at most 2,000,000 list items and matrix cells, and make a limited number of user-defined-function calls. A sweep's steps share those budgets, as they must, or a thousand steps could use a thousand times what a line may. The refusal blamed the step the running total happened to reach, which answered on its own, and said "has no answer" twice. It now says what happened.

| after `:k = 1` and `sum(x, map(x*1, 1:99999)) * k` | before | now |
| --- | --- | --- |
| `line 2 for k from 1 to 20 step 1` | With k at 7, line 2 has no answer: Line 2 has no answer with these inputs: Evaluating this expression would materialise 99,999 collection elements, past the limit of 2,000,000 elements for one evaluation | This sweep stopped with k at 7: this sweep's re-runs of line 2 share this line's limit of 2,000,000 materialised elements, and together they reached it. Use a larger step or a shorter range. |
| `line 2 with k = 7` | 34,999,650,000 | 34,999,650,000 |

A sweep whose steps leave no room for its list of answers says that too, where it used to report the list's few cells as if they alone were past the limit. A step that is over a budget by itself is still reported as that step's failure, now with "has no answer" said once. The budgets are unchanged, and a single what-if, which runs once, keeps its message.

The goal-seek, what-if and tracing-inputs pages describe each change, with proven examples of the goal-seek refusal and the short form of a trace.

## Verification

New tests pin the goal-seek refusal through all three entry points in the cross-path suite, with adversarial cases for a sweep inside a function call, a what-if in brackets, two and six goal-seek lines on one target under a time bound, and the boundary where a target reads a sweep line's answer; the pool's ceiling, its reset and the helper that turns it off, and its size after each of the survey's notes, a what-if with several inputs and a goal seek; the short form of a trace for lists, columns, matrices and text, at the edge of each limit and across characters outside the Basic Multilingual Plane; and the sweep's wording with the budget crossed on a middle step, at the final list and by function calls, against a step that is over the budget by itself. The full suite is 11,994 tests in 552 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
