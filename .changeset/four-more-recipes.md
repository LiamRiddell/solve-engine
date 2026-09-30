---
"solve-engine": patch
---

Four more recipes, each one proven document (a household budget, a mortgage decision, a developer scratchpad, a lab note), and the Recipes group moves to straight after Start here

Recipes are pages written for what a visitor wants done rather than for a feature, and there were two. The document features (sections, tags, running totals, checks, what-if, goal seek) were each shown on their own page and together nowhere, and the Recipes group sat between Dates and Units, in the middle of the syntax reference, where a reader scanning the reference met it by accident and a reader looking for it did not (#727).

Each new recipe is one `solve-doc` block that `DocExamples.spec.ts` proves line by line, under prose that says what each part does and links the page behind it:

- **A household budget**: section totals, a `#fixed` tag, a running total of spending, and two checks, one of which fails on purpose and names both amounts.
- **A mortgage decision**: the repayment, the interest over the term, what-ifs on the rate, and goal seek on the loan a repayment of £1,400 allows (`solve line 8 for loan = £1,400` gives £251,874.45).
- **A developer scratchpad**: transfer times and decimal and binary data sizes, a Unix timestamp read in UTC and one written from ISO 8601, `sha256` and `crc32`, and hex, binary, a mask and a shift.
- **A lab note**: readings with their uncertainty carried into a density, two significant figures, an approximate check, and the unit conversions around it.

| sidebar | before | now |
| --- | --- | --- |
| Recipes | between Dates and Units | straight after Start here |
| pages | 2 | 6 |

The boundary: recipes use shipped forms only, and none reads the clock or the network, so every line is proven. Writing them found gaps the recipes step around rather than show: goal seek over a repayment whose principal is an expression (`on price - deposit`) is refused with an internal message, a conversion target with a power (`in kg/m^3`) is read without it, and a tolerance drops its unit (documented on the uncertainty page), which is why the lab note keeps its units in the labels. Those are reported separately.

## Verification

`Issue727_recipes.spec.ts` holds 35 tests: each new page carries a proven document, the batch pass and a live editor agree with the incremental pass on every line both answer, the mortgage's goal seek resolves incrementally and is refused by the batch pass, and the sidebar has Recipes after Start here and outside Dates to Units with all six pages. The adversarial cases are the budget's tag renamed to each prototype word, two thousand lines of spending, markup in a label (refused as a line, with the tag total naming it), a misspelt tag, an unreadable rate, a unit on an uncertain reading, the UTC timestamp, each recipe with CRLF and a trailing newline, a zero deposit and rate, and the 32-bit edges.

The fast suite ran across 662 suites (19,327 of 19,332 tests passed, 4 skipped); its one failure was a spec still importing the snapshot's old `serializeValue` name, which was renamed in it and passes on a rerun. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, as did the proven docs examples and the hardening and integration suites. `npm run verify` and the bundled-consumer contract were not run for this change.
