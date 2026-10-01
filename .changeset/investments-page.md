---
"solve-engine": patch
---

The investment grammar has its own page: what a sum grows to, what a future sum is worth today, and the return on an investment

The finance package reads `$1,000 after 3 years at 7%`, `present value of ... after 3 years at 7%`, `$500 invested $1,500 returned` and `annual return on ...`, and no syntax page documented any of them; the only mention was on the date-arithmetic page, explaining why `after` is not always a date offset (#778). `syntax/investments.md`, in the Finance group, says what compound growth, present value, return on investment and annual return are, then proves each.

| line | before | now |
| --- | --- | --- |
| `$1,000 after 3 years at 7%` | = $1,225.04, on no page | the same, documented |
| `$1,000 for 3 years at 7% compounding monthly` | = $1,232.93, on no page | the same, with the intervals listed |
| `present value of $10,000 over 5 years at 6%` | = $7,472.58, on no page | the same, documented |
| `$500 invested $1,500 returned` | = 2, on no page | the same, explained as profit over cost, a 200% return |
| `annual return on $1,000 invested $2,000 returned after 5 years` | = 14.87%, on no page | the same, documented |

The page lists the compounding intervals read (`annually` or `yearly`, `semi-annually`, `semiannually` or `half-yearly`, `quarterly`, `monthly`, `fortnightly`, `weekly`, `daily`) and the `compounded` spelling, and says why `biannually` is refused. The date-arithmetic page links it, and the cheatsheet has its line.

The boundary, named on the page: `present value of` takes its term after `after` or `over`, and `present value of $10,000 in 5 years at 6%` is a parse error, though the parselet's own comment says `in` is accepted (the annual-return form does accept it); it also takes no `compounding` tail. Spreadsheet-style calls (`fv`, `pmt`) are not read. An infinite amount invested (`(1/0) invested $1,500 returned`) answers NaN rather than a refusal; it is pinned as a `test.failing` so the fix turns it red.

## Verification

`Issue778_investments.spec.ts` holds 219 tests: every line the page documents answers as written and agrees through `parseDocument` and `evaluateDocument`; the ten listed intervals give their answers and grow with frequency below the continuous limit; four unlisted intervals and every prototype word after `compounding` are refused naming the listed ones; the page's boundary is a refusal. The adversarial cases: prototype words as the amount, the term and the rate, huge terms and rates within the budget, text edges after the line and digits from another script, typos, a check, a tag and a section around the forms, the line above as the amount, the numeric edges through eight templates, a zero term and rate, and CRLF. `AdversarialFeatureSweep.spec.ts` gains an `investments` template (114 cases).

Gates run in the worktree: `npm run lint`, `npm run lint:comments`, `npm run lint:docs`, `npm run lint:cheatsheet`, `npm run lint:sidebar`, `npm run lint:keywords`, the docs, hardening and integration suites, and the fast suite (16,184 of 16,188 tests in 617 suites passed, 4 skipped). `tsgo` is not installed on the machine this ran on, so `npm run typecheck` could not run and `tsc` stood in for it; `npm run verify:ci` was not run end to end.
