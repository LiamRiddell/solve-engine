---
"solve-engine": patch
---

An undefined name costs a few microseconds from a timer callback, not dozens

Called from a timer callback, a line reading a name nothing defines cost many times a line that adds two numbers, because the VM threw `UNDEFINED_VARIABLE` from inside its dispatch loop (#714). A throw made outside a promise job has V8 record where it was thrown, and finding that position inside a function as large as the dispatch loop is what cost; after an `await`, no such record is made and the cost did not appear. Every throw in the loop now goes through a small function of its own, so the loop itself throws nothing. The error is the same: the same code, message and suggestion.

| per call of `evaluateExpression`, warm, median of nine batches of 10,000 | before | now |
| --- | --- | --- |
| `zz + 1` from a `setTimeout` callback (`Undefined variable: zz`) | 21.89 µs | 7.08 µs |
| `zzfn(1)` from a `setTimeout` callback (`Undefined function: zzfn`) | 21.41 µs | 8.14 µs |
| `2 + 5` from a `setTimeout` callback, for comparison | 0.79 µs | 1.13 µs |
| `zz + 1` after an `await` | 2.31 µs | 2.18 µs |

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 10 from other work), with the engine's source bundled by esbuild, both builds in the same few minutes; `2 + 5` moves within this machine's noise. The dispatch loop also shrinks, from 47,527 to 46,080 bytes of V8 bytecode as the test suite compiles it, further under the 61,440-byte ceiling past which V8 stops optimising it.

The boundary: nothing a reader sees changes. `evaluateExpression` still throws for an undefined name; whether it should return the error instead is a 3.0 question. The gain is for synchronous callers (a timer, a top-level script, an editor's event handler); a host that evaluates after an `await` was already fast. The throw the engine makes at the API, outside the loop, is unchanged, which is most of what an undefined name still costs from a timer.

## Verification

`Issue714_throwsOutsideTheDispatchLoop.spec.ts` holds 20 tests. A source check counts the throw statements in `executeBytecode`'s own body and finds none (it found thirteen before). Each arm that threw is run and reports its code and message as before: an undefined name with its did-you-mean and the column-total hint, an undefined function, the wrong number of arguments, a builtin with too few, a missing function or unknown body, a global read before it resolved, an unknown opcode, the instruction and stack limits, an exact power past its ceiling, and a failing user-function body. The adversarial cases cover prototype words as names and as functions, a 10,000-character name, a thousand different undefined names, look-alike text, and the engine answering after every kind of refusal. `incrementalEditBenchmarks.spec.ts` times an undefined name against `2 + 5` from a timer callback, the context the cost appears in, since Jest calls a test body after an `await`. The bytecode size was measured with the same `--print-bytecode` run `npm run lint:dispatch-size` makes, run by hand in the worktree, where that script's own Jest invocation finds no spec.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 15,686 of 15,690 tests in 618 suites with 4 skipped; one suite that bundles through the main checkout failed during the run while that checkout was being changed, and passed on a rerun. The type check ran through `tsc` (`typecheck:tsc`), since `tsgo` is not installed here, and `npm run lint`, `lint:comments`, `lint:docs`, `lint:sidebar`, `lint:cheatsheet` and the proven docs examples passed.
