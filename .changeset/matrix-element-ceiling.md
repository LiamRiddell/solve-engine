---
"solve-engine": minor
---

A host can cap how many elements of a list or matrix are written, and writing each number no longer builds a formatter

`formatValue` and `formatMatrixAligned` read a new, opt-in setting, `matrixResult.maxElements` (#764). Past it, a list shows its first elements and counts the rest, and a matrix shows the whole rows that fit and counts the rows left out, or only its shape when not one row fits. The elements left out are never formatted, so the time is bounded along with the text. The short form is the one a trace already wrote, and the trace now writes it through the same code.

| `formatValue(value, settings)` | before | now |
| --- | --- | --- |
| `map(10*x, 0:99999)` with `maxElements: 5` | the whole list, 888,791 characters | `= [0, 10, 20, 30, 40, and 99,995 more]` |
| `[1, 2, 3; 4, 5, 6; 7, 8, 9]` with `maxElements: 7` | `= [1, 2, 3; 4, 5, 6; 7, 8, 9]` | `= [1, 2, 3; 4, 5, 6; and 1 more row]` |
| `[1, 2, 3; 4, 5, 6; 7, 8, 9]` with `maxElements: 2` | `= [1, 2, 3; 4, 5, 6; 7, 8, 9]` | `= [3x3 matrix]` |
| `[1; 2; 3; 4]` with `maxElements: 2` | `= [1; 2; 3; 4]` | `= [1; 2; and 2 more]` |

The docs notepad and the playground pass a ceiling of 1,000.

The second change is independent and applies everywhere: numbers are written through one cached `Intl.NumberFormat` per locale and option set rather than `toLocaleString` with an options object, which builds a new formatter on every call. The cached formatter writes exactly what `toLocaleString` wrote, since that is how the specification defines it, and it keeps the locale's own grouping where no grouping was asked for (Spanish leaves `1234` ungrouped). The cache holds at most 64 formatters, because the locale is a host string. Formatting the list above, the engine's source bundled by esbuild:

| `map(10*x, 0:99999)` | before | now |
| --- | --- | --- |
| evaluate | 149.2 ms | 113.2 ms |
| format in full | 2,473.3 ms | 61.9 ms |
| format with `maxElements: 1000` | (no such setting) | 0.7 ms |

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 4 from other work); the evaluation figures move within this machine's noise.

The boundary: the ceiling is opt-in, and absent by default, because `formatValue`'s full text is also the stable, assertable form the API and the worker carry. A value that is not a whole number of at least 1 is no ceiling, and a fraction is rounded down. The count is grouped the English way whatever the number locale, as the trace writes it. This bounds the time spent writing a result, not what a large list costs to hold while its document is open, which is the per-document retention budget's concern.

## Verification

`Issue764_matrixElementCeiling.spec.ts` holds 27 tests. `numberFormatFor` writes what `toLocaleString` writes for twelve locales (the engine's three and nine whose grouping or digits differ), twenty numbers from negative zero and NaN to the largest and smallest doubles, three place counts and both grouping choices; returns the same formatter for the same options; throws the same `RangeError` for an unusable locale or place count; and stays bounded under 500 distinct locale strings and prototype words with `Object.prototype` untouched. `matrixElementCeiling` and `matrixPreview` are tested with ordinary, boundary and hostile arguments (zero, negative, NaN, the infinities, a string, `null`, an array, a bigint). The formatters are tested on lists, columns and matrices with and without the ceiling, under `de-DE`, merged over other settings, through `engine.formatValue`, and through a trace. The adversarial cases add prototype words in the settings group, a million elements, a ceiling of `Number.MAX_SAFE_INTEGER`, a list from the line above through both document passes (they agree), a snapshot round trip, and negative zero, NaN, the infinities, 2^53 and the smallest double as elements. The proven docs examples and the format and trace suites passed.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 21,148 tests in 683 suites: 21,143 passed and 4 were skipped. The one failure was in `Issue715_benchmarkCorpora.spec.ts`, whose honesty check compared two passes over `now + N days` lines a second apart; that document is now checked without the agreement, which the next case checks with those lines left out, and the new specs were rerun and pass. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measures 46,468 bytes by the `lint:dispatch-size` method, run by hand since that script's own Jest run finds no spec in a worktree.
