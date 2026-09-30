---
title: "Map, reduce & aggregates"
description: Ranges, mapping an expression over a collection, and folding one down.
---

> **Package:** `MAPREDUCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Map and reduce are the two ways of working through a list with one expression.
**Map** applies the expression to each element in turn and gives back the list
of answers, one for each element. **Reduce** folds the list down to a single
value, carrying a running result from one element to the next, the way a total
or a largest-so-far is kept by hand.

## Ranges

A range is `start:end`, inclusive at both ends. It is recognised inside brackets
or a function call. A bare `0:3` at the top level is a clock time, because that
reading is far more common in a document.

```solve
map(10*x, 0:3) // [0, 10, 20, 30]
```

## Map

`map(expression, list)` works the expression out once for each element, with
`x` standing for the element, and returns the answers as a list of the same
length. It is how a whole list is converted, scaled or squared in one line.

```solve
map(10*x, [1,2,3]) // [10, 20, 30]
map(x^2, [4, 5, 6]) // [16, 25, 36]
```

## Reduce

`reduce(expression, list)` folds a list to one value. `acc`, the accumulator,
holds the result so far and `x` the next element; the expression says how the
two combine. `acc` starts as the first element, and the fold runs over the rest,
so a list of one element reduces to that element.

```solve
reduce(acc+x, [1,2,3]) // 6
reduce(acc*x, [2,3,4]) // 24
reduce(acc - x, [10, 1, 2]) // 7
reduce(max(acc, x), [3, 9, 4]) // 9
```

The third line is `10 - 1 - 2`: the 10 is where `acc` starts, not a value taken
away. The last keeps the larger of the running result and each element, so it
ends on the largest value in the list.

## Sum and product

Shorthand for the two most common reductions.

```solve
sum(x, [10, 20, 30]) // 60
prod(x, [2,3,4]) // 24
sum(x, 0:4) // 10
```
