---
"solve-engine": patch
---

A line on a cycle runs the way a single fresh pass runs it

Two lines that depend on each other have no answer of their own: each value
one could hold is computed from the other's, and there is nothing to start
from. The batch pass (`parseDocument`) has always said so, because it never
runs a line twice: a member reads the line below it as not yet evaluated, and
reports that. The incremental path ran its members again and again, and from
the moment an edit or a pinned definition lent the cycle a number it chased it
for as long as the note was open. #444 records seven attempts at this; each
changed what a positional read returns, or when an answer is thrown away, and
each traded the fault for one of the same size somewhere else.

Eight passes after each action below, main was still climbing; now every line
on the cycle reports it in the batch pass's words, and stays there:

| document                                      | action                          | before                                  | now                                                                                                |
| ---                                           | ---                             | ---                                     | ---                                                                                                |
| `1 sprint = 2 weeks` / `prev + 5`             | line 1 to `line 2 + 5`          | `80`, `85`, ten larger a pass           | `Line 2 has not been evaluated yet (forward reference, or out of range)`, `Line 1 has an error`    |
| `:v0 = v2 + 8` / `:v2 = 18` / `:v2 = v0 + 8`  | typed out                       | `218`, `18`, `226`, sixteen larger a pass | `Undefined variable: v2`, `18`, `Undefined variable: v0`                                          |
| `:v3 = 44` / `:v3 = v3 + 3` / `v3`            | line 1 to `7 + 7`               | `14`, `71`, `71`, three larger a pass   | `14`, `Undefined variable: v3`, `Undefined variable: v3`                                           |
| `spent += 9` / `9 #food`                      | `spent += line 2` inserted above | `72`, `81`, `9`, nine larger a pass    | `Line 2 has not been evaluated yet (forward reference, or out of range)` on both steps, then `9`   |
| `f(x) = x + 4` / `f(9)`                       | line 1 emptied                  | `13`                                    | `Undefined function: f`                                                                            |
| `:x = 5` / `x + 1`                            | line 1 to `:x = zz + 1`         | `6`                                     | `Undefined variable: x`                                                                            |

The rule that closes all of them is the spreadsheet's, and it is what a single
fresh pass already does: **a line that sits on a cycle runs the way a fresh
pass runs it**, with every name it reads holding what the lines above left and
every line below it counted as not yet evaluated. No member ever computes a
number for another to read, so both paths report the cycle in the same words,
and the words no longer depend on whether the text was typed out, inserted, or
edited into place. Which lines sit on a cycle is recomputed only when the
dependency graph changes, following positions, names and running totals alike,
so a document with no cycle in it pays nothing per pass.

Three things had to hold before that rule could be checked at all.

The graph knows what a line reads now, not what it read last time. A
positional edge was discovered while a line ran and then pinned, so a position
the line stopped reading could not be un-discovered: `prev + 1` edited to `7`
still read line 1 as far as the graph knew, and `total above` kept its edges to
the lines above a heading that had cut its block short. An edited line's
positions go before it runs, a run cuts a line's positions back to the ones it
read, and an aggregate (`sum(line 2 : line 6)`, `total above`, `total of
#food`) declares its whole span before reading any of it, since the walk stops
at the first line it cannot use and a cycle that closes through a later one
must still be known. A goal seek takes a positional edge to its target, the way
`line N` does.

When a definition runs, each name it writes holds what the lines above left.
`:v3 = 44` above `:v3 = v3 + 3` is 47 on every fresh pass because line 1 puts
44 back first; edit line 1 away and nothing did, so line 2 read its own answer
and climbed by three a pass. A definition is put back to the prefix before it
runs, and again if it fails (a throw, or a line that does not compile; an
answer that is an error is a value and is stored like one). The prefix comes
from the checkpoint chain, which records what each line wrote in document
order, and which now drops the entry of a line that stopped writing and
replaces the entry of one that threw. A function is a definition too: the
engine can unbind one, and does when its defining line is edited away or
deleted.

