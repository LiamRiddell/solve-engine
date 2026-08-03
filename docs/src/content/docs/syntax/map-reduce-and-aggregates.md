---
title: Map, reduce and aggregates
description: Ranges, mapping an expression over a collection, and folding one down.
---

## Ranges

A range is `start:end`, inclusive at both ends. It is recognised inside brackets
or a function call. A bare `0:3` at the top level is a clock time, because that
reading is far more common in a document.

```solve
map(10*x, 0:3) // [0, 10, 20, 30]
```

## Map

The implicit variable is `x`.

```solve
map(10*x, [1,2,3]) // [10, 20, 30]
```

## Reduce

The implicit variables are `acc` for the accumulator and `x` for the element.

```solve
reduce(acc+x, [1,2,3]) // 6
```

## Sum and product

Shorthand for the two most common reductions.

```solve
sum(x, [10, 20, 30]) // 60
prod(x, [2,3,4]) // 24
sum(x, 0:4) // 10
```
