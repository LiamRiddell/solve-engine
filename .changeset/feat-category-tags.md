---
"solve-engine": minor
---

Category tags: label lines with `#tag`, and total them across a note.

A running note often groups its numbers by hand, a shopping list or a set of expenses scattered down the page. A mid-line `#tag` labels a line's category and is dropped from that line's own result, and the aggregates gather every line carrying the tag, wherever they sit.

```
40 + 15 #grocery      55
petrol this week
30 #transport         30

12.50 #grocery        12.50
total of #grocery     67.50
```

`sum of` is a synonym for `total of`, and `average of` and `count of` read the same set:

```
average of #grocery   33.75
count of #grocery      2
```

The boundaries are deliberate. A tag that is a line's first token is a heading, not a tagged figure, so `#grocery list` at the top of a note is a title. The match is on the whole tag, so `#housing` does not gather `#housingcost`, and tag names are matched case-insensitively. Money and units carry through: a tag whose lines are all in dollars totals to dollars, while mixing units under one tag is a clear error rather than a silent figure. `total` and `average` need numbers, so a non-numeric tagged line under them is an error; `count` is about presence, "how many lines carry the tag", so it counts a non-numeric line too. No tagged lines at all is an error for `total` and `average`, and zero for `count`.

Like line references, these forms only work inside a document, since they read other lines. They return an error through the single-expression entry point, which has no document to gather from. Only one aggregate line per tag per note: an aggregate line carries the tag it sums, so a second would try to include the first, which is left out of scope rather than guessed at.

A tag name starts with a letter, which keeps it clear of the colour literals: `#grocery` is a tag, `#c0ffee` is a colour, and `#12a` (all hex) is a colour too. A `#` followed by a space is still an ordinary heading or comment. `total`, `sum`, `count` and `average` remain ordinary words everywhere else, read as the tag grammar only inside the whole `... of #tag` phrase, so a variable named `total` keeps working.

## Verification

- A regression spec (21 cases) covers the mid-line strip, the four aggregates across non-adjacent lines, money and mixed-unit handling, count-of-presence for a non-numeric line, the heading and prefix-collision boundaries, the empty and outside-a-document errors, `word of #tag` as prose, and the bounded lexer change. A separate unit spec (7 cases) pins the pure `#tag` scanner.
- 7,784 tests across 343 suites, no failures. `npm run verify` green.
