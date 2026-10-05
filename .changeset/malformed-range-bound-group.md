---
"solve-engine": patch
---

A number in a call written like a grouped range bound whose group is not three digits is refused by name: `sum(1,0000:1)` says a grouping comma needs exactly three digits after it, where it answered 2

A comma between digits straight against a range's colon is read as a thousands group (`sum(1,000:2,000)`), but only when exactly three digits follow it, so any other group fell back to the argument reading. `sum(1,0000:1)` was read as `sum(1, 0000:1)`, the element form adding 1 once for each of 0 and 1, and answered 2, a confident wrong number (found in testing). The reader wrote the number the way a grouped bound is written, with no space after the comma, and read either way the answer would be a guess. The lexer now refuses that shape with `RANGE_BOUND_GROUP_MALFORMED` (`malformedRangeBoundGroupEnd` in `lexer/RangeBoundGrouping.ts`), and the message says how to write two values: put a space after the comma.

| line | before | now |
| --- | --- | --- |
| `sum(1,0000:1)` | `2` | "1,0000" is not a number: a grouping comma needs exactly three digits after it. To give two values, put a space after the comma: 1, 0000. |
| `sum(1,00:1)` | `2` | "1,00" is not a number: a grouping comma needs exactly three digits after it. To give two values, put a space after the comma: 1, 00. |
| `sum(12,3456:1)` | A range's min (3456) cannot be greater than its max (1). Did you mean "1:3456"? | "12,3456" is not a number: a grouping comma needs exactly three digits after it. To give two values, put a space after the comma: 12, 3456. |
| `sum(1,000,00:1)` | A date or time cannot be added: only numbers and quantities can. | "1,000,00" is not a number: a grouping comma needs exactly three digits after it. To give two values, put a space after the comma: 1,000, 00. |
| `sum(1, 0000:1)` | `2` | `2` |
| `sum(1,000:1,002)` | `3,003` | `3,003` |

The boundary: the refusal covers a run of two digits, or of four or more, straight against the colon, after a leading group of one to three digits. A single digit (`sum(1,1:3)`, 3) keeps the separator reading, since nobody groups with one digit, and so do two digits followed by exactly two after the colon (`sum(1,12:30)`, `max(9:00,17:30)`), which may be a clock time. A space after the comma always means two values. A list's comma always separates, and a German or French engine reads the comma as its decimal mark, so neither is affected. A malformed second bound (`sum(100:1,0000)`) is not weighed, since its comma is not against the colon.

## Verification

`FoundBug_malformedRangeBoundGroup.spec.ts` holds 25 tests: the lines that exposed it through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`, the spaced reading, a whole group of three, every call that takes a range (`total`, `average`, `map`, the element form); unit tests of `malformedRangeBoundGroupEnd` (ordinary; boundary: a whole group, one digit, a clock time's shape, a space, a long lead, no colon, the second half of a time or a decimal; hostile: positions outside the text, empty text, a fullwidth comma and colon, Arabic-Indic digits, a zero-width space, a run of a hundred thousand digits) and of the lexer's tokens; and the adversarial cases (prototype words as the other bound with `Object.prototype` unchanged, huge malformed groups refused in time, look-alike characters, every text edge, a label, a check, a name and a section, the typo and its fix as an edit, a German engine, clock times after an unspaced comma, zero, negatives, near 2^53 and past the decimal digit limit, every numeric edge, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `sum(1,0000:X)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the docs example specs, `NormaliserRulesRejectCheaply`, `LexerFuzz`, the hardening and integration specs, and the fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
