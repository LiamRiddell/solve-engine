# Parity backlog

What is left to reach parity with Soulver's documented syntax, and what is
deliberately not being attempted.

**This file is commentary. The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`,** which runs on every
build and fails in both directions: a regression in something that works, and
also a gap that starts working without being promoted out of its list. If this
file and that spec disagree, the spec is right.

As of 2026-08-06: **101 of 122** documented examples produce the documented
answer, 5 do not, 16 differ only in formatting.

See `SOULVERCORE_FEATURE_AUDIT.md` for why the previous per-page audit was
unreliable, and the same reason this file avoids per-page status claims.

---

## Open, by area

Ordered roughly by size of the work rather than by row count. "Rows" are
entries in the spec's `GAPS` list.

| Area | Rows | What is missing | Shape of the work |
|---|---|---|---|
| Rates | 3 | `30 bottles / week`, `30 hours at $30/hour`, `$500 at $20/hour` | Bare denominators and cross-period addition are done. **`at` with a rate was tried and reverted**: registering an infix on `at` broke every mortgage and investment expression, because the finance grammar parses its own rate with the same word (`over 6 years at 6%`) and the infix took the token first. It needs a trigger that cannot collide, or the finance parselets need to claim theirs earlier. `30 bottles / week` needs an unrecognised word after a number to be a countable label rather than a variable, which is a lexer question. Both fail loudly. |
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
| CPI table accuracy (~10% off Soulver) | Needs a real series rather than invented numbers. **Planned for a separate PR** using statisticsoftheworld.com (free, no key, 1,000 requests a day), fetched through the existing `createQueryResolver` caching so the quota is not a constraint. Until then the bundled table stays labelled approximate, because more precise-looking numbers without a source would remove the one signal that they are not authoritative. |
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
