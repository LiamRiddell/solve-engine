---
"solve-engine": minor
---

The shape of a screen, the other side of a resize, and a root font size that is not 16px.

`px in rem` already converted both ways, treating one `rem` as the CSS default of 16px. Three things that default cannot answer are new.

| expression | result |
| --- | --- |
| `1920x1080 as ratio` | `16:9` |
| `1024x768 as ratio` | `4:3` |
| `resize 4000x3000 to 1200 wide` | `1200 x 900` |
| `resize 4000x3000 to 900 tall` | `1200 x 900` |
| `1.5rem at 20px base` | `30.00 px` |
| `24px at 20px base` | `1.20 rem` |

A pair may be written with or without the spaces (`1920 x 1080`), `in` reads the same as `as`, and each side of a resize has the words a person actually types: `width` and `across` read as `wide`, `height` and `high` as `tall`. The `at <n>px base` form converts to the other unit, so it reads both ways round, and it binds to the size beside it: `2rem + 8px at 20px base` is `2.40 rem`.

The other side of a resize is rounded to a whole pixel, because that is what an image file holds: `resize 1000x333 to 500 wide` is `500 x 167`, not `500 x 166.5`.

The boundary is what these forms refuse to claim. `1920x1080` on its own is still 1920 times a variable called `x1080`, `3x4` still means what it did, `resize` is still an ordinary word in `:resize = 2`, and `at` is still the rate operator in `30 hours at $30/hour`. Each form is read only when its whole shape is there: a pair after `resize` or before `as ratio`, and a base with the closing word `base` behind it. A rule that claimed every `<number>x<number>` or every `at` would quietly change what existing lines mean.

`em` is still deliberately not converted. What an `em` is worth depends on the element it sits in, so no single number is right for it.
