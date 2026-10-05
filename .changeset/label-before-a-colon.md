---
"solve-engine": patch
---

Text before a colon is read as a label only when it is a name: `1 + 24:00` and `1:23:99` are refused as times that do not exist, `true ? 25 : 30` is refused with the line spelled as `if true then 25 else 30`, and `a > b: 1` is refused as a comparison, where each used to answer with the figure after the colon

A line that does not parse whole is retried as `<label>: <expression>`, the way `Rent: $1200` and `Week 12: 75` are read (found bug, no issue). That retry took any text at all as the label, so a colon that belonged to something else made the text before it vanish: `1 + 24` became the label of `1 + 24:00`, which answered 0, the clock time `1:23` became the label of `1:23:99`, which answered 99, and `true ? 25` became the label of `true ? 25 : 30`, which answered 30. Each was a confident wrong number, and one in a column fed straight into its total. The text before the colon is now judged first, in `engine/ColonLabel.ts`: a number pair that starts the line or follows an operator is a time, a `?` with text after it is a choice, a comparison symbol makes a condition, and a calculation with no word names nothing. Each is refused by name, with two new codes, `TERNARY_UNSUPPORTED` and `LABEL_NOT_A_NAME`.

| line | before | now |
| --- | --- | --- |
| `1 + 24:00` | `0` | `"24:00" is not a valid time` |
| `9:30 + 24:00` | `0` | `"24:00" is not a valid time` |
| `1:23:99` | `99` | `"1:23:99" is not a valid time` |
| `1:23:99 + 1` | `100` | `"1:23:99" is not a valid time` |
| `true ? 25 : 30` | `30` | `There is no choice written with "?" and ":": write if true then 25 else 30` |
| `a > b ? 1 : 2` | `Expected an operator or the end of the line, but found "?"` | `There is no choice written with "?" and ":": write if a > b then 1 else 2` |
| `a > b: 1` | `1` | `"a > b" before the colon is a comparison, not a label: ...` |
| `(1+2): 5` | `5` | `"(1+2)" before the colon is a calculation, not a label: ...` |
| `Week 12: 75` | `75` | `75` (unchanged) |
| `Food + drink: $40` | `$40.00` | `$40.00` (unchanged) |
| `Orders over $100: 12` | `12` | `12` (unchanged) |

The boundary: arithmetic between words stays a label (`Food + drink`, `Year-end`, `Q1/Q2`), since that is how ledgers name things and the figure after the colon is the one the reader wrote. A number after a word is part of a name (`Week 12:75` still answers 75), a question mark that ends the label (`Done?: 5`) is part of it, and a comparison written in words (`over`) is prose. `Net = gross: 5` is untouched: it is a definition whose right-hand side is the labelled figure. A pair with a space after the colon whose number follows a name (`Item 2: 45`) is a label too, even when the pair is also a valid time; that has its own entry.

## Verification

`FoundBug_labelBeforeAColon.spec.ts` holds 26 tests: each line through `evaluateExpression`, the single-line `evaluateLine`, `parseDocument` and `evaluateDocument`, with the two document passes agreeing; every documented label form still answering its figure; unit tests of `timeAtColon`, `colonLabelFault`, `labelSubject`, `ternaryFault`, `ternaryAtQuestion`, `conditionStart`, `ternaryMessage`, `textOf`, `tokenEnd` and `quoted` with ordinary, boundary and hostile arguments; and adversarial cases from the kit (prototype words as the label and the condition, a 2,000-term label, deep brackets, a huge range, look-alike digits, a zero-width space, a fullwidth colon, a direction override, markup, a time from the line above, a tag total, a check, a line reference, a section with a total under the refused line, the numeric edges, CRLF and a blank line). The adversarial sweep has the new templates, the error-code catalogue and reachability spec have the two codes, and the labels, time and conditionals pages have proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`; the docs examples; and the fast suite (835 suites, 32,185 tests passing). `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
