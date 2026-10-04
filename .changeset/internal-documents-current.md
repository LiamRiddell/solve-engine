---
"solve-engine": patch
---

The internal plans, parity audits and release runbook describe the tree as it is, and the parity counts they quote are measured

Three sets of internal documents had drifted from the engine (#785, #786, #787). None is a reader-facing page, but each is what a maintainer reads before changing the code, and stale rows inflated the survey that planned the next releases.

| document | before | now |
| --- | --- | --- |
| `plans/ARCHITECTURE_IMPROVEMENTS.md` | L1 "NOT ATTEMPTED", sixteen plugin-era paths, 89 suites | a status table (done, partly done with what remains, dropped, or moved to obsidian-solve or 3.0) and the order for the rest of 2.x (#785) |
| `PARITY_BACKLOG.md` | 104 of 122, "2 do not"; an unknown currency target "fails silently" | 104 of 121, 0 do not, 17 differ only in formatting; `$100 in XYZ` is `"XYZ" is not a unit.` (#786) |
| `SOULVERCORE_FEATURE_AUDIT.md` | rounding "0 of 10 parse", investments "every form throws", confident-wrong rows "still open" | `1/3 to 2 dp` is `= 0.33`, `$1,000 after 3 years at 7%` is `= $1,225.04`, `200 + 10%` is `= 220`, all measured |
| `OTHER_APPS_FEATURE_AUDIT.md` | "deliberately requires `:name = value`" | bare names ship: `price = 20` then `price * 3` is `= 60` through both passes |
| `RELEASING.md` | a second runbook, describing a publish dispatch that no longer exists | a pointer to the site's releasing page, which gained its "things that have gone wrong" and "publishing by hand" sections (#787) |
| `ci.yml` and `check-doc-coverage.mjs` | the language packages "not covered yet; 55 gaps remain" | every export under `packages/engine/src` needs a doc block, which is what the script checks (0 undocumented) |

The parity counts are no longer typed. `SoulverParity.spec.ts` and the new `OtherAppsParity.spec.ts` write them to `docs-internal/parity-stats.json` and into markers in the audits under `npm run stats:parity`, and an ordinary run fails when the file or a marker states a figure the spec did not measure. `OtherAppsParity.spec.ts` is in the Soulver spec's shape: each example Numi and Numbr document with a result, and the Notes Calculator example the audit quotes, is in `SUPPORTED` (8), `GAPS` (2, the CSS pixel conversions, which need a unit ratio a variable can change) or `DECLINED` (1, bare `x` as multiplication, still refused), and the spec fails in both directions, with both document passes agreeing on every row.

The boundary: internal documents and comments only; the release process and the engine do not change. The other-apps corpus covers the apps whose documentation could be fetched when it was collected (Numi's wiki and Numbr's DOCS.md); NumPad, Notes Calculator and Calca are named in the spec as not yet collected, with the reason, rather than guessed at. The architecture plan records decisions and the survey's order; it does not re-plan.

## Verification

`OtherAppsParity.spec.ts` holds 18 tests: its rows, the gap, declined and not-collected checks, the corpus's shape, the matcher's hostile cases and the count checks; with `SoulverParity.spec.ts` the two ran 145 tests. `npm run lint:docs` reports 0 undocumented exports, and `lint:ci-parity`, `lint:links` and `lint:sidebar` pass.

Gates run: the full suite (`npm run test:full`) ran 24,912 tests in 728 suites: 24,907 passed and 4 were skipped. The one failure was the #729 spec that keeps explain-before-show exemptions honest, since the unit reference's new headlines explain before each table and its exemption no longer named anything; the exemption is removed and that spec passes on a rerun. `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:links`, `lint:units`, `lint:ci-parity` and `lint:jest-configs` passed. `npm run verify:ci`, the docs site build and the bundled-consumer contract were not run whole for this change; CI runs them.
