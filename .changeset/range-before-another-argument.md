---
"solve-engine": patch
---

A range written before another argument is refused as a range: `sum(100:200, 50)` says a range is read only as the last argument and gives `sum(100:200) + 50`, where it was refused as the time "100:200"

A colon between two numbers is a range only as the list `sum`, `total`, `prod`, `map` and `reduce` work through, their last argument; the first of several is the expression worked out for each element, where a colon pair is a clock time. So a range followed by more values is not a form, as the map-reduce page says, and `sum(100:200,50)` was refused as '"100:200" is not a valid time', an answer to a question the reader never asked (found in testing). A whole-number pair in a range's shape, written as the first of several arguments to one of those calls, is now refused by name as a range in the wrong place (`RANGE_BEFORE_ANOTHER_ARGUMENT`, from `rangeBeforeLaterArgument` in `normalizer/RangeArgumentOrder.ts`), with the call that answers.

| line | before | now |
| --- | --- | --- |
| `sum(100:200,50)` | "100:200" is not a valid time | In sum(...), 100:200 is a range, and a range is read only as the last argument, the list sum works through. To add other numbers in as well, write them outside the call: sum(100:200) + 50. |
| `prod(100:200, 50)` | "100:200" is not a valid time | In prod(...), 100:200 is a range, ... write them outside the call: prod(100:200) * 50. |
| `map(100:200, 5)` | "100:200" is not a valid time | In map(...), 100:200 is a range, ... Write the expression first and the range last, as in map(x * 2, 100:200). |
| `sum(100:200) + 50` | `15,200` | `15,200` |
| `sum(10:12, 5)` | A date or time cannot be added: only numbers and quantities can. | A date or time cannot be added: only numbers and quantities can. |
| `sum(24:30, 1)` | "24:30" is not a valid time | "24:30" is not a valid time |

The boundary: only a pair that can only be a range is taken, two whole numbers counting up and not in a clock's shape (up to two digits, a colon and two digits), so `sum(24:30, 1)`, `sum(9:60, 1)` and `sum(24:00, 1)` are still refused as the times they look like, a real time such as `sum(10:12, 5)` is still a time, and a decimal (`sum(1.5:3, 2)`) is still refused as a time. A bound that is a name (`sum(a:200, 50)`) is no pair of numbers for the rule to read, and keeps the parser's wording.

## Verification

`FoundBug_rangeBeforeAnotherArgument.spec.ts` holds 21 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine`, the other calls a range is the list of, the call the refusal names answering, both document passes agreeing, times and clock-shaped pairs still times; unit tests of `isRangeShapedPair` (ordinary; boundary: a clock's shape, equal bounds, zero; hostile: decimals, signs, other scripts, empty and seventeen-digit text), `rangeCallWord`, `restOfCall` and `rangeBeforeLaterArgument` (several later arguments, none, an empty one, a call left open, a pair not first, nested brackets, a rest too long to quote, thirty thousand open brackets); and the adversarial cases (prototype words as a later argument and as the call with `Object.prototype` unchanged, a long rest, two thousand arguments and deep brackets in time, markup-shaped and look-alike arguments, a bound from the line above, a check and a section, a label before the call, zero, equal bounds, a grouped bound, the largest whole numbers, every numeric edge, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `sum(100:200, X)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the map-reduce and time specs, the hardening and integration specs, and the whole fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
