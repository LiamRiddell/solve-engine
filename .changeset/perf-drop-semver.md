---
"solve-engine": patch
---

Drop the bundled `semver`: about 25 KB less JavaScript to parse.

`semver` was bundled for a single engine-version compatibility check, and its named-import slice pulled essentially the whole library in. That check now runs on a small internal range checker covering the grammar a package's declared `engineVersion` actually uses, and nothing more: exact, caret (with node-semver's documented `0.x` narrowing), tilde, the `>= <= > < =` comparators, whitespace for AND and `||` for OR, and the `*` wildcard.

Parsed JavaScript, importing the whole engine:

| | before | now |
| --- | --- | --- |
| minified | 505 KB | 480 KB |

Package gating is unchanged: a prerelease engine still accepts a package written for the release it is a prerelease of, a `0.x` caret still narrows to the minor (`^0.1.0` accepts `0.1.5`, rejects `0.2.0`), and a malformed range is still reported as a distinct invalid-range error rather than a version mismatch.

## Verification

- The engine-version-gate specs (25 cases) pass unchanged, and a new `SemverRange` spec (28 cases) pins the range grammar directly: caret across a major and the `0.x`/`0.0.x` narrowings, tilde, AND/OR clauses, wildcards, and the invalid-range forms.
- The bundled-consumer contract confirms no `semver` identifier reaches the shipped bundle.
- 7,812 tests across 344 suites, no failures. `npm run verify` green.
