---
"solve-engine": patch
---

A definition that failed leaves its name as the lines above left it

A pass from scratch skips the store when a definition's right-hand side errors,
so the name keeps whatever the lines above had put there: undefined if none set
it, and the earlier value if one did. The incremental path skips the store too,
but its VM is not fresh, so what the name kept was the value from the previous
pass, and for the line that had just failed that was its own old answer.

| document                        | action                  | before | now                     |
| ---                             | ---                     | ---    | ---                     |
| `:x = 5` / `x + 1`              | line 1 to `:x = zz + 1` | `6`    | `Undefined variable: x` |
| `:x = 1` / `x` / `:x = 7` / `x` | line 3 to `:x = zz`     | `7`    | `1`                     |

The checkpoint chain records what each line wrote, in document order, so the
value the prefix holds is the one it holds just before the failed line, and
that is what the VM is put back to, before the line's own checkpoint is taken.
Whether the right-hand side answered with an error, threw, or did not compile
makes no difference: the store did not happen in any of them.

The write stays declared. 2.38.21 dropped it for a line that answered with an
error, reasoning that such a line defined nothing, and the fault that caused was
worse than the one it fixed: a running total whose step failed (`spent += line 1`
with line 1 in error) recorded no write, so the reseed that re-runs every
accumulator each pass never found it again, and it stayed on the error after
the line it read had been fixed. An accumulator is also the one definition the
restore never touches, because every pass resets each total to its seed and
re-runs its steps in order, so by the time one fails the VM already holds
exactly what a pass from scratch holds there, seed included.

The goal seek that motivated the dropped write is handled where it belongs now:
its unknown is neither a read nor a write of the document, since the seek varies
it in its own call frame and stores nothing.

The boundary: a later expression on the same line that fails does not undo an
earlier one that succeeded, and a pending value is not a failure.

## Verification

8 new tests: a definition edited into an error, one that keeps an earlier
definition of the same name, one that recovers once fixed, a same-line pair, a
failed accumulator step being re-seeded once its input is fixed, keeping the
total built above it, showing the seed as a first step, and a cycle through it
that is broken again.

Found by the adversarial verification of the #444 fix, which had to write a
total that reads a position by hand. The fuzzer's generator now writes that,
a definition that reads a position or another name, a definition that fails,
and a user function, so the next thing of this kind is found by the soak.
