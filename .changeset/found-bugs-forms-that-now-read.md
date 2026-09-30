---
"solve-engine": patch
---

Six everyday lines that were refused or half-answered now read: two speeds add, `≈` holds a figure to the places it is written to, `check` compares two booleans, `subtract 3 from 10` is 7, a rate solved for is a percentage, and `price` is the reader's word under the OSRS example package

These were found by earlier adversarial batches. Adding, comparing and totalling read two quantities together only when their units shared a measure in the tables, and a speed has none, so `10 m/s + 36 km/h` was refused although `36 km/h in m/s` converts; the reader behind all three (`unifyUom`) now also reads the right side in the left's unit through the rate conversion `in` uses. `≈` with no `within` allowed only rounding noise, so a figure copied off a sign, `96.56 km/h` for 60 mph, never passed; it now also allows half a unit in the last place the right side is written to. `check` read its sides as numbers or text, so two booleans were "cannot be compared". `subtract` is the `-` keyword, so `subtract 3 from 10` read as `-3` and a stray `from 10`. Goal seek answered a rate the note holds as a percentage with the bare fraction. And the OSRS example package claimed `price` as a keyword, so `price * qty` was an OSRS item lookup under any engine that loaded it, the playground's among them.

| line | before | now |
| --- | --- | --- |
| `10 m/s + 36 km/h` | Cannot combine incompatible units: m/s and km/h | 20.00 m/s |
| `total of 10 m/s, 36 km/h` | refused the same way | 20.00 m/s |
| `check 60 mph ≈ 96.56 km/h` | check failed: 60.0000 mph is not equal to 96.5600 km/h | ✓ (differs by 0.000398 mph) |
| `check !(1 > 2) == true` | check: true and true cannot be compared | ✓ |
| `subtract 3 from 10` | Expected an operator or the end of the line, but found "from" | 7 |
| `solve line 3 for rate = 600`, rate 4% | 0.05 | 5.26% |
| `price * qty` under the OSRS package | Expected an OSRS item name after 'osrs', got "*" | Undefined variable: price |
| `price = 5`, `qty = 3`, `price * qty` under the OSRS package | the first and last lines refused | 5, 3, 15 |

For `price`, the package stops claiming the word rather than a reader's variable winning over a package keyword. A keyword is decided when a line is lexed, before any line has run, so the lexer cannot know which names a document will define; a variable winning would mean re-lexing a line whenever a name above it changes, for every word every package claims. `price` is also the word the package kit's own `notToShadow` check exists to catch, and it had already flagged this package. `osrs price of Iron Axe` and `osrs.price("Iron Axe")` still read, and a bare `price("Iron Axe")` is now the reader's name, so `ge("Iron Axe")` is the call form.

The boundary: two rates of different kinds (a speed and a flow of mass) still do not combine, and two prices per hour in different currencies are not converted at an exchange rate by an addition. The written-places margin applies only to a right side with decimal places, so `check 5.4 ≈ 5` still fails and `check 22/7 ≈ pi` is held to rounding noise. Booleans compare only with `==` and `!=`, and `true` is not the number 1. `subtract`, `take` and `remove` read `from` only at the top of the line, outside brackets; without one each is the minus sign it was. A range for a percentage unknown may be written in percentages (`between 0% and 10%`) or as fractions.

## Verification

`FoundBug_addingTwoSpeeds.spec.ts` (17 tests), `FoundBug_approximateCheckToWrittenPlaces.spec.ts` (19), `FoundBug_checkTwoBooleans.spec.ts` (14), the difference half of `FoundBug_subtractFromAndAngleTargets.spec.ts` (25 in all), `FoundBug_goalSeekLoanRefusals.spec.ts` (15) and `FoundBug_packageClaimsCommonWord.spec.ts` (9) hold the lines above, unit tests of `unifyUom`, `writtenDecimalPlaces`, `writtenPrecisionMargin`, `checkComparison`, `fromFollows`, `unknownUnitOf`, `inUnknownUnit`, `readGoalSeekRange` and the OSRS vocabulary with ordinary, boundary and hostile arguments, and the three adversarial sides: prototype words as units, names and unknowns, a sum of two thousand speeds, deep brackets, look-alike and markup-shaped text, values from the lines above with a check and a total through both document passes, and the numeric edges. The cross-path spec gains a percentage unknown through all three entry points. Four specs pinned the old answers and now pin the new ones: `Issue739_goalSeekBothSignsAndRange.spec.ts` and `GoalSeek.spec.ts` (the rate as a fraction), `OsrsPackage.spec.ts` (`price("Dragon Hide")` as an item) and `PackageTestKit.spec.ts` (the OSRS package flagged for `price`). The rates-and-speeds, conditionals, operators and goal-seek pages show the forms as proven examples.

These three changesets were verified together. The fast suite ran 23,542 tests in 720 suites: 23,537 passed, 4 skipped, and one page check failed on a fence left open on the goal-seek page, which was closed and its spec rerun green. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, and the proven documentation examples, the hardening and the integration suites all pass.
