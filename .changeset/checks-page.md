---
"solve-engine": patch
---

Checks have their own page, and the two pages that read no other line leave the "Working across lines" group

A check has its own failure message, its own margin (`≈`, `within`) and a pass and fail count on the parse result, and it was a section inside the conditionals page, so a reader looking for checks found a page called Conditionals (#781). `syntax/checks.md` now says what a check is (a line stating something the note must keep true, the notepad's version of an assertion) before it shows one, and covers exact values, margins, how a check sits among the other lines, and what it refuses.

| line | where it was | now |
| --- | --- | --- |
| `check :spent <= :budget` | `conditionals.md#checks` | `checks.md`, `ERROR: check failed: $2,010.00 is more than $1,950.00` |
| `check 1/3 ≈ 0.33 within 1%` | not shown | `check failed: 0.333333 differs from 0.33 by 1.01%, more than 1%` |
| `total above` under a failed check | stated, not shown | shown: `£1,200.00`, stepping over the check |
| `check = 45` then `check * 2` | stated, not shown | shown: `90` |
| `check "a" > "b"` | stated, not shown | shown: `check: text can only be compared with == or !=, not >` |

The page is in the "Working across lines" group before goal seek, since a check reads the lines above it and the parse result counts checks across the note. `conditionals.md` moves to the Arithmetic group and `map-reduce-and-aggregates.md` to Statistics beside vectors and matrices, because neither reads another line. The cheatsheet follows the sidebar: checks has its own line, and the conditionals line no longer shows `check`. The TypeScript usage guide and the household budget and lab note recipes link the new page.

The boundary: both moved pages keep their slugs, so outside links still land, and `conditionals.md` keeps a one-sentence `## Checks` section pointing at the new page, so the old `#checks` anchor lands too. The prose of the moved pages is unchanged.

## Verification

`Issue781_checksPagePlacement.spec.ts` holds 10 tests: the sidebar groups read as text, the pointer section, that nothing links the old anchor, the cheatsheet lines, and the page's claims through both `parseDocument` and `evaluateDocument` (a total over a failed check, a variable called `check`, incomparable sides and text, zero, negative zero and 2^53, and a check over each word in `PROTOTYPE_WORDS` with `Object.prototype` unchanged). `DocExamples.spec.ts` proves every example on the new page.

Gates run: the full suite (`npm run test:full`) ran 24,912 tests in 728 suites: 24,907 passed and 4 were skipped. The one failure was the #729 spec that keeps explain-before-show exemptions honest, since the unit reference's new headlines explain before each table and its exemption no longer named anything; the exemption is removed and that spec passes on a rerun. `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:links`, `lint:units`, `lint:ci-parity` and `lint:jest-configs` passed. `npm run verify:ci`, the docs site build and the bundled-consumer contract were not run whole for this change; CI runs them.
