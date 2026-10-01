---
"solve-engine": patch
---

A range bound with its thousands grouped is read as one number inside a call: `sum(1,000:2,000)` is the sum of the whole numbers from 1,000 to 2,000, and `sum(1,000:1)` is refused as a range that counts down, where it answered 2

Inside a call's brackets a comma separates one argument from the next, so `max(1,000, 2)` is the largest of 1, 0 and 2. That rule split a grouped range bound too: `sum(1,000:1)` was read as `sum(1, 000:1)`, the element form of `sum` adding 1 once for each whole number from 0 to 1, and answered 2, a confident wrong number (found in testing). `sum(1,000:2,000)` was refused as the clock time `000:2`, and `map(x*2, 1,000:1,002)` as a call with too many arguments. A comma between digits straight against a range's colon is now read as grouping (`lexer/RangeBoundGrouping.ts`), since nobody writes a range as starting at `000` and a colon after three digits is never a clock time. The second bound is grouped when the first cannot be the hour of a time: three or more digits, a name or a bracket. A range bound written with grouped thousands is also shown as the plain number in a refusal, so `sum(1,000:1)` says "min (1000)" as `sum(1000:1)` does.

| line | before | now |
| --- | --- | --- |
| `sum(1,000:1)` | `2` | A range's min (1000) cannot be greater than its max (1). Did you mean "1:1000"? |
| `sum(1,000:2,000)` | "000:2" is not a valid time | `1,501,500` |
| `sum(1,000:1,005)` | "000:1" is not a valid time | `6,015` |
| `total(1,000:5)` | "000:5" is not a valid time | A range's min (1000) cannot be greater than its max (5). Did you mean "5:1000"? |
| `map(x*2, 1,000:1,002)` | Expected ")", but found "," | `[2,000, 2,002, 2,004]` |
| `prod(1,000:1,001)` | Expected ")", but found "," | `1,001,000` |
| `max(1,000, 2)` | `2` | `2` |
| `sum(1,000, 2)` | `3` | `3` |
| `sum(1, 100:200)` | `101` | `101` |

The boundary: a plain number in a call keeps the separator reading the currency page documents, so `max(1,000, 5)` is still 5 and `sum(1,000)` still 1; only a bound against a range's colon is grouped. That reading cannot tell `sum(1,100:200)`, the range from 1,100 down to 200 (now refused as counting down), from the element form adding 1 for each of 100 to 200; a space after the comma, `sum(1, 100:200)`, says two arguments and still answers 101. After a short first bound, `sum(1:2,000)`, the comma separates, because `1:2` could be a time. A space before the colon (`sum(1,000 : 1,002)`) is not grouped either. A list's comma always separates, and a German or French engine reads the comma as its decimal mark, so neither is affected.

## Verification

`FoundBug_groupedRangeBoundInACall.spec.ts` holds 32 tests: the lines that exposed it through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`, every form that takes a range (the element form, `prod`, `map`, `reduce`, a bound of millions, a long first bound), the separator reading where it stands (a plain argument, a space after the comma, a clock time before it, a top-level and a bracketed number); unit tests of `groupsRangeBoundInCall`, `groupsEnd`, `firstBoundBefore` and `digitsBefore` (ordinary, boundary, hostile: no comma, positions outside the text, empty text, a fullwidth comma, Arabic-Indic digits, a zero-width space, five thousand groups), of the lexer's tokens and of `isPlainNumber` with a grouped number; and the adversarial cases (prototype words as either bound with `Object.prototype` unchanged, a huge grouped range refused in time as the plain one is, two thousand groups, look-alike commas and digits and a direction override, every text edge after the line, a bound from the line above, a check, a name, a section, `as hex`, a spaced colon, a German engine, an edit, negatives and a leading zero group, bounds near 2^53, every numeric edge as either bound, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `sum(1,000:X)` and `sum(X:1,002)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the docs example specs, the hardening and integration specs, and the fast suite.
