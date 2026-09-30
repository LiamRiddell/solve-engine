---
"solve-engine": patch
---

The locales guide sets out which words each language pack reads, and its tables are proven against the engine

The engine takes `locale: "en" | "de" | "fr"` (or a region tag that reads as one), and nothing told a host that the three differ far more than in separators (#726). A language pack replaces the English keywords rather than adding to them, so a German engine reads `mal` and `von` and no longer reads `times`, `of`, `sqrt` or `round`, and a French engine has no word for `in` at all.

[Locales](/guide/locales/) gains a section, The words each pack reads, with a matrix of 32 lines across the three packs, what is read the same in every pack (units, currency codes, package phrases such as `half of` and `20% off`, symbols), and three gaps worth knowing before choosing a pack. The region-tag table is recast in the same shape. The page already covered the number formats, the date order and the output half; the decimal-comma paragraph now says that reading `2,5` is being changed (#740), since that change has not merged.

| line | `en` | `de` | `fr` |
| --- | --- | --- | --- |
| `3 mal 4` | refused | `12` | refused |
| `10% of 200` | `20` | refused | refused |
| `5 km in miles` | `3.11 miles` | `3.11 miles` | refused |
| `sqrt(16)` | `4` | refused | refused |
| `wurzel(16)` | refused | refused | refused |
| `half of 10` | `5` | `5` | `5` |
| `1.5 + 1` | `2.50` | refused | `2.50` |

The page's tables are proven by a spec of their own, since `DocExamples.spec.ts` runs every `solve` block on an English engine and its notepad takes no locale: each table whose first header is `Typed` is a matrix, each cell the answer an engine in that column's locale gives, and the one headed `Tag` is the output half. A change to what a pack reads turns the spec red until the page follows, which the tables already on the page had not had.

The boundary: a page over what ships. The German function names the pack lists (`wurzel`, `runden`, `aufrunden`, `abrunden`) are recognised and refused with `Unknown function`, the French pack cannot convert in words, and the German pack has no truth values or conditional; the page states each as it is. Rebuilding `de` and `fr` as packs that add to English is a later change, and the page is rewritten with it.

## Verification

`Issue726_localesPage.spec.ts` holds 208 tests: every cell of the page's four matrices and its output table (a French narrow no-break space read as the page's plain one), `getLocale` for the tags the region section names, the prototype words and a value that is not a string reading as English with `Object.prototype` unchanged, a hundred-thousand-character tag within budget, the German function names refused as unknown, and the adversarial cases (the text edges under each pack, a pack's keyword used as a variable name, a German document through both passes, digits from other scripts, and the largest safe whole number with German and English grouping).

The fast suite ran across 662 suites (19,327 of 19,332 tests passed, 4 skipped); its one failure was a spec still importing the snapshot's old `serializeValue` name, which was renamed in it and passes on a rerun. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, as did the proven docs examples and the hardening and integration suites. `npm run verify` and the bundled-consumer contract were not run for this change.
