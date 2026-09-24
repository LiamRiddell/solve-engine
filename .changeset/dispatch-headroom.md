---
"solve-engine": patch
---

The VM's dispatch loop has room to grow again

The function that runs every compiled line, `executeBytecode`, is one large loop with a branch for each instruction. V8, the JavaScript engine in Node and Chrome, only hands a function to its optimising compiler when the function's bytecode (V8's own compiled form of the source) is at most 61,440 bytes long: that is the `--max-optimized-bytecode-size` ceiling. Past it, on Node 22, the whole function runs unoptimised, and every instruction in every line is several times slower, `1 + 2` included, with no error and no change in any answer. Newer Node versions still reach an oversized function with Maglev, their middle tier, so there the loss is about a tenth, which is why a local run can miss what the benchmark job (on Node 22) reports.

Compiled the way the test and benchmark suites compile it, the loop had reached 61,055 bytes, 385 short of the ceiling. The next feature to add a few lines to any instruction would cross it. Twelve rarely used instructions now live in their own functions outside the loop, moved unchanged: the working-day and weekday date steps, a clock time today, list and matrix literals, indexing and slicing, ranges, and `map`, `reduce` and `plot`. The loop reads each instruction's operands exactly as it did, in the same order, and hands them to the moved code.

| `executeBytecode` bytecode | before | now | below the ceiling now |
| --- | --- | --- | --- |
| test and benchmark build (ES6) | 61,055 bytes | 44,267 bytes | 17,173 bytes |
| shipped build (ES2020) | 44,735 bytes | 33,516 bytes | 27,924 bytes |

Nothing a line answers changes. The common instructions (arithmetic, comparisons, variables, calls) stay in the loop, where they are fastest; a moved instruction costs one function call, which is small beside the work each of them does.

The boundary: the ceiling is V8's, not the engine's, and nothing enforces the headroom. A change that grows the loop should measure it (run a spec in band under `node --print-bytecode --print-bytecode-filter=executeBytecode` and read the `Bytecode length`) and move a body out rather than let it cross again. The note beside the moved functions in `vm/VM.ts` says so. The shipped ES2020 build compiles smaller, so a published engine was not yet at the ceiling; the test build was, which is where the benchmark suite found it.

## Verification

An A/B of every documented example, every expression the test suite evaluates, the moved instructions' success and error paths, and 6,000 generated lines, against the previous build with random draws seeded, shows no difference. The vm, pipeline, document-parse and cancellation-overhead benchmark suites, run alternately against the previous build, pass the regression gate, with suite geometric means between 0.98 and 1.01; run under `--no-maglev`, which stands in for Node 22, they stay at parity, where a loop past the ceiling measured the `vm` suite 3.2 times slower. `npm run verify:ci` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
