---
"solve-engine": patch
---

Units written in more than one word are read as the unit they name

The lexer reads a unit as one run of letters, so a unit spelled in two or three words arrived as separate words, and where the first word was not a unit on its own the spelling failed. `5 km in nautical miles` said the two did not measure the same thing, `5 nautical miles` and `5 cubic metres` were undefined variables, and `5 square feet` did not parse. The multi-word unit rule now reads every spelling the unit table carries with a space or a hyphen, after an amount or after the conversion word.

| expression | before | now |
| --- | --- | --- |
| `5 km in nautical miles` | error: cannot convert km to nautical | 2.70 nautical miles |
| `1 nautical mile in km` | error: undefined variable nautical | 1.85 km |
| `5 cubic metres in litres` | error: undefined variable cubic | 5,000.00 litres |
| `3 imperial gallons in litres` | error: undefined variable imperial | 13.64 litres |
| `2 troy ounces in g` | error: undefined variable troy | 62.21 g |

The spellings come from the unit table and nothing is invented, so the words must be separated the way the table writes them: one space, or a hyphen in `light-years`. The one allowance is a plural. The table mirrors its upstream, where a few entries (`troy ounce`, `watt-hour`, `foot-candle`) have no plural beside them, and the plural a reader writes reads as that unit. A symbol takes no plural: `kW h` is the kilowatt-hour and `kW hs` is not a unit.

The boundary: a spelling the table does not carry is not guessed at. `light year` with a space is not a spelling there (`light-year` is), so it stays unread rather than being matched to the nearest entry.

Fixes #548.
