---
"solve-engine": minor
---

A label is read without its colon when an amount of money or a quantity ends the line, and a line that is only `sum` or `total` totals the block above it

The commonest shape of a budget note is a label and an amount on each line with a total underneath, typed the way other notepads read it. The engine read a label only before a colon, and `sum` or `total` on its own was an undefined variable, so a note typed that way answered nothing and a `total above` under it reported the line above as an error (#742).

| line | before | now |
| --- | --- | --- |
| `Rent $1200` | throws `Expected an operator or the end of the line, but found "$"` | $1,200.00 |
| `Flight to Paris $450` | throws `Expected an operator or the end of the line, but found "$"` | $450.00 |
| `Petrol 40 l` | throws `Expected an operator or the end of the line, but found "40"` | 40.00 l |
| `sum`, under `Rent $1200` and `Food $300` | `Undefined variable: sum. To add up the lines above, write "total above".` | $1,500.00 |
| `total`, under `total = 100` | 100 | 100 |
| `take home $500` | throws `Expected an operator or the end of the line, but found "$"` | $500.00 |

The label: a run of words followed by one amount, a currency symbol and a number (`$1,200`) or a number and a unit (`45 EUR`, `40 l`), that ends the line. It is tried only after the whole line and every colon label have failed to parse, so no line that answered before answers differently. A word the engine also reads may sit inside the label (`Flight to Paris`), since it is the amount at the end that makes the line a label.

The lone total: a line that is only `sum` or `total`, or only that after a label (`Subtotal: sum`), is `total above`. It walks the block the same way, stops at a blank line or a heading, and is a summary the next total passes over. A note that defines a variable of that name gets the variable, decided as the line runs, so adding or removing the definition reaches the line. Outside a document it is refused by name, as `total above` is.

The boundary, which is what keeps prose from answering: a bare number after words is not taken, because `Groceries 45` cannot be told from `Chapter 12`, `Room 4` or `Page 3` (write `Groceries: 45`); nor is an amount with anything after it (`I walked 5 km to the shop`), nor a label whose last word only leads into the amount (`Back in 5 min`, `Call me at 3 pm`, `Remember the $5`). A line that parses and fails as it runs is not a candidate either, so `Refund -$50` is still the subtraction `Refund - $50`; write the colon for a negative amount. Inside an expression `sum` and `total` are names as before, so `sum * 2` still points at `total above`. A line of words ending in an amount is read as a label wherever it stands, a sentence such as `I paid $5` included, since that is the ledger's own shape. The new labels page lists all of this; the trigger-words and line-references pages say which lines now answer. Two existing specs pinned the old answers and were updated: `Issue668_ansAndBareTotals.spec.ts` (a lone `sum` is now the total, and the pointer to `total above` is tested inside an expression) and `Issue693_707_currencyAsWritten.spec.ts` (a prototype word touching a dollar, `constructor$100`, is now a label and the plain dollar; what the test guards, that the word never names a country's dollar, still holds).

## Verification

`Issue742_wordLabelsAndBareTotal.spec.ts` holds 151 tests: each label form and its colon twin, a budget typed without colons, a list marker, a tag and a comment around a label, a label that is also a variable, nineteen sentences that must stay non-answers, a lone total in both document passes (after a label, as a subtotal, at a boundary, over mixed measures, beside a variable of its name, after an edit in a live editor), and unit tests of `wordLabelEnd`, `isLabelWord`, `isAmount`, `isColumnTotal`, the normaliser rule, `columnTotalHandler` and `isSummaryLine`. The adversarial cases cover the numeric edges in a money and a quantity label, the text edges inside a label, prototype words as labels and before a lone total, digits from other scripts, direction overrides, markup, a 5,000-word line, a thousand labelled lines, the document edges under a lone `sum`, CRLF and a trailing newline. `CrossPathDocumentFeatures.spec.ts` gains the three-path shape and `AdversarialFeatureSweep.spec.ts` the templates. The gates run are listed in the multi-word names changeset, which shipped in the same change.
