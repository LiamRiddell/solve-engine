---
"solve-engine": patch
---

Highlighting a line looks each token's built-in category up in a `Map` built once, so a 100-token line highlights at its former speed again.

Once token categories became per engine (#710), every lookup reached the built-in table through `Object.prototype.hasOwnProperty.call`, which reads the global `Object` on each call. Inside a `vm` context, the harness the benchmarks run in, that read costs hundreds of nanoseconds, and highlighting asks once per token: the benchmark gate confirmed `highlight_long_expression` at 3.3 times its merge base. The table is now a `Map`, built when the module loads, which reads no global and holds a type named like an `Object.prototype` property as an ordinary missing key.

| `getSemanticTokens`, cold, median | before | now |
| --- | --- | --- |
| `1+1` fifty times over | 0.067 to 0.073 ms | 0.025 to 0.030 ms |
| `1 + 2 * 3` | 0.005 to 0.008 ms | 0.003 to 0.004 ms |

The boundary: the categories themselves are unchanged, and a package's category still wins over the built-in one. Measured through `jest.bench.config.cjs` on a shared container, two interleaved runs each.

## Verification

`__tests__/language/BuiltinTokenCategoryLookup.spec.ts` (7 tests) covers the table's categories, unknown, empty and differently cased types, every word in `PROTOTYPE_WORDS`, a source check that the lookup reads no global (it fails on the previous lookup), the per-engine table over it, and a long line's categories. The language, #710 and #771 specs pass, and `typecheck`, `typecheck:tests` and `lint:comments` are clean.
