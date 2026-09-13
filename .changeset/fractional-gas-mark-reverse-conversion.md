---
"solve-engine": patch
---

A fractional gas mark reads as the dial setting it is, not a division of the whole mark beside it

A gas oven's two slowest settings are written on the dial as the fractions `1/4`
and `1/2`, and a recipe writes them the same way. Read forwards they were right,
`110C in gas mark` is `gas 1/4`, but read the other way `gas 1/4` answered 35°C
where it should stand for 110°C. The setting parselet took only the whole number
beside `gas` and left the `/4` as an ordinary division applied to the result:
`gas 1` is 140°C, and 140 / 4 is 35. So the round trip did not close, and both
of the fractional marks a recipe reaches for were wrong.

| expression     | before    | now        |
| ---            | ---       | ---        |
| `gas 1/4 in C` | `35.00 C` | `110.00 C` |
| `gas 1/2 in C` | `70.00 C` | `120.00 C` |

A fraction written on the setting is now folded into it and handed on as the
single value it draws, so the lookup sees 0.25 and answers 110°C, the same table
the forward direction reads. The whole marks were always right and are unchanged:
`gas 4 in C` is still 180°C, and `gas 6 + 10` is still ten degrees above gas 6
rather than gas 16, because only a fraction reaches past the number.

The boundary is what counts as a dial fraction. Only a proper fraction, numerator
below denominator, is one, the same test the mixed-number rule applies to
`2 3/2`. So `gas 3/4` folds to 0.75 and is refused, because 3/4 is not a mark on
this dial (it has only `1/4` and `1/2`), where before it quietly answered 42.5°C;
and an improper `gas 6/2` is no fractional setting at all and keeps the ordinary
division it reads as, 100°C, unchanged.

## Verification

The full suite is green (9,474 tests across 483 suites), with new cooking cases
that pin both fractional settings converting to 110°C and 120°C, the gas-mark
table round-tripping value for value in both directions across the fractional and
whole marks, the `gas 3/4` refusal, and the improper `gas 6/2` staying the
division it was. A proven docs example on the cooking page now shows the reverse
fractional conversion, so it cannot drift from the engine again. The type check,
the linters, the build and the bundled-consumer contract are green, the gates
`npm run verify:ci` runs for the release.
