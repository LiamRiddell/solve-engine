# Parity backlog

What is left to reach parity with Soulver's documented syntax, and what is
deliberately not being attempted.

**This file is commentary. The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`,** which runs on every
build and fails in both directions: a regression in something that works, and
also a gap that starts working without being promoted out of its list. If this
file and that spec disagree, the spec is right.

As of 2026-08-06: **94 of 122** documented examples produce the documented
answer, 17 do not, 11 differ only in formatting.

See `SOULVERCORE_FEATURE_AUDIT.md` for why the previous per-page audit was
unreliable, and the same reason this file avoids per-page status claims.

---

## Open, by area

Ordered roughly by size of the work rather than by row count. "Rows" are
entries in the spec's `GAPS` list.

| Area | Rows | What is missing | Shape of the work |
|---|---|---|---|
| Timespans | 2 | `03:04:05 + 01:02:03` laptime arithmetic, `12.5 minutes in minutes and seconds` | The converters and compound literals are done. What is left is arithmetic on `HH:MM:SS` literals, and a multi-unit output format. |
| Rates | 6 | `3 hours / day`, `$99 per week`, `$20/day + $300/week`, `$24 a day for a year`, `30 hours at $30/hour`, `$500 at $20/hour` | **Structural, and the naive fix is a trap.** Inserting the implied `1` (`/ day` -> `/ 1 day`) was tried and reverted: it makes `$50/week * 12 weeks` work but turns `3 hours / day` into 0.125, because same-measure units then cancel to a dimensionless number instead of forming a rate. A wrong answer where there had been an honest error. The real distinction is that a denominator with **no number** means a rate while `/ 3 days` means division, and that has to be decided where the numerator's measure is known, not by a token rewrite. Separately, `$20/day + $300/week` needs period unification, and `at` with a rate (multiply or divide depending on which side carries the rate) is its own parselet. |
| Units | 1 | `$30 * 4 days` | A money-times-duration case the unit system rejects outright ("Cannot combine incompatible units: USD and days"). Soulver reads it as $30 per day for four days. |
| Dates | 3 | `days in Q3`, `days in February 2020`, `week number on march 12, 2021` | Contained. The date literals now parse; what is missing is the surrounding "how long is this named period" grammar. |
| Clock | 3 | `16:00 + 3 hours 12 minutes`, `7:30 to 20:45`, `4pm to 3am` | Depends on the compound-duration literals above. |
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
| `90°` and `0.25 turns` as angle literals | Both are in the unit table and neither lexes as a unit, so nothing reaches the trig functions. A lexer gap, asserted as still-broken in `TrigAngleUnits.spec.ts` so fixing it surfaces there. |
| Soulver's abbreviated output (`300k`, `3.3M`) | The values are correct; only the rendering differs. Recorded in the spec's `FORMATTING_ONLY` list rather than treated as a capability gap, so aligning the formatter stays a deliberate decision. |
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
