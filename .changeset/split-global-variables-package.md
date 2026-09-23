---
"solve-engine": minor
---

Document-spanning variables are their own package, so a host can refuse them and keep ordinary ones

`:name = expr` and `global :name` are different levels of functionality. One defines a value inside the
document being evaluated. The other reaches outside it, into a store shared by every engine in the
realm. A host can reasonably want the first and not the second: a single-document editor, a sandboxed
evaluation, or a product where one document quietly reading another would be surprising.

Both lived in `VARIABLES_PACKAGE`, so that choice could not be expressed. The documented way to drop a
feature is to filter it out of `BUILTIN_PACKAGES`, and doing that here took `:x = 1` down with
`global :x = 1`:

| line | `filter(p => p !== VARIABLES_PACKAGE)`, before | now, `filter(p => p !== GLOBAL_VARIABLES_PACKAGE)` |
| --- | --- | --- |
| `:subtotal = 41` | parse error | 41 |
| `:subtotal + 1` | parse error | 42 |
| `global :x = 5` | parse error | parse error |

A host that wanted only the document-spanning half refused had to register a replacement parselet for
the `GLOBAL` token and rely on the later registration winning, which works but is not a supported
interface and warns when it happens.

`GLOBAL_VARIABLES_PACKAGE` is now exported alongside `VARIABLES_PACKAGE` and registered by default, so
nothing changes for a consumer taking `BUILTIN_PACKAGES` as it comes. The async resolver that backs a
read of a not-yet-declared name travels with it, since it exists only to serve that syntax. Neither
package leans on the other: the global parselet consumes its own colon and name, so either can be
registered without the other.

Two things worth knowing, both unchanged by this and both pinned by tests:

- Dropping the package removes the SYNTAX, not the values. The store is realm-wide and outlives any one
  engine, so whatever another engine already wrote is still there, merely unaddressable. The workspace
  in `docs-internal/plans/CROSS_SCOPE_CELLS.md` is what resolves that, after which refusing the feature
  is declining to pass a workspace.
- The `global` keyword is claimed by the locale whether or not the package is registered, so a document
  containing `global :x` without it reports a parse error on that line rather than evaluating to
  something else. The rest of the document is unaffected.

Marked a minor rather than a patch because it adds a public export and changes what filtering
`VARIABLES_PACKAGE` removes. A host doing that today to drop variables entirely now keeps the
document-spanning form and should filter both.

## Verification

A new suite pinning the separation in both directions, that dropping either package leaves the other
working, that the refusal is contained to its own line, and that the two descriptors do not register
each other's parselets, so a later tidy-up that merges them back fails with a clear reason.
`npm run verify` passes: 484 suites, 9,482 tests, plus the lint, docs, units, sidebar and package gates.
