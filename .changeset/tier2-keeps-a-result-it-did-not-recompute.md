---
"solve-engine": patch
---

A definition keeps its answer when the document is evaluated again

A live document is evaluated over and over rather than once, and a line whose
expression compiles to a program with no opcodes lost its answer on the second
pass, with nothing edited. A unit definition and an equation stored for later
both do their work while being compiled and have nothing left to run:

| line                 | pass 1                    | pass 2 before | now       |
| ---                  | ---                       | ---           | ---       |
| `1 sprint = 2 weeks` | `sprint defined`          | blank         | unchanged |
| `y + 3 = 10`         | `y stored as an equation` | blank         | unchanged |

Tier 2 skipped the empty programs, collected no results, and then assigned that
empty collection over the answer Tier 1 had computed. Executing nothing produces
no new result, which is not the same as producing an empty one, so a line that
ran nothing now keeps what it had.

The unit itself was never affected: `3 sprints in weeks` answered `6 weeks`
throughout. It was only the definition line's own displayed result that went.

Keeping the old result was not enough on its own, and the second half of this is
the more interesting one. A pass runs with the Value arena on, and a result that
never came back through the VM's `HALT` was never copied on the way out, so the
line held an arena slot that a later line is then handed. Read again after the
line below it had run, `sprint defined` had become that line's number, in the
same object. The kept result is therefore a copy, not a reference.

The boundary: this is about a line keeping an answer it already had. Changing a
definition still does not update the lines that already used it, because a user
unit is not a dependency key and the lines reading it keep bytecode compiled
against the old definition. That is filed separately.

## Verification

5 new tests, including the plainest property the evaluator has and one nothing
pinned before: four passes over an unchanged document leave every answer exactly
as the first pass left it. On `main` four of the five fail. `npm run verify:ci`,
the bundled-consumer contract, and the playground build all pass.
