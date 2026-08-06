# Parity backlog

What is left to reach parity with Soulver's documented syntax, and what is
deliberately not being attempted.

**This file is commentary. The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`,** which runs on every
build and fails in both directions: a regression in something that works, and
also a gap that starts working without being promoted out of its list. If this
file and that spec disagree, the spec is right.

As of 2026-08-06: **85 of 122** documented examples produce the documented
answer, 29 do not, 8 differ only in formatting.

See `SOULVERCORE_FEATURE_AUDIT.md` for why the previous per-page audit was
unreliable, and the same reason this file avoids per-page status claims.

---

## Open, by area

Ordered roughly by size of the work rather than by row count. "Rows" are
entries in the spec's `GAPS` list.

| Area | Rows | What is missing | Shape of the work |
|---|---|---|---|
| Timespans | 7 | `as timespan`, `as laptime`, `3h 5m 10s` compound literals, `03:04:05 + 01:02:03` laptime arithmetic, `12.5 minutes in minutes and seconds` | **Structural.** The converters do not exist at all; the audit credited them to `packages/time` where the only occurrence of "timespan" is a doc comment. Compound duration literals need lexer work, not a parselet. |
| Rates | 6 | `3 hours / day`, `$99 per week`, `$20/day + $300/week`, `$24 a day for a year`, `30 hours at $30/hour`, `$500 at $20/hour` | **Structural.** A bare unit in a denominator (`/ day` with no number) does not lex. Rate arithmetic across differing periods needs unification. |
| Units | 5 | `5 hours 30 minutes to seconds`, `meters in 10 km`, `days in 3 weeks`, `seconds in a day`, `$30 * 4 days` | Reversed conversion (`<unit> in <quantity>`) is a new grammar. Compound quantities share the timespan lexer work. `$30 * 4 days` is a money-times-duration case the unit system currently rejects. |
| Dates | 4 | `days in Q3`, `days in February 2020`, `week number on march 12, 2021`, `days between 3 March and 30 May` | Contained. Calendar queries over a named period. |
| Clock | 3 | `16:00 + 3 hours 12 minutes`, `7:30 to 20:45`, `4pm to 3am` | Depends on the compound-duration literals above. |
| Workdays | 2 | `day of the week on January 24, 1984`, `weekday on March 9, 2024` | Small, and worth noting: the audit marked these implemented. They never worked. |
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
