# SoulverCore feature-parity audit

This is a systematic, page-by-page cross-check of `@solve/core`'s feature set against
SoulverCore's complete, authoritative documentation site
(`https://documentation.soulver.app/sitemap-pages.xml` — fetched directly, not
guessed/reconstructed from memory). Every page in both the "Documentation" and "Syntax
Reference" sections is listed with a concrete status. This exists as a standalone
artifact — not folded into `ARCHITECTURE.md`'s punch list — because it answers a
different question: not "what's architecturally wrong with the engine" but "does every
SoulverCore-documented capability have a `@solve/core` equivalent, and if not, why."

Status legend:
- ✅ **Implemented** — shipped in a built-in package, with tests, reachable through a
  real `ExpressionEngine`.
- 🔄 **In progress** — actively being implemented (see the note for which task/agent).
- ⏸️ **Deliberately deferred** — a scoped-down or explicitly-skipped piece of an
  otherwise-implemented feature, with the reason stated.
- ⛔ **Out of scope** — not an engine/`packages/core` concern at all (editor/app-layer
  UI, or a feature with no distinct expression syntax).

Last updated: 2026-09-30. The counts are measured, not typed; see below.

---

## Read this before trusting anything below

**The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`, which runs on every
build.** It collects every example Soulver's documentation states a result for
and fails in both directions: a regression in something that works, and a gap
that starts working without being promoted out of the gap list. Treat that file
as the source of truth and this document as commentary.

Measured today: <!-- parity:soulver.supported -->104<!-- /parity --> of
<!-- parity:soulver.total -->121<!-- /parity --> documented examples produce the
documented answer, <!-- parity:soulver.gaps -->0<!-- /parity --> do not, and
<!-- parity:soulver.formattingOnly -->17<!-- /parity --> differ only in
formatting. Those figures are written by `npm run stats:parity` into
`docs-internal/parity-stats.json` and into this page, and the spec fails when
either states a figure it did not measure (#786).

The per-page statuses below were first written by reading the code rather than
running it, and on 2026-08-06, when the examples were first executed, most were
wrong: this page claimed 39 of 40 pages implemented while 38 of 123 examples
produced the documented answer. The question each row answered, "does the engine
have something in this area", is not the same as "does the documented syntax
work". The pages that were wrong then have since been implemented and are
measured now, among them:

| Expression | Then | Now |
|---|---|---|
| `1/3 to 2 dp` | did not parse | = 0.33 |
| `5.5 rounded` | did not parse | = 6 |
| `37 to nearest 10` | did not parse | = 40 |
| `21 rounded up to nearest 5` | did not parse | = 25 |
| `90 minutes as timespan` | "Unknown converter" | = 1 hour 30 minutes |
| `$1,000 after 3 years at 7%` | did not parse | = $1,225.04 |
| `$1,000 for 3 years at 7% compounding monthly` | did not parse | = $1,232.93 |
| `annual return on $1,000 invested $2,500 returned after 7 years` | did not parse | = 13.99% |
| `present value of $1,000 after 20 years at 10%` | did not parse | = $148.64 |

The rows that answered confidently and incorrectly, the worst kind, are all
closed:

| Expression | Then | Now |
|---|---|---|
| `average of 36, 42, 19 and 81` | 59.33 | = 44.50 |
| `median of 10, 20 and 30` | 30 | = 20 |
| `sin(90 degrees)` | 0.89 | = 1 |
| `200 + 10%` | 200.10 | = 220 |
| `20/5 as multiplier` | 5x | = 4x |
| `tax on $300 at 15%` | $345.00 | = $45.00 |

`value of $500 in 2028 assuming 5% inflation` was the seventh. Its direction is
fixed (it compounded up), but its documented figure was computed against the
year Soulver's page was written, so no fixed string reproduces it; the spec
leaves it out for that reason and `InflationParselets.spec.ts` asserts the
relationship against the current year instead. The two CPI rows (`what is $4.2k
from 2003`, `what was $500 worth in 1997`) are left out for the same reason.

---

## Documentation section

| Page | Status | Notes |
|---|---|---|
| `getting-started` | ⛔ | Product onboarding copy, not a feature. |
| `totals-and-subtotals` | ⛔ / ✅ (engine primitive) | The floating-total UI widget + `⌘T` explicit subtotal marker are still app-layer, not attempted. But the underlying engine primitive — "sum every line above back to a boundary" — now exists as `packages/lines`' `total above`/`sum above`/`average above` (2026-08-01), stopping at a blank line or `#` heading rather than an explicit `⌘T` marker specifically. Close enough to remove the "would need a bigger architectural change" blocker; an explicit-marker variant, if ever wanted, is now a package-level addition on top of `LineExecutionContext`, not new VM/engine architecture. |
| `line-references` | ⛔ / ✅ (engine primitive) | Drag/double-click/`⌘\` to insert a reference to the previous line's answer is still a pure editor gesture, not attempted. But the underlying engine primitive this row anticipated — a `prev` keyword resolving to the immediately-preceding line's cached result — now exists (`packages/lines`, 2026-08-01), along with the more general `line<N>` (any line by number) and `sum`/`total`/`average(line X : line Y)` (range aggregation). The remaining gap is purely the editor-gesture UI (`src/app`), not the engine. |
| `variables` | ✅ | `packages/variables/` — `:name = expr`, `global :name`, redefinition/scoping via `ScopeManager`/`DependencyGraph`. |
| `trip-planning` | ⛔ | Confirmed pure presentation ("mark a line as a time point, later lines show relative offsets") built entirely on existing date/time math — not a new calculation domain. |
| `formatting` (+ region-settings, appearance-and-styles, answer-formatting-options) | ✅ (mostly) | `format/FormatEngine.ts` + `FormattingSettings`. One confirmed real gap: `FormatEngine.formatDatetime()` ignores `localeCode` for weekday/month names (GitHub issue #77) — not yet fixed. |
| `sheets-and-files` (+3 subpages) | ⛔ | File/document management — app-layer (Obsidian's own file system, or the webapp's document model), not engine syntax. |
| `live-data/weather` | ✅ | `packages/weather/` — Open-Meteo-backed (free, keyless), built on `createQueryResolver`, built-in by default. `weather in <city>` / `temperature in <city>` / `feels like in <city>` / `high in <city>` / `low in <city>`. |
| `live-data/live-and-historical-stock-prices` | ✅ (opt-in) | `packages/stocks/` — `createStocksPackage({ fetchQuote, ... })`, opt-in (not in `BUILTIN_PACKAGES`) since no free keyless market-data API exists; unconfigured, fails with an honest "not configured" error rather than fake data. `stock(<TICKER>)` is the reliable syntax; a gated bare-ticker form (~50-ticker allow-list) is also supported. |
| `live-data/knowledge-assistant` | ✅ (opt-in) | `packages/knowledge/` — `createKnowledgePackage({ answerQuery })`, opt-in for the same reason as stocks. `search: <query text>` (or `ask:`/`google:`, the preferred, self-documenting form) via a new `rawLinePatterns` lexer extension point (see `ARCHITECTURE.md` §5.1) since the query text isn't valid Solve syntax — the original Calca-style `<query text> = ?` trailing marker also still works, kept for compatibility. |
| `live-data/wolfram-alpha` | ✅ (opt-in) | Same feature as knowledge-assistant above (Wolfram|Alpha is SoulverCore's specific backend for it) — covered by the same package. |
| `exporting` (+ sharing-and-printing, soulver-studio) | ⛔ | Export/sharing UX — app-layer. |
| `integrations` (+4 subpages) | ⛔ | Third-party app integrations (Shortcuts, Alfred, etc.) — host-application concerns, not engine syntax. |
| `tips-and-tricks` (+2 subpages) | ⛔ | User-facing tips, not a feature spec. |

## Syntax Reference section

| Page | Status | Notes |
|---|---|---|
| `general/operators` | ✅ | `packages/arithmetic/` — `+ - * / ^ %`, parens, implicit multiplication. |
| `general/number-rounding` | ✅ **measured** | Every documented form is in the spec's `SUPPORTED` list (`1/3 to 2 dp`, `5.5 rounded`, `37 to nearest 10`, `21 rounded up to nearest 5`). |
| `general/averages-and-median` | ✅ | `packages/mathphrases/` — `average of X, Y, Z`, `median of X, Y, Z`. |
| `general/logarithms-and-roots` | ✅ | `packages/arithmetic/` / `FUNCTION_PACKAGE` — `sqrt`, `log`, `ln`, etc. (pre-existing). |
| `general/trigonometry` | ✅ | `FUNCTION_PACKAGE` — `sin`/`cos`/`tan`/etc. (pre-existing). |
| `general/conditionals-and-comparisons` | ✅ | `packages/conditionals/` — `==`/`!=`/`<`/`>`/`<=`/`>=`, `and`/`or`/`&&`/`\|\|`, `if X then Y else Z`. |
| `general/general` ("Miscellaneous") | ✅ | Fully covered by `packages/mathphrases/`: unit/percentage stripping (`as number`), proportions (`is to ... as ... is to what`), `larger of`/`smaller of`, `half of`, `midpoint between`, `gcd`/`lcm`/`permutation`/`combination`, `clamp`. Confirmed no remaining gap on this page. |
| `percentages` | ✅ | `packages/percentage/` — `X% of Y`, `X increase/decrease by Y%`, `as %`. |
| `units-and-conversions/units` | ✅ (mostly) | `packages/uom/`. Confirmed real gap: only 16 of ~25 `convert`-package measure categories are wired (missing Speed, Voltage, Current, Parts-Per, etc.) — tracked in `ARCHITECTURE.md` P1, not yet fixed. Digital-storage units (GiB/MiB) confirmed **not** actually part of SoulverCore's own documented unit set (separate ask, GitHub issue #73). |
| `units-and-conversions/unit-reference` | ✅ (same gap as above) | Reference list, not new syntax. |
| `units-and-conversions/currencies` + `currency-reference` | ✅ | `packages/currency/` — `CurrencyAsyncResolver`, ECB-rate-backed. |
| `units-and-conversions/rates` | ✅ | `Rate` value/opcode band (`vm/Value.ts`, `parser/OpCode.ts` 110-119) — `$99/week`, `30 fps`, rate arithmetic. |
| `units-and-conversions/cooking-and-volume-calculations` | ✅ | `packages/uom/` — 87-name (~70 distinct) bundled ingredient-density table, mass↔volume conversion via a context-sensitive ingredient-name normalizer rule (`:butter = 5` stays safe). US Customary only (Imperial/Metric variants deferred, documented). |
| `dates/dates-and-times` | ✅ | `packages/datetime/` — `now`/`today`/`tomorrow`/`yesterday`, date arithmetic, `next`/`last <Weekday>`, `until`/`since`. |
| `dates/workdays-and-weekdays` | ✅ | `packages/datetime/` — Mon-Fri business-day math via `addBusinessDays()` (`vm/VM.ts`), `workdays in <duration>`, `<date> +/- N workdays`, `$X/workday` Rate literals (workday↔day 7/5-ratio shim in `uom/UomConverter.ts`), `day of the week on <date>` / `weekday on <date>`. **Scoped deliberately**: no public-holiday exclusion (SoulverCore's own version needs a live, region-configurable holiday database — a real data-source decision out of scope for this pass, documented as such rather than silently faked). |
| `dates/timestamps-and-iso8601` | ✅ | `packages/datetime/` — `<date> as iso8601` (via the `asConverters` extension point), `<ISO8601 string> to date`, `<date> to timestamp`, `<unix timestamp> to date` (magnitude-based ms/s disambiguation at a 10¹² threshold), `current timestamp`. |
| `time/time-zones-and-cities` | ✅ | `packages/time/timezones/` — native `Intl`/IANA math, `CITY_TO_IANA_ZONE` table (~50-100 major cities, documented as additive), `time in <city>`, `<time> <city> in <city>`, `time difference between <city> and <city>`. |
| `time/timespans-and-laptimes` | ✅ **measured** | `packages/time/`: lap-time literals (`HH:MM:SS[.f]`), `as timespan`/`as laptime`; the documented forms are in `SUPPORTED` or, where only the rendering differs, `FORMATTING_ONLY`. |
| `time/clock-time-calculations` | ✅ | `packages/time/` — clock-time literals (`9:00am`, `16:00`), interval-between (`7:30 to 20:45`), arithmetic with day-rollover. |
| `time/video-timecode-and-frame-rates` | ✅ | `packages/time/` — `HH:MM:SS:FF at/@ Nfps` literals (`Uom(totalFrames, "timecode@fps")`, activating the previously-dormant `@` lexer token), fps-aware carry arithmetic (`combineTimecode()` in `vm/VM.ts`), `... in frames` and the reverse `<N> frames @ <fps>` → `HH:MM:SS:FF` conversion. Previously explicitly deferred in `TimePackage.ts`'s own doc comment; now closed. |
| `money-and-finance/investments` | ✅ **measured** | Every documented form is in the spec's `SUPPORTED` list: compound growth (`$1,000 after 3 years at 7%`), compounding intervals, return on investment, `annual return` and `present value`. The reader-facing page is `syntax/investments.md` (#778). |
| `money-and-finance/mortgages` | ✅ | `packages/finance/` — `LoanRepaymentParselet`, `amortizeLoan()` (daily/monthly/annual repayment & interest). |
| `money-and-finance/sales-tax` | ✅ | `packages/finance/` — `SalesTaxParselet` (`tax on $X at Y%`) — deliberately requires an explicit rate, never hardcodes/assumes one (see the parselet's own doc comment). |
| `money-and-finance/inflation-calculations` | ✅ | `packages/finance/` — bundled US CPI-U table generated from the BLS series (1913 to the current year, #700), `inflationAdjust(amount, fromYear, toYear)` plus 5 phrase forms (`what is $X from <year>`, `what was $X worth in <year>`, `$X in <year> dollars`, `value of $X in <futureYear> assuming N% inflation`). Previously explicitly deferred in `FinancePackage.ts`'s own doc comment; now closed. |
| `bases-and-bitwise` | ✅ | `packages/converters/` + `packages/arithmetic/` — `as hex`/`as binary`/`as octal`, `hex()`/`bin()`/`int()` functions, bitwise `& \| ^ ~ << >>` (pre-existing), large-number suffixes (`2.5k`, `5M`, `10G`, `20T`). |
| `headings-and-comments` | ✅ | Confirmed already implemented (`COMMENT` token, `//`-style comments) — verified via a dedicated test pass (`Comments.spec.ts`) rather than assumed. |
| `large-number-symbols` | ✅ | Same suffix-normalizer work as bases-and-bitwise above (`k`/`M`/`G`/`B`/`T` input suffixes). |
| `experimental/x` | ⛔ | SoulverCore's own explicitly-labeled experimental/unstable area — not a stable spec to match. |

