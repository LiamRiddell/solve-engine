---
"solve-engine": patch
---

A line moved by a structural edit drops its answer below the viewport

The incremental evaluator keeps a line's last answer so scrolling back to it
costs nothing. An insert or a delete moves every line below it to a new
position, and the answer such a line still holds was computed for where it used
to sit. While the moved line stays below the viewport nothing re-runs it, so it
went on showing that answer, and a line that reads its position read it back as
a real value:

```solve-doc
:x = 1
:x = line 4 + x
```

with `:x = 3` inserted above a trailing `x + 1`, viewed on lines 1 to 3:

| line                | before                  | now                                                                     |
| ---                 | ---                     | ---                                                                     |
| `:x = line 4 + x`   | `Line 4 has an error`   | `Line 4 has not been evaluated yet (forward reference, or out of range)` |
| `x + 1` (moved to 4) | the error it held at line 3 | no answer, until the viewport reaches it                            |

A fresh pass driven to the same viewport never reaches line 4, so it reports
that line 2 has not been evaluated yet and shows nothing on line 4. The
incremental path now agrees: a moved line's answer is cleared on the next pass,
once the viewport is known, for the moved lines that sit below the range that
pass runs. A moved line inside the range re-runs from its cached bytecode and
gets its answer straight back, so nothing a reader sees flickers.

The boundary. The clearing is below the viewport only. A line that moved ABOVE
the viewport keeps its answer, and that is not this bug: the incremental path
shows a line scrolled off the top the answer it last computed, where a fresh
pass driven straight to that viewport would not have reached it, and that
difference is the scroll cache doing its job. It is the same with or without a
structural edit in the way, and a fresh pass still shows a definition above the
viewport through the checkpoint chain, so blanking one would be a divergence of
its own. This change is only about the answer a moved line holds below the
viewport, which a fresh pass genuinely never has.

## Verification

7 new tests in `ALineThatMovedDropsItsAnswer` drive an edited session and a
fresh pass to the same viewport and compare every line: the reported case, its
healing as the viewport reaches the moved line, a position-independent line
below the viewport, a positional reader that reads a line moved out of view, a
delete, a scrolled viewport, and two that pin a definition above the viewport is
not over-cleared. The engine suite is green, and the differential fuzz of
editing sessions, expressions and bytecode reports 0 disagreements. The fuzzer's
whole-document oracle settles on a full viewport, so it did not exercise this
viewport-limited shape; teaching it to compare at a limited viewport without
mistaking the scroll cache for a fault is tracked separately.
