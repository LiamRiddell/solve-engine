---
"solve-engine": patch
---

A repeat pass over bare assignments costs what the document costs, not its square

A bare assignment (`price = 4`, with no leading colon) runs again through the full pipeline on every pass, and before it runs, each name it writes is put back to what the lines above left it. The evaluator asked the checkpoint chain, which answered by following its links one line at a time until one of them had written the name. A name no line above defines, which is every name in an ordinary list of assignments, was followed all the way to the top, so line N cost N steps and a second pass cost the square of the document (#712). The first pass was not affected.

The chain now keeps an index: for each name, the lines that wrote it, in document order. A lookup searches that list instead of walking, and the index follows every change to the chain (a line run again, a definition removed, a structural edit, a name forgotten).

| a document of lines `v0 = 1`, `v1 = 2`, and so on | before | now |
| --- | --- | --- |
| second pass, 1,000 bare assignments | 61.7 ms | 33.2 ms |
| second pass, 5,000 bare assignments | 1,400.3 ms | 120.4 ms |
| second pass, 10,000 bare assignments | 5,975.1 ms | 212.1 ms |
| second pass, 10,000 colon assignments (`:v0 = 1`), for comparison | 236.3 ms | 127.9 ms |
| one edit near the bottom of 10,000 bare assignments, viewport on the last 40 | 61.10 ms | 2.64 ms |

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 10 from other work), with the engine's source bundled by esbuild, the median of five passes, both builds in the same few minutes. The absolute figures run high on a busy machine; the shape is the point: ten times the lines cost the bare form 97 times the time before, and 6 times now.

The answers do not change: the index returns exactly what the walk returned, and the spec checks the two against each other after every operation of a long random run.

The boundary: a bare assignment still runs again through the full pipeline on each pass, because what it means depends on the state at its position; a cached program for bare assignments was considered and set aside for that reason. The replay the chain does when the viewport scrolls, from the top to the new position, is linear by design and is unchanged.

## Verification

`Issue712_checkpointNameIndex.spec.ts` holds 40 tests: the search itself at its boundaries (before the first line, between lines, a fraction, NaN, the infinities), the index through every method that changes the chain (a name written, dropped and written again, a name bound as both a function and a variable, `f(x) = x + 1` above `:f = 4`, a structural edit that moves, deletes and reorders entries), a 400-step random run checked against the old walk, a count of the links a repeat pass follows (249,500 at 500 lines before, none now), repeat passes against a fresh `parseDocument`, and the adversarial cases (prototype words as names, look-alike text, 3,000 lines, CRLF, numeric edges). `incrementalEditBenchmarks.spec.ts` carries the second pass with a scaling assertion. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 15,686 of 15,690 tests in 618 suites with 4 skipped; one suite that bundles through the main checkout failed during the run while that checkout was being changed, and passed on a rerun. The type check ran through `tsc` (`typecheck:tsc`), since `tsgo` is not installed here, and `npm run lint`, `lint:comments`, `lint:docs`, `lint:sidebar`, `lint:cheatsheet` and the proven docs examples passed.
