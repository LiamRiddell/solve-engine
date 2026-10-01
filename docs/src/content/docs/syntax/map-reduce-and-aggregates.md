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

A range is `start:end`, the whole numbers from the start to the end, inclusive at
both ends. A colon between two numbers means a range only where a list is
expected: as the list `map`, `reduce`, `sum` (or `total`, its synonym) and
`prod` work through. Anywhere
else it is a clock time, because that reading is far more common in a document:
a bare `0:3`, `(0:3)`, and `max(9:30, 10:15)`, which compares two times of day.

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

Shorthand for the two most common reductions. `sum(expression, list)` adds up the
expression worked out for each element, and `prod(expression, list)` multiplies
them.

```solve
sum(x, [10, 20, 30]) // 60
prod(x, [2,3,4]) // 24
sum(x, 0:4) // 10
sum(x^2, 1:3) // 14
```

Given the list alone, they add or multiply its elements as they are, which is the
same as writing `x` for the expression:

```solve
sum(1:3) // 6
sum([10, 20, 30]) // 60
prod(1:5) // 120
```

`total` is another name for `sum`, the word a spreadsheet or a receipt uses,
and with a single list it reads the same way: a range or a bracketed list
inside `total(...)` is added up. With commas, `total(1, 2, 3)` adds the values
one by one, as `sum(1, 2, 3)` does, and over lines `total(line 1 : line 3)`
adds a span of the document (see [line references](/syntax/line-references/)).
The element form, `sum(x^2, 1:3)`, is `sum`'s alone.

```solve
total(1:3) // 6
total([10, 20, 30]) // 60
total(1, 2, 3) // 6
```

A single argument has to be a list: a range, a bracketed list, or a name holding
one. `sum(5)` is refused, because there is nothing to add it to, and the refusal
says so in the words of the call typed; a run of plain values is written with
commas, `sum(1, 2, 3)`. `prod`, `map` and `reduce` refuse a single value the
same way, each naming what it does with a list. A range counts up in whole
numbers, so `sum(3:1)` and `sum(1.5:3)` are refused by name rather than read
another way.

```solve
sum(5) // sum adds up the items of a list or a range, such as [1, 2, 3] or 1:3, and this is a single number; to add values one by one, list them, as in sum(5, 6).
prod(5) // prod multiplies together the items of a list or a range, such as [1, 2, 3] or 1:3, and this is a single number.
map(x * 2, 5) // map works through the items of a list or a range, such as [1, 2, 3] or 1:3, and this is a single number.
sum(1, 2, 3) // 6
```
