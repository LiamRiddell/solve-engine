---
"solve-engine": patch
---

A label whose name ends on a number answers its figure when the number and the figure would also make a clock time: `Item 2: 45` is 45, `Room 4: 12` is 12 and `Weeks 1-2: 40` is 40, where each was refused with the parser's `found "2:45"`

The time rules join a number, a colon and a number into one literal (`9:30`, `1:23:45`, `5:30/km`), and they did so whenever the pair made a valid time, whatever stood before it (found bug, no issue). In `Item 2: 45` that took the label's own number, so the line held the word `Item` beside the time 2:45 and was refused, while `Week 12: 75` answered 75 only because 12:75 is no time. A colon now belongs to a label when two things hold together: a space follows it, as in prose (a time's colon touches its minutes), and a name stands before the number, with only a name's numbers and joining marks (`-`, `/`) between. The rule lives in `packages/time/normalizer/LabelColon.ts`, and the clock-time, lap-time, timecode and pace rules each consult it.

| line | before | now |
| --- | --- | --- |
| `Item 2: 45` | `Expected an operator or the end of the line, but found "2:45"` | `45` |
| `Room 4: 12` | `Expected an operator or the end of the line, but found "4:12"` | `12` |
| `Week 12: 30` | `Expected an operator or the end of the line, but found "12:30"` | `30` |
| `Weeks 1-2: 40` | `Expected an operator or the end of the line, but found "1"` | `40` |
| `Day 1: 9:30` | `Expected an operator or the end of the line, but found "1:9:30"` | `9:30:00 AM` |
| `Item 2: 4 pm` | `Expected an operator or the end of the line, but found "2:4pm"` | `4:00:00 PM` |
| `9: 30` | `9:30:00 AM` | `9:30:00 AM` (unchanged) |
| `x = 5: 6` | `5:06:00 AM` | `5:06:00 AM` (unchanged) |
| `Week 12: 75` | `75` | `75` (unchanged) |

The boundary: a spaced pair with no name before it is still a time, since nothing is being named. No documented time is written with a space after its colon, so `9: 30`, `x = 5: 6` and `2*3: 4` read as they did. A word that leads into a time (`at`, `before`, `until`, `the`) is no name, so `before 9: 30` keeps its time. And a colon that touches both numbers is a time whatever stands before it: `Item 2:45` is still refused, as the word `Item` beside the time 2:45, since nothing in that spelling says the colon is a label's.

## Verification

`FoundBug_labelColonBeforeAClockTime.spec.ts` holds 17 tests: each line through `evaluateExpression`, the single-line `evaluateLine`, `parseDocument` and `evaluateDocument`, with the two document passes agreeing and a column of such labels adding up; the boundary forms that read as before (`x = 5: 6`, `2*3: 4`, `-1: 2`, the ternary refusal); unit tests of `spaceAfterColon`, `numberFollowsName` and `isLabelColon`, and of the clock-time, lap-time, timecode and pace rules called directly, with ordinary, boundary and hostile arguments; and adversarial cases from the kit (prototype words as the name, a 2,000-label line, a 5,000-number name, a 2,000-line document, a fullwidth colon, a zero-width space, digits from another script, a direction override, markup, the text and numeric edges, a figure from the line above, a typo, a tag total, a check, a section, an edit, CRLF and a blank line). The adversarial sweep has the new templates, and the labels and time pages have proven examples. The `NormaliserRulesRejectCheaply` oracle for `time:clock-time` needed no exemption: no recorded stream holds a name, a number and a spaced colon pair.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:dispatch-size` (the dispatch loop at 46,202 bytecode bytes, under its margin); the docs examples, the `NormaliserRulesRejectCheaply` oracle and the operand-width spec; and the fast suite (837 suites, 32,395 tests passing). `npm run verify` and the bundled-consumer contract were not run.
