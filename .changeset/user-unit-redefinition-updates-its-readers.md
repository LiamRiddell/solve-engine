---
"solve-engine": patch
---

Changing a unit definition changes what reads it

`1 sprint = 2 weeks` is expanded while a line is being compiled, so the compiled
program for `3 sprints in weeks` has the ratio built into it. Editing the
definition left every line that used it answering the old way:

| step                           | `3 sprints in weeks` | `2 sprints in days` |
| ---                            | ---                  | ---                 |
| `1 sprint = 2 weeks`           | `6 weeks`            | `28 days`           |
| edited to `1 sprint = 3 weeks` | `6 weeks` before     | `28 days` before    |
| the same edit now              | `9 weeks`            | `42 days`           |

The answer only corrected itself if the reading line was edited too, or
otherwise made dirty.

The engine already dropped its own compiled-program caches when a definition
ran, and the comment saying why was right. What it missed is that the
incremental path keeps a compiled program per line on the document, and that
copy is the one it executes. Nothing dropped it, so the line stayed clean and
went on running bytecode compiled against the old definition.

The invalidation is conditional, and that is load-bearing. The handler that
defines a unit runs every time its line is compiled, which on the incremental
path is every pass in which that line is dirty. Invalidating unconditionally
would dirty the document again on each of them, and every pass would recompile
every line for ever. It fires only when the ratio or the base unit actually
moved, so a pass after a redefinition settles with nothing left to compile.

The boundary: this is about a definition that changes. A user unit is still not
a dependency key, so the invalidation is the whole document rather than the
lines that actually read the name. Definition edits are rare and a document
recompile is what a keystroke on line 1 already costs, so the coarse answer is
the right size for the problem; naming the readers would need the compiler to
report which user units a line referenced, which it does not.

## Verification

7 new tests: the readers updating, a changed base unit, a reader far below the
viewport, that an unchanged definition does not re-dirty the document, that
repeated passes after a redefinition settle rather than recompiling for ever, a
second definition not disturbing the first, and both document paths agreeing on
the same text. Four of the seven fail without the fix. `npm run verify:ci`, the
bundled-consumer contract, and the playground build all pass.
