# Parity backlog

What is left to reach parity with Soulver's documented syntax, and what is
deliberately not being attempted.

**This file is commentary. The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`,** which runs on every
build and fails in both directions: a regression in something that works, and
also a gap that starts working without being promoted out of its list. If this
file and that spec disagree, the spec is right.

As of 2026-08-06: **100 of 122** documented examples produce the documented
answer, 6 do not, 16 differ only in formatting.

See `SOULVERCORE_FEATURE_AUDIT.md` for why the previous per-page audit was
unreliable, and the same reason this file avoids per-page status claims.

---

## Open, by area

Ordered roughly by size of the work rather than by row count. "Rows" are
entries in the spec's `GAPS` list.

| Area | Rows | What is missing | Shape of the work |
|---|---|---|---|
| Rates | 4 | `30 bottles / week`, `$20/day + $300/week`, `$24 a day for a year`, `30 hours at $30/hour`, `$500 at $20/hour` | The core is done: a denominator with no number now builds a rate directly instead of dividing, so `3 hours / day` is a rate and `3 hours / 3 days` still cancels. What is left is (a) an unrecognised word as the numerator unit (`30 bottles / week`), (b) rate addition across differing periods, which needs the two reconciled first, and (c) `at` with a rate, which multiplies or divides depending on which side carries it. All fail loudly rather than answering wrongly. |
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
| CPI table accuracy (~10% off Soulver) | Needs a real US Bureau of Labor Statistics series. The bundled table is documented as approximate. Inventing more precise-looking numbers would make it worse, not better: it would remove the one signal that the figures are not authoritative. |
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
