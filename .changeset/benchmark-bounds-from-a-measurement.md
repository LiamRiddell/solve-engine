---
"solve-engine": patch
---

Benchmarks: the absolute bounds are set from what the runner delivers

The benchmark specs carry plain `toBeLessThan` bounds alongside the merge-base
comparison, and several were set close to the figure the shared CI runner
actually produces. The pipeline suite's variable chain was the one that broke:
bounded at 2ms on a runner delivering medians of 1.61, 2.02, 2.05 and 2.10, it
failed three times in a row, on the **merge base** pass, which left the
comparison with nothing to compare and turned unrelated pull requests red.

The two instruments do different jobs, so they get different tolerances. The
comparison is the regression gate and sees a change of a few per cent. The
bounds are a smoke bound underneath it, there to catch a collapse, so each is
now at least four times the slowest median the runner has been measured
delivering, rounded up, with each test's name stating its own number.

| case | runner median | before | now |
| --- | --- | --- | --- |
| `variable_chain` | 1.61 to 2.10 | 2 | 10 |
| `single_eval_cold` | 1.34 to 2.30 | 2 | 10 |
| `mixed_complex` | 1.15 to 1.35 | 3 | 10 |
| `re_eval_dirty` | 1.03 to 1.34 | 2 | 10 |
| `function_plus_literal` | 0.84 to 1.19 | 2 | 5 |
| `create_engine` | 0.73 to 0.84 | 2 | 5 |
| `PROD_variable_chain` | 1.45 | 3 | 10 |
| `DIAG_single_eval_cold` | 2.30 | 5 | 10 |

Several names disagreed with their own number as well (`in < 1ms` over an
assertion of 2), so the names now say what the assertion says. The cases already
carrying a wide margin, the 50-line and 200-line documents at twelve and
twenty-eight times their measured figure, are unchanged.

No engine code changes. The reasoning is written into both spec headers and into
[testing](https://liamriddell.github.io/solve-engine/contributing/testing/), so
the next person to touch a bound reads why it is loose before tightening it.
