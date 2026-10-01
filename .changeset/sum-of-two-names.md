---
"solve-engine": patch
---

`sum(a, b)` of two values on the lines above adds them, as `total(a, b)` does, instead of refusing `b` as no list

A two-argument `sum` whose first argument was a bare name was read as map-reduce's `sum(<element>, <list>)`, so `sum(a, b)` with a single value in `b` was refused with `MAP_REDUCE_REQUIRES_COLLECTION`, whose hint ("to add values one by one, list them, as in sum(5, 6)") described what the reader had already done (found bug, no issue). The element is worked out for each item with `x` standing for it; a first argument that does not use `x` is the same value for every item, so the element reading of `sum(a, b)` meant `a` once for each item of `b`, which no one writes. A two-argument `sum` is now the element form when its second argument is written as a list or a range, or its first uses `x`; otherwise it adds its two values through the same aggregate as `total`.

| line | before | now |
| --- | --- | --- |
| `sum(a, b)` (with `a = 2`, `b = 3`) | `sum adds up the items of a list or a range, ... and this is a single number; ...` | `5`, as `total(a, b)` |
| `sum(a, b)` (with `a = 9:30`, `b = 10:15`) | the same refusal, `... and this is a date or time; ...` | `A date or time cannot be added: only numbers and quantities can.`, as `total(a, b)` |
| `sum(price, fee)` (with `$5` and `$7`) | the same refusal | `$12.00` |
| `sum(a, 5)` (with `a = 2`) | the same refusal | `7` |
| `sum(x, xs)` (with `xs = [1, 2, 3]`) | `6` | `6` (unchanged) |
| `sum(x * 2, xs)` | `12` | `12` (unchanged) |
| `sum(2, [1, 2, 3])` | `6` | `6` (unchanged: the list is written out) |

The boundary: `x` always stands for the item, so `sum(x, y)` is the element form even where a line above defines `x`, and is still refused when `y` holds one value; `total(x, y)` or `x + y` adds them. A name that holds a list is not written as one, so `sum(a, xs)` with a list in `xs`, which answered `6` (`a` once for each of three items), is now the two values added and refused as `total(a, xs)` is, since a list is not one value; `sum(x, xs) + a` adds a value to the list's sum. `prod(a, b)` has no reading as two values and is unchanged.

## Verification

`FoundBug_sumOfTwoNames.spec.ts` holds 16 tests: the lines through `parseDocument` and `evaluateDocument`, and through `evaluateLine`, where the names are refused as undefined since it has no lines above; numbers, lengths of time, money, a name and a number; the element form unchanged; both sides of the boundary; unit tests of the new `mentionsElement` and the changed `isMapReduceSum` and of the aggregate call rule with ordinary, boundary and hostile arguments; and adversarial cases from the kit (prototype words as both names, `constructor = 4` added to another value, a long sum as a value, a long name, a Cyrillic look-alike, invisible characters and markup, units that do not fit, a typo, a check, an edited value, the numeric edges agreeing with `total`, CRLF). The map-reduce page has proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`; the docs, hardening, integration, bugs, time, map-reduce, aggregate and inflation suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