A goal seek's unknown is neither a read nor a write of the document. `solve
line 2 for v1 = 27` varies `v1` inside the seek's own call frame and stores
nothing; claiming the write held the name open after the `:v1 = 7` above it
had been edited into the seek, so `v1 + 7` went on answering `14` where a fresh
pass says `Undefined variable: v1`. The 2.38.21 note drew its boundary at a
seek that runs still defining its variable; that boundary moves, because the
seek never defined it. That note's other change, dropping the declared write of
a definition that answered with an error, is reverted: a running total whose
step failed recorded no write, so the reseed that re-runs every total each pass
never found it again, and it stayed on the error after the line it read had
been fixed.

An adversarial review of the change (three readers over the diff, three probes
past what the generator writes, two verifiers on every finding) found five more
things, three of them introduced by the first version of this change, and each
has a test now. A range declares only the part of its span the document has:
`sum(line 1 : line 3000000)` declared three million positions and exhausted
the heap, where the walk that reads them had always stopped at line 4. The
document's length is asked for each time rather than copied into the context,
since a copy taken before an insert cut `sum(line 4 : line 5)` a line short
and hid the cycle through line 5. A member's positional edges follow its run
like any other line's, now that every aggregate declares its span; keeping a
member's forward edges regardless kept an edge to a line it had stopped
reading, and that phantom cycle outlived the real one. The checkpoint chain
follows the lines through a structural edit instead of being cleared by one: a
clean line above the viewport never runs again to put its entry back, so
`:a = 5` above the viewport was reported as `Undefined variable: a` by the
definition under it. A definition scrolled out of view runs under the same
discipline as one in view, put back before it runs and put back if it fails,
where it used to keep its old value out of view, and to climb by its step every
pass if it read its own name. And a name bound as both a function and a
variable (`f(x) = x + 4` above `:f = 9`) has each binding put back on its own,
including when its line is emptied, where stopping at the function left the
variable holding what the edited line wrote. One wording change came out of the
same review: a goal seek that names its own line is refused as a seek
targeting a seek, rather than as a line that does not use its variable.

The boundaries. A pinned cycle that used to converge on the incremental path
reports the cycle now, as the batch pass always did: `:v3 = v2 + 7` / `:v2 =
line 1 + 8` / `:v2 = 31` settled at `38`, `46`, `31` and gives `Undefined
variable: v2`, `Line 1 has an error`, `31`, because a line that depends on
itself has no answer of its own whatever a pin lends it. A plain forward
reference is untouched: `line 2 + 1` above `7` is still `8`, and `x + 1` above
`:x = 5` is still `6`, since neither line depends on itself. A column of
running-total steps is not a cycle: each step depends on the steps above it,
never on those below. And one wording difference between the paths is older
than this and stays: where the member a line reads is a definition that
failed, the incremental path says `Line 1 has an error` and the batch pass,
which stores no result for an errored line, says `Line 1 has not been evaluated
yet`. And the bookkeeping has a cost on a document with no cycle in it: a pass
over a 1,000-line document of mixed shapes took 4.5 ms against 3.8 ms before,
measured in alternation on the same machine, a sixth more.

## Verification

Five specs, 69 new tests: `AnOrdinaryEditIntoAPositionalCycle` (26: the edit
shapes, the goal-seek cycle, the shrunk and re-grown block, and the
from-scratch answers and pass counts of eight shapes, taken from the batch
pass), `ACycleThroughANameReportsIt` (18: cycles through a name, a running
total and a function, a pinned cycle, a viewport pass, a long history of
edits, a name bound as both a function and a variable, the phantom cycle, the
range declared after an insert), `ALineThatErroredDefinedNothing` (13 more: a
failed definition, a redefinition, a same-line pair, a failed total step
re-seeded once its input is fixed, and the prefix out of view and across a
structural edit), `PositionalEdges` (11 more, for the graph, among them the
span cut to the document) and `GoalSeek` (1). The two skipped #444 tests run
again, and the cycle example on the line-references page proves both its
lines. The engine suite is 470 suites, 9,044 tests passing and 4 skipped under
`npx jest`.

The differential fuzz of editing sessions (`npm run fuzz --
--generator=document`) had its generator widened with a definition that reads a
position or another name, a definition that fails, a total that reads a
position, and a user function. Over the same ten ranges of 300 sessions,
unmodified main reports 110 findings and this change reports 0. Eight further
ranges of 300, never run against the code before, report 0; one of them (seed
60000091) reported the copied line count above before it was fixed, and the
review's own probe ran six more document ranges, 500 expression cases and 500
bytecode cases at 0.
