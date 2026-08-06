---
"solve-engine": patch
---

`average of 36, 42, 19 and 81` returned 59.33. It now returns 44.5.

The word "and" is a synonym for `+` in this engine ("5 and 3" is 8), and that was implemented by mapping the word onto the PLUS token in the locale keyword table. Every phrase that uses "and" to separate a list therefore parsed its last two items as one sum: the line above read as three arguments, the last being 19 + 81, and divided 178 by 3. `median of 10, 20 and 30` answered 30 rather than 20 for the same reason.

`total of 3, 4, 7 and 9` was the example the original tests used, and it hid the bug perfectly, because summing four numbers and summing three numbers where two have been pre-added give the same total.

The word now has its own token type. It still compiles to an addition, so "5 and 3" is unchanged and "true and false" still reads as boolean conjunction, but it binds one step looser than `+`, so a phrase parselet can parse an argument and stop at it.

That also removes a workaround. Parselets taking "X and Y" operands had to parse X at multiplication precedence to stop "and" swallowing "and Y", which stopped a genuine `+` too, so `midpoint between 100 + 50 and 300` could not be written. It parses now.
