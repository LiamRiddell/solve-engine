---
"solve-engine": patch
---

A line edited into a heading stops defining what it defined

A heading, a comment or a blank line has nothing to evaluate, so the evaluator
skips it before anything is compiled. That is the right thing to do and it went
one step too far: a skipped line never reached the registration that tells the
dependency graph what it writes, so the edges it had before the edit stood. A
line that used to be a definition went on defining for the rest of the session.

| document                     | action                  | before | now                     |
| ---                          | ---                     | ---    | ---                     |
| `:x = 12` / `x + 4`          | line 1 to `# a heading` | `16`   | `Undefined variable: x` |
| `:x = 12` / `x + 4`          | line 1 emptied          | `16`   | `Undefined variable: x` |
| `1 sprint = 3 weeks` / `3 sprints in weeks` | line 1 to `# a heading` | `9 weeks` | `Undefined` |

A dirty line that turns out to have nothing to evaluate now registers writing
nothing, which is what withdraws the edges, and drops any unit it had defined.
Only a dirty one: a line that was already a heading has nothing to take back, and
re-registering every heading on every pass would cost a document its headings in
work each time.

The wording of an error was the tell. `v3 * v0` with `v3` left standing gets past
its first name and reports `v0` as the undefined one, where a pass over the same
text reports `v3`. Both are errors and both look reasonable on their own, which
is exactly why a settled pass, rather than a plausible-looking answer, is what
the fuzzer compares against.

A related fix rides with it: a user unit is now keyed by the persistent id of the
line that defined it rather than by the line's position. Positions move, so
deleting a line above a definition renumbered it and a removal keyed on where it
used to sit matched nothing.

## Verification

7 new tests: a heading and an emptied line each leaving the readers undefined,
the first-undefined-name wording, a clean heading withdrawing nothing across four
passes, a unit definition edited into a heading, and a unit surviving a delete
above it before going with its own line.

Found by the same differential fuzz, and it closes it: over 3,200 whole-document
comparisons across 400 random editing sessions, the incremental evaluator now
agrees with a settled pass on every line, with no disagreement of any kind
remaining.
