# Parity backlog

What is left to reach parity with Soulver's documented syntax, and what is
deliberately not being attempted.

**This file is commentary. The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`,** which runs on every
build and fails in both directions: a regression in something that works, and
also a gap that starts working without being promoted out of its list. If this
file and that spec disagree, the spec is right.

As of 2026-08-06: **104 of 122** documented examples produce the documented
answer, 2 do not, 16 differ only in formatting.

The two that remain are both the CPI table. Both are waiting on data rather
than code, and the row below records what was actually tried.

They are also year-dependent, in the same way as the future-projection row
that was removed from the corpus earlier: Soulver's documented figures were
computed when "today" was 2024, so they are not reproducible from a fixed
string regardless of how accurate the table becomes.

See `SOULVERCORE_FEATURE_AUDIT.md` for why the previous per-page audit was
unreliable, and the same reason this file avoids per-page status claims.

---

## Open, by area

Only the inflation rows are left. Every other area on this table has been
closed; the rows below are kept so the history of what the work involved is
not lost.


Ordered roughly by size of the work rather than by row count. "Rows" are
entries in the spec's `GAPS` list.

| Area | Rows | What is missing | Shape of the work |
|---|---|---|---|
| Inflation data | 2 | `what is $4.2k from 2003`, `what was $500 worth in 1997` | **Blocked on data, not code.** See below. |

## Currencies

Tracked separately because it is a correctness bug rather than a missing
feature, and because it is not in the parity corpus (Soulver's currency
examples need live rates).

| Issue | Status |
|---|---|
| `$100 in UAH` silently returned the original amount, unconverted | Fixed |
| `CurrencyExchange.isCurrency()` was a hardcoded 46-code allowlist | Fixed: answers from the ISO 4217 active set, whole set asserted |
| An unrecognised target fails **silently** rather than erroring | Open, and the more important half |

The silent failure is the real defect. A code the engine does not know should
say so; returning the input unchanged means `$100 in UAH` reads as though a
conversion happened and the rate was 1.

## Not being attempted, with reasons

| Item | Why not |
|---|---|
| CPI table accuracy (~10% off Soulver) | **statisticsoftheworld.com was evaluated and does not cover the range.** `GET /api/v1/series/IMF.CPI.YOY.M?geo=USA` works, needs no key, and returns IMF monthly year-over-year rates, but only 317 observations: 2000-01 to 2026-06, even when `from=1960-01-01` is requested. The bundled table spans 1970-2026, and one of the two failing rows (`what was $500 worth in 1997`) is before the API begins, so it cannot be answered from this source at all. It could refresh 2000 onward, which would need the year-over-year rates chained into index levels since the API publishes rates rather than an index. A source covering 1970-1999 is still needed, or the table stays bundled and labelled approximate for those years. |
| `0.25 turns` as an angle literal | `turn`/`turns` are **deliberately excluded** in `lexer/units.ts`: "ordinary English, against a full-rotation angle unit". Admitting them would make the word "turns" in a sentence become a quantity. The unit stays reachable as gradians, and the exclusion is now asserted rather than merely commented. `90°` is fixed. |
| Soulver's abbreviated output (`300k`, `3.3M`) | The values are correct; only the rendering differs. Not a bug fix but a formatting **default**: switching it on changes how every large number in every document renders, including ones with no relation to this work. It belongs in `FormattingSettings` as an opt-in (`abbreviateLargeNumbers`), decided deliberately rather than acquired as a side effect of a parity pass. Recorded in the spec's `FORMATTING_ONLY` list meanwhile, so the difference stays visible. |
| `latest` dist-tag pointing at a prerelease | Cannot be fixed while every published version is a prerelease: npm requires a `latest`. Resolves itself at 1.0.0. |

## Notes for whoever picks this up

- **Check both parse tiers.** Operators can be registered both in
  `PrecedenceParser`'s hardcoded Tier-1 table and as a Tier-2 parselet. Tier 1
  is what runs. A change made only to the parselet does nothing, and the suite
  stays green while it does nothing.
- **Bare keywords collide.** Claiming `on`/`off` outright broke the stocks
  package (`stock(AAPL) on April 12, 2005`) and the datetime grammar. Scope a
  common word with a normalizer rule keyed on an adjacent token instead, and
  check for phrases fused *later* than your rule runs.
- **`and` is not `+`.** It has its own token now (`AND_CONJ`) binding one step
  looser, so a phrase parselet can use it as a list separator. Parse operands
  at `BindingPower.Conjunction`, not `Product`.
- After any change: `npm run stats:tests` (needs `test:full` first) and
  `npm run stats:size` (needs `build`), or `lint:stats`/`lint:size` fail CI.
