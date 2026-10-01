---
"solve-engine": patch
---

Recording where a failed line went wrong costs nanoseconds again inside a `vm` context

Since each failed document line began keeping its code and span (#709), the helper that moves a span onto its line ran once for every line that fails, which in a note is every line of prose. It was written with `Number.isFinite`, `Math.min` and `Math.max`. Where the engine runs inside a `vm` context, which a Jest environment is and so the benchmark job is, every read of a global such as `Math` goes through the context's interceptor, and the helper cost about 1.3 µs a call against 30 ns. The benchmark job's `document-parse/doc_200_prose_warm` ran 1.33 times its merge base. The helper is now written with comparisons, and the compile-cache bound read on every cache hit (#765) is written the same way. Every field a line keeps is unchanged: `errorCode` and `errorSpan` are the same for every finite argument, to the sign of zero.

| under Jest (ts-jest), warm | before | now |
| --- | --- | --- |
| `spanInLine`, per call, 200,000 calls | 1,287 ns | 113 ns |
| a 200-line prose note, per `parseDocument`, six interleaved runs, median of their medians | 1.12 ms | 0.86 ms |

The ratio is 1.30, the size of the regression the benchmark job reported. Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 4.4 from other work); the six runs of each ranged from 0.91 to 1.40 ms before and 0.70 to 0.90 ms after.

The boundary: a host that runs the engine outside a `vm` context never paid this, since a global read there is as cheap as any other; bundled by esbuild and run under Node, the same helper took 1.1 ms of the 1,163 ms a profile spent in the pass. Other global reads in hot paths are not audited here. A span whose shift is not a finite number is now no span rather than one holding NaN; the engine never passes one.

## Verification

`LineDiagnosticsSpanInLine.spec.ts` holds 8 tests. `spanInLine` agrees with the implementation it replaces on 28,672 finite combinations of start, end, shift and line length, compared with `Object.is` so the sign of zero counts; ordinary, boundary (clamped to the line, never ending before it starts, an empty line, negative zero) and hostile arguments (no span, NaN and the infinities in each field, a string offset, a NaN length) are tested; a source check finds neither `Math` nor `Number` in its code. `isFiniteNumber` answers as `Number.isFinite` does for nineteen values. A prose line in a document keeps `UNEXPECTED_TRAILING_TOKEN` and its span on the first and a repeated evaluation. `Issue709_documentLineFailures.spec.ts` passed unchanged, and `npm run lint:dispatch-size`'s measurement, run by hand, reads 46,468 bytes.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 21,148 tests in 683 suites: 21,143 passed and 4 were skipped. The one failure was in `Issue715_benchmarkCorpora.spec.ts`, whose honesty check compared two passes over `now + N days` lines a second apart; that document is now checked without the agreement, which the next case checks with those lines left out, and the new specs were rerun and pass. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measures 46,468 bytes by the `lint:dispatch-size` method, run by hand since that script's own Jest run finds no spec in a worktree.