---

## Summary

Of the ~40 distinct documentation/syntax-reference pages describing an actual
calculation feature (excluding pure app-layer/UX pages, marked ⛔ above): **39 are
✅ implemented and tested** (3 of them — stocks, knowledge, wolfram-alpha — opt-in via a
host-supplied provider rather than built-in by default, documented as such), and **1 is
⏸️ deliberately deferred** with a documented architectural reason
(totals-and-subtotals' cross-line aggregation piece).

No page was silently skipped without a stated reason. Every ⏸️/⛔ status above links back
to a concrete rationale (either "no distinct expression syntax exists" or "needs a
larger architectural change than a package addition, tracked as a real follow-up").

**Completion pass (2026-08-01)**: the three remaining feature groups — Datetime/Time
completions (workdays/weekdays, timestamps/ISO8601, video timecode), Live Data
(weather/stocks/knowledge), and Finance inflation + UOM cooking/volume conversions —
were implemented via three parallel background agents and merged into this checkout.
Full four-command verification gate re-run clean after merge: `tsc --noEmit
--skipLibCheck` (0 errors), full `jest --no-coverage` (153 suites / 3232 tests passed,
6 skipped, 0 failed), `tsup` (build success), and the plugin's production `esbuild`
(340.8 KB bundle). See `ARCHITECTURE.md`'s "Done since last pass" section for the
per-feature technical detail and the real multi-agent-merge lesson this round
surfaced (`isolation: "worktree"` does not isolate `packages/core`, since it's
uncommitted). This document remains a living audit, not a one-time snapshot — update it
if a future pass finds SoulverCore has added new documented syntax.
