---
"solve-engine": minor
---

An image's print size can be worked out at a stated density, `4000px at 300 dpi` is 13.33 in, and the typographic point is spelled `typographic point`

Pixels are kept apart from physical length on purpose, since a CSS pixel is a reference pixel, and nothing stated a density, so the print-size question had no form: `4000px at 300 dpi in inches` was a parse error. The typographic point, the unit type is sized in, had no spelling after a number either: `pt` is the pint, and `point` and `points` are excluded as ordinary English, so `12 pt in mm` was refused as a volume (#749).

| line | before | now |
| --- | --- | --- |
| `4000px at 300 dpi` | throws `Unexpected token after expression: "at"` | 13.33 in |
| `4000px at 300 dpi in mm` | throws `Unexpected token after expression: "at"` | 338.67 mm |
| `8 in at 300 dpi` | throws `Unexpected token after expression: "at"` | 2,400.00 px |
| `210 mm at 300 dpi` | throws `Unexpected token after expression: "at"` | 2,480.31 px |
| `12 typographic points in mm` | throws `Unexpected token after expression: "points"` | 4.23 mm |
| `1 inch in typographic points` | throws `Unexpected token after expression: "points"` | 72.00 typographic points |

`at <n> dpi` (or `ppi`, in either case) is a web-package suffix like `at 20px base`: pixels, or a `rem` through its 16 pixels, divide by the density into inches, and a physical length multiplies into pixels, so a conversion after it reads the answer in any length. It binds to the size beside it, so a sum is bracketed first. A density of zero, below zero or too large to be finite is refused by name, as is a size that is neither pixels nor a length, and a name in the density's place (`at d dpi`) asks for a number. `8 in at 300 dpi` reads `in` as the inch, since nothing converts into a density. `typographic point` and `typographic points` are an exact 72nd of an inch, joined by the multi-word unit rule. The note on the lexer's `point` exclusion, which said the point was reachable through `pica`, is corrected: a pica is twelve points.

The boundary: only a density written on the line converts. A screen's own density, a device pixel ratio or a phone's pixels per inch, is not known and not guessed, and pixels still do not convert to a length without one (`96 px in inches` is refused as before). `pt` stays the pint and `point` stays prose (`scored 12 points` is not a length); `points` is still a conversion target. `dpi` stays an ordinary name, and `at` keeps its rate, timecode and finance meanings, since the phrase is read only with a number and `dpi` or `ppi` after it. The table's own `point`, a conversion target, keeps upstream's rounded 0.3528 mm.

## Verification

`Issue749_pixelDensityAndTypographicPoint.spec.ts` holds 65 tests: both directions and `ppi`, the refusals, the other meanings of `at` (`30 hours at $30/hour`, `01:02:03:04 at 30 fps`, `at 20px base`, drive time, a finance rate, `12 in in cm`), `dpi` as a name, the typographic point and what must not break (`pt`, `points`, prose); unit tests of `isUsableDensity`, `atPixelDensity`, `isDensityWord`, `densityPhraseAt`, the density normaliser rule and the inch rule's new case (ordinary, boundary and hostile arguments, prototype words among them); and adversarial cases (prototype words in each slot, text edges, full-width digits, markup, a thousand densities in one sum, a size from the line above with a check and a what-if, the numeric edges as size and as density, CRLF). `AdversarialFeatureSweep.spec.ts` gains the density and point forms.

The fast suite (the `npm run test:ci` run) passed, 15,949 of 15,953 tests in 617 suites with 4 skipped, and the suites it leaves out passed on their own under the full configuration: `LexerFuzz`, `LexerVocabularyFuzz`, `LongDocumentRobustness` and `heavy/MemoryLeak`. `npm run typecheck`, `lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` are clean, and the proven docs examples pass. `lint:units` was not run, since it reads the built package; the generated unit reference needs regenerating for the new spellings.
