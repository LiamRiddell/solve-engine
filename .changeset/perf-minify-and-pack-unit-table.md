---
"solve-engine": patch
---

Ship the engine minified, and pack the unit table: about 60% less JavaScript to parse.

The build shipped unminified, so a consumer without their own bundler (Node, Deno, a CDN) parsed the full source, whitespace and all, on every load. The build now minifies, and the unit table is stored packed and decoded once at load rather than as 1,456 object entries that repeat 378 distinct ratios.

Parsed JavaScript, importing the whole engine:

| | before | now |
| --- | --- | --- |
| minified | 1,263 KB | 505 KB |

Nothing a consumer computes changes. Source maps stay on, so a production stack trace still points at real source; the two are never dropped together. The unit table's packed form is asserted at generation time to decode to exactly the source table, so a packing bug fails the build rather than silently altering a conversion. A consumer who already runs their own bundler was minifying this code anyway and sees only the unit table's few kilobytes; the parse saving lands for everyone who does not.

## Verification

- The generator asserts the packed unit table round-trips to its source over all 1,456 spellings; `UnitsTableIntegrity` and the conversion specs (115 cases) pass unchanged.
- The bundled-consumer contract runs `verify` and `test:consumer` against the packed, minified tarball before publish: 21 checks, including 502 documented examples, on both the ESM and CJS builds.
- 7,784 tests across 343 suites, no failures. `npm run verify` green.
