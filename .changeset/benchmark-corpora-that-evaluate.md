---
"solve-engine": patch
---

The benchmarks time documents that evaluate, every document-parse line is distinct, and a scroll is timed

The throughput benchmark, whose lines per second the Performance page publishes, was mostly measuring an error (#715). Its corpus assigned a variable on one line in five, and its arithmetic and chained lines read variables that were never assigned, so 36% of the 10,000-line tier failed with `Undefined variable`, the slowest ordinary path through the VM. Each of those lines now reads the nearest variable assigned above it, and no line of any tier fails. The document-parse benchmark cycled 33 fixed lines, so past 250 lines every further line was a compile-cache hit; seven of the 33 failed, among them `8 L/100km in mpg` (not the documented spelling) and a `line 1 + 100` that read the prose on line 1. It now builds its documents from distinct lines, about a quarter of them prose, in which every line other than the prose evaluates. Both corpora live in `tools/benchmarkCorpora.ts`, and the ordinary suite checks both claims.

| benchmark corpus | before | now |
| --- | --- | --- |
| throughput, 10,000-line tier | 4,316 distinct; 3,636 failing, all `Undefined variable` | 6,060 distinct; 0 failing |
| document-parse, 10,000 lines | 33 distinct; 2,864 failing, 214 of them `Undefined variable` | 10,000 distinct; 2,174 failing, all of them prose |

The throughput corpus change on its own moves the timing, which is why the published figure has to be re-recorded with it. A warm pass over the 10,000-line tier, median of seven, the engine's source bundled by esbuild:

| large tier, warm pass | published corpus | corrected corpus |
| --- | --- | --- |
| after an `await` (the context Jest runs a test in) | 105.3 ms | 63.4 ms |
| from a `setTimeout` callback | 100.3 ms | 64.8 ms |

The incremental suite gains what it lacked: a scroll through `setViewport` at 5,000 and 20,000 lines, and an assertion that a keystroke through `applyTransaction` and through `editLine` grows no faster than the document. Each compares two sizes timed in the same process, four times apart, and fails at a ratio of 6: linear growth reads about 4 and a quadratic term about 16, and the runner's own speed cancels out of the ratio as it cannot out of a cross-run baseline. The second pass over bare assignments is held to the same 6, down from 10. On this machine the keystroke ratios were 2.8 (`applyTransaction`) and 3.6 (`editLine`), and the scroll's 3.4.

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 4 from other work).

The boundary: the benchmarks stay in the Jest (ts-jest) harness, since that harness is the one that has caught real regressions. A scaling assertion catches a super-linear term and nothing else; a keystroke's absolute budget stays with `thresholds.json`. The published throughput table (`docs/src/data/benchmarkStats.json`) is re-recorded from the benchmark baseline with `npm run bench:baseline` and `npm run stats:bench` on the machine that recorded the current one, so the figures stay comparable; this change does not re-record it, and its figures still describe the old corpus until that is done. Whether `8 L/100km` should read as litres per 100 km is a units question for its own issue; the corpus uses the documented `l/100km`. A scroll that grows with the document (3.4 at four times the lines, where a viewport's cost should not grow) is reported rather than fixed here.

## Verification

`Issue715_benchmarkCorpora.spec.ts` holds 19 tests: each throughput tier has no undefined name and no error, every read names a variable assigned above it, the document-parse corpus is distinct at 50, 250, 1,000 and 10,000 lines with only its prose failing, its `line N` and fuel-economy lines evaluate, the helpers' boundary and hostile arguments (no lines, one slot, a slot count of zero, negative, fractional or NaN), and the adversarial cases: both corpora at size through both document passes with `Object.prototype` untouched, the passes agreeing value for value, and CRLF endings and a trailing newline. The benchmark suites `fullPipelineThroughputBenchmarks`, `documentParseBenchmarks` and `incrementalEditBenchmarks` were run through `jest.bench.config.cjs` and pass.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 21,148 tests in 683 suites: 21,143 passed and 4 were skipped. The one failure was in `Issue715_benchmarkCorpora.spec.ts`, whose honesty check compared two passes over `now + N days` lines a second apart; that document is now checked without the agreement, which the next case checks with those lines left out, and the new specs were rerun and pass. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measures 46,468 bytes by the `lint:dispatch-size` method, run by hand since that script's own Jest run finds no spec in a worktree.
