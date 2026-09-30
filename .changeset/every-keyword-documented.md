---
"solve-engine": patch
---

Every word and phrase the engine reads is now on a syntax page, and `npm run lint:keywords` keeps it so

About twenty working names (`atan2`, `sinh`, `pow`, `vec3`, `as multiplier`) and 77 multi-word phrases (`what day is it on`, `compound interest on`, `how much per month to reach`, `is a business day`) appeared on no page, so a reader had no way to find them (#722, #831). Nothing noticed, because a page is proven only for what it shows. `scripts/check-keyword-docs.mjs` builds the engine the way a host does and collects every lexer keyword, normaliser phrase, `as` converter, call word and completion label, then fails on any that no syntax page mentions. It runs in `verify:ci` and in the packaging job of `ci.yml`, beside `lint:units`, since both read the built engine.

| line | before | now |
| --- | --- | --- |
| `atan2(1, 1)` | on no page | number functions, with `atan2(1 m, 2 kg)` refused |
| `sinh(1)`, `acosh(2)`, `atanh(0.5)` | on no page, or only in a list of refusals | a hyperbolic functions section, `= 1.18`, `= 1.32`, `= 0.55` |
| `clz32(1)`, `imul(2147483647, 2)` | on no page | bitwise operators, `= 31`, `= -2` |
| `vec3(1, 2, 3)` | on no page | vectors and matrices, `= [1, 2, 3]` |
| `20% as multiplier` | on no page | percentages, `= 1.2x` |
| `what day is it on 2026-12-25` | on no page | a new weekdays and week numbers page, `= Friday` |
| `week number of 2027-01-01` | on no page | the same page, `= 53`, with what an ISO week is |
| `total repayment on 200000 over 25 years at 4%` | on no page | interest and inflation, `= 316,702.10` |
| `vat of £120 at 20%` | named only as "accepted" | tax, `= £20.00` |

Each name is documented on the page of its area with a sentence on what it is for: the inverse and hyperbolic functions, `pow`, `expm1`, `log1p`, `degtorad` and `radtodeg` on number functions; the 32-bit functions with the bitwise operators; the camelCase finance calls and the repayment and interest phrases by the day, the year and in total on interest and inflation; the working-day spellings and the `is a business day` questions on working days; the multi-word places on time zones; the `as` spellings of the prefixed derived units; the column spellings on table columns. An alias is documented in a sentence beside the name it stands for (`arcsin` beside `asin`, `powmod` beside `modpow`). The day, month and ISO week of a date are a new area, so they have their own page, registered in the sidebar and on the cheatsheet.

A closing code fence on interest and inflation carried text after it (```` ``` A monthly ````), which does not close a fence in markdown, so the paragraph after it and the next heading rendered as part of the code block. It is on its own line now, and the prose it held reads again.

The text page says what it could not before (#831): a quoted string cannot hold a line break, since there is no escape for a new line, so `lines in "a\nb"` is 1 and `length of "a\nb"` is 4.

The boundary: the lint checks that a name is mentioned, not that it is proven, which `DocExamples.spec.ts` already covers, and it matches the name as text, so a name that is also an ordinary word counts wherever the word appears. Words a package's own normaliser rule fuses (`map(`, `sum(`) are not in a package's tables and are not checked. Five names are set aside in `scripts/keyword-docs-allowlist.json`, each with its reason: `mul`, which #829 proposes to retire, and `current timestamp`, `to date`, `to timestamp` and `as iso8601`, which the timestamps page of the open dates batch documents; each entry fails as stale once a page mentions it. `float` and the wrong argument counts of `vec2` to `vec4` are left to #828, and `as multiplier` on text and quantities to #829, so the pages show only what the engine answers correctly today.

## Verification

`Issue722_keywordDocs.spec.ts` holds 34 tests, running the script over fixture docs trees: a mention counts in prose, inline code and an example, in any case and across a wrapped line; a name inside a longer word (`pow` in `modpow`), in the frontmatter, on the unit reference or outside `syntax/` does not; the allowlist sets a name aside, matches it in any case, and fails when an entry is documented or no longer read. The adversarial cases: names and allowlist entries spelled as inherited properties, names holding pattern syntax, markup around a name, a zero-width character inside one, a page of a million repeated characters within the budget, CRLF pages, and a real run against the built engine. `DocExamples.spec.ts` proves every new example (934 tests).

Gates run in the worktree: `npm run lint`, `npm run lint:comments`, `npm run lint:docs`, `npm run lint:cheatsheet`, `npm run lint:sidebar`, `npm run lint:keywords`, `npm run lint:ci-parity`, `tsc --noEmit` over the engine and over the test tsconfig, the docs, hardening and integration suites, and the fast suite (16,184 of 16,188 tests in 617 suites passed, 4 skipped). `tsgo` is not installed on the machine this ran on, so `npm run typecheck` could not run and `tsc` stood in for it; `npm run verify:ci` was not run end to end.
