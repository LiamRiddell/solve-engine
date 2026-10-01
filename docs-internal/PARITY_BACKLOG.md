# Parity backlog

What is left to reach parity with Soulver's documented syntax, and what is
deliberately not being attempted.

**This file is commentary. The measured state lives in
`packages/engine/__tests__/docs/SoulverParity.spec.ts`,** which runs on every
build and fails in both directions: a regression in something that works, and
also a gap that starts working without being promoted out of its list. If this
file and that spec disagree, the spec is right.

Measured: **<!-- parity:soulver.supported -->104<!-- /parity --> of
<!-- parity:soulver.total -->121<!-- /parity -->** documented examples produce the
documented answer, <!-- parity:soulver.gaps -->0<!-- /parity --> do not, and
<!-- parity:soulver.formattingOnly -->17<!-- /parity --> differ only in
formatting. The figures are written by `npm run stats:parity` (into
`docs-internal/parity-stats.json` and this page), and the spec fails when either
states one it did not measure, so they cannot drift the way the typed ones did
(#786).

The two CPI rows (`what is $4.2k from 2003`, `what was $500 worth in 1997`) are
no longer in the corpus. They are year-dependent, in the same way as the
future-projection row removed earlier: Soulver's documented figures were
computed when "today" was 2024, so they are not reproducible from a fixed string
however accurate the table becomes. The table is now generated from the BLS
series CUUR0000SA0 back to 1913 by `npm run data:cpi` (#700), and checked
against the BLS published annual averages by `CpiTableAccuracy.spec.ts`.

See `SOULVERCORE_FEATURE_AUDIT.md` for why the previous per-page audit was
unreliable, and the same reason this file avoids per-page status claims.

---

## Open, by area

None. The spec's `GAPS` list is empty; every area that had rows there has been
closed, and the two inflation rows left the corpus as year-dependent (above).

## Currencies

Tracked separately because it is a correctness bug rather than a missing
feature, and because it is not in the parity corpus (Soulver's currency
examples need live rates).

| Issue | Status |
|---|---|
| `$100 in UAH` silently returned the original amount, unconverted | Fixed |
| `CurrencyExchange.isCurrency()` was a hardcoded 46-code allowlist | Fixed: answers from the ISO 4217 active set, whole set asserted |
| An unrecognised target fails **silently** rather than erroring | Fixed: `$100 in XYZ` is `"XYZ" is not a unit.`, and `100 USD in ABC` adds `Did you mean ac?` |

The silent failure was the real defect: returning the input unchanged made
`$100 in UAH` read as though a conversion happened at a rate of 1. A code the
engine does not know now says so, and a known code with no rate says that
instead (with live data off, `$100 in UAH` answers that live data is switched
off for this engine).

## Not being attempted, with reasons

| Item | Why not |
|---|---|
| CPI table accuracy (~10% off Soulver) | **Resolved by #700.** The table is generated from BLS series CUUR0000SA0, 1913 to the current year, by `scripts/build-cpi-table.mjs` (from the BLS API, or the Frictionless Data mirror recorded in `scripts/fixtures/cpi/cpiai.csv`). The Soulver rows stay out of the corpus because they read the current year, not because of the table. |
| `0.25 turns` as an angle literal | `turn`/`turns` are **deliberately excluded** in `lexer/units.ts`: "ordinary English, against a full-rotation angle unit". Admitting them would make the word "turns" in a sentence become a quantity. The unit stays reachable as gradians, and the exclusion is now asserted rather than merely commented. `90°` is fixed. |
| Soulver's abbreviated output (`300k`, `3.3M`) | The values are correct; only the rendering differs. Not a bug fix but a formatting **default**: switching it on changes how every large number in every document renders, including ones with no relation to this work. It belongs in `FormattingSettings` as an opt-in (`abbreviateLargeNumbers`), decided deliberately rather than acquired as a side effect of a parity pass. Recorded in the spec's `FORMATTING_ONLY` list meanwhile, so the difference stays visible. Since #515 a line can ask for it with `as compact` (`3 million + 10% as compact` is `3.3M`), a per-line opt-in that leaves the default rendering alone; a global setting is still undecided. |

## Other apps

The other calculator-notepad apps have their own spec,
`packages/engine/__tests__/docs/OtherAppsParity.spec.ts`, in the same shape:
<!-- parity:otherApps.supported -->8<!-- /parity --> of
<!-- parity:otherApps.total -->11<!-- /parity --> documented examples produce the
documented answer, <!-- parity:otherApps.gaps -->2<!-- /parity --> do not (the
CSS pixel conversions, engine limitation 3 in `OTHER_APPS_FEATURE_AUDIT.md`), and
<!-- parity:otherApps.declined -->1<!-- /parity --> is declined with its reason
(bare `x` as multiplication).

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
