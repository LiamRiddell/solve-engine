---
"solve-engine": patch
---

A line's answer no longer depends on where the viewport is

`ThreeTierEvaluator` builds a `VMCheckpointer` for itself now, instead of taking
one as an optional argument that nothing supplied.

The argument was not a preference. A name written on more than one line has a
value per position, and the VM holds whichever write ran last, so anything
re-running part of a document read the state the document ENDS in rather than
the state its own line sits in. `setViewport` has always asked for the right
state (`restoreTo(startLine - 1)`) and got nothing back, because there was
nothing to ask:

| `:x = 1` / `x + 100` / `:x = 99` / `x + 200` | line 2 |
| ---                                          | ---    |
| evaluated whole                              | `101`  |
| then scrolled to, before                     | `199`  |
| then scrolled to, now                        | `101`  |

The answer changed because the reader scrolled to it. A host had to know to
construct a checkpointer to avoid that, and nothing said so. A caller may still
pass its own, to share a chain or to inspect it.

## A checkpoint is replaced, not followed by a truncation

Turning it on exposed a fault in the checkpointer itself, introduced when the
ordering was fixed in 2.38.11. Taking a checkpoint dropped every entry at or
after that line, on the reasoning that a pass runs in document order and re-takes
them as it goes. That holds only for a pass that runs from line 1. A pass limited
to a viewport re-records the lines it covers and never reaches the definitions
below its end line, so the chain lost them, and `restoreTo` then reset the VM and
replayed a prefix that no longer mentioned them.

The result was worse than no checkpointer at all. With no chain the VM only ever
accumulates, so its failure is a stale number; with a truncated one the restore
SUBTRACTS, and a line further down reading a dropped definition answered
`Undefined variable` where it had answered a number. Measured on a document
defining `top` at line 1 and `mid` at line 25, read at lines 41 to 60, after a
full pass, an edit, a pass over the first twenty lines, and a scroll to the
bottom: `509` without a checkpointer, `Undefined variable: mid` with one.

A line's checkpoint is now replaced where it stands, and nothing else is touched.
Absent is worse than stale here: a stale entry is what the document is showing
anyway, and the pass corrects it when it reaches that line.

## Restoring is no longer quadratic

Rebuilding the state at a position walked the chain from the target back to the
root and assembled it by pushing each entry onto the FRONT of an array, which
shifts every entry already there. Five thousand definitions meant twelve million
shifts, on every scroll.

The chain from the root to any checkpoint is exactly the stored array up to that
index, since each entry is created with the one before it as its parent, so there
is nothing to assemble: the restore reads the array, and finds where to stop with
a binary search rather than a scan. On a thirty-line viewport scrolled down a
document of five thousand definitions that is 1.04 ms per scroll against 0.52 ms,
and the old shape doubled between two and five thousand definitions where the new
one barely moves.

## What it costs

Restoring is work that was not being done at all, so a document made of
definitions pays for it. Medians of nine, a thirty-line viewport walked down the
document:

| document                             | before   | now      |
| ---                                  | ---      | ---      |
| 2,000 plain lines, no definitions    | 0.146 ms | 0.157 ms |
| 2,000 lines, a definition every 20   | 0.144 ms | 0.163 ms |
| 2,000 lines, every line a definition | 0.095 ms | 0.259 ms |
| 5,000 lines, every line a definition | 0.133 ms | 0.508 ms |

A document that defines little pays almost nothing. The worst case is half a
millisecond on a document that is nothing but definitions, against a frame of
about sixteen, and it buys an answer that does not change when the reader scrolls
to it.

## Two more the viewport path was hiding

Rewinding the VM reached two faults that were latent while it never rewound.

A `total += 5` line compiles to no bytecode, so a clean one cannot be re-run
from cache and has to go back through the full pipeline. While the total simply
stayed where the last pass left it that was harmless; restoring rewinds it, and
a viewport containing the accumulator lines then had nothing to rebuild them
from, so `spent += 10` / `spent += 20` / `spent` answered
`Undefined variable: spent` on a scroll. A scroll re-seeds accumulators now, as
a pass already did.

And the sentence a definition answers with never goes through the VM's `HALT`,
which is where a result is copied out of the Value arena, so the line was
holding a slot the arena hands to a later one. `1 sprint = 2 weeks` read
`sprint defined` after the pass that made it, and a number from four lines below
it after the next, in the same object. The three places that produce such a
sentence route through one helper that copies it while the arena is on. That one
is not new: it behaves identically before this change, and the unit the line
declares was never affected.

## Verification

15 tests comparing an editor's behaviour against a single uninterrupted pass over
the same text, which is the answer with no re-running in it: every viewport in a
document that redefines two names, scrolling back and forth, an edit inside a
narrow viewport, editing a redefinition, inserting and deleting lines, a session
of seven alternating edits and scrolls checked at every step, the
viewport-limited pass above, a running total surviving a scroll from two
different viewports, and a definition and an equation each keeping their own
sentence. Four more pin the chain: an entry replaced in place,
the lines below it kept, every entry's parent being the entry before it, and the
count holding through a partial pass.
