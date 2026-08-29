---
"solve-engine": patch
---

Make engine construction dramatically faster (no behaviour change).

Constructing an `ExpressionEngine` with the built-in packages had grown to about
2ms, almost all of it in registration rather than in evaluating anything, and it
scaled worse than linearly as packages were added. Three fixes remove that cost,
with no change to what the engine does:

- **The package-compatibility check was O(packages²).** Registering each package
  re-ran the pairwise `checkPackageCompatibility` against every package already
  registered, so with the full set that scan alone was the majority of
  construction. It is now an incremental index that checks a new package only
  against the ones sharing a declaration with it (a parselet token type, a
  phrase, a converter or plugin-function name, a lexer keyword, ...): a package
  that shares nothing can conflict with nothing, so the result is identical, in
  linear time. A parity test pins the index to the old pairwise result on the
  real built-ins and on crafted collisions across every category.

- **The lexer rebuilt its 1000+ entry unit set on every keyword registration.**
  The merged keyword map and the merged unit set were rebuilt together on each
  `registerVocabulary`, and the unit set is the whole built-in vocabulary, so
  every keyword-only package copied more than a thousand entries for nothing. The
  two are now rebuilt independently, and the common no-plugin-units case shares
  the built-in set directly rather than copying it.

- **The merged keyword map is maintained incrementally.** A plugin keyword can
  never shadow a built-in, so it is added straight to the merged map rather than
  rebuilding the whole thing.

| measure | before | now |
| --- | --- | --- |
| engine construction | ~2.0 ms | ~0.46 ms |
| a single cold evaluation | ~2.1 ms | ~0.6 ms |

Every cold-start benchmark improves accordingly (`single_eval_cold` about 3.4×
faster, and the pipeline suite about 2.5× overall), with no benchmark regressing.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks. The benchmark comparison
against the merge base reports the improvement with no regression over threshold.
New test: `api/PackageCompatibilityIndex.spec.ts` (index-vs-pairwise parity).
