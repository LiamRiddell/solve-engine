---
title: Conditionals
description: Comparisons, booleans, and the conditional expression.
---

> **Package:** `CONDITIONALS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A comparison asks whether one value is bigger than, smaller than or equal to
another, and answers `true` or `false`. `>` is greater than, `<` less than, `>=`
and `<=` add "or equal to", `==` asks whether the two are equal and `!=` whether
they differ.

```solve
5 > 3 // true
10 == 10 // true
3 != 4 // true
5 >= 5 // true
```

## Booleans

A boolean is a value that is either `true` or `false`, the kind of answer a
comparison gives. `and` is true only when both sides are true; `or` is true when
at least one is. They are how two conditions are combined into one.

```solve
true and false // false
true or false // true
```

## Conditional expression

A conditional expression picks one of two values depending on a condition: `if`
the condition, `then` the value to use when it holds, `else` the value when it
does not. It is how a note gives a different answer in different cases, such as
a charge that applies only above some amount.

```solve
if 5 > 3 then 100 else 200 // 100
```

## Checks

A `check` line states a comparison the note must keep true, and becomes an error
naming both sides when it stops holding; it has its own page, [checks](/syntax/checks/).

## `and` between comparisons

A line that joins two comparisons with `and` asks whether both hold. Each
comparison is worked out first and `and` then combines the two answers, so the
line reads the way it is said, with no brackets needed. The symbol form `&&`
groups the same way.

```solve
10 >= 5 and 3 > 1 // true
10 >= 5 and 3 > 4 // false
10 >= 5 && 3 > 1 // true
```

It works the same with variables, which is where the form is usually met:

```solve
x = 10
y = 5
x >= y and y > 1 // true
x >= y and y > 7 // false
```

`and` is also the word form of addition, so between two plain numbers it adds:

```solve
2 and 3 // 5
```

The boundary: `and` means "both are true" only when both sides are true or
false answers. With a number on one side and a comparison on the other it is
still an addition, counting `true` as 1 and `false` as 0, so `2 and 3 > 1` is
`2 + 1`. Brackets make the intended reading explicit:

```solve
2 and 3 > 1 // 3
(2 and 3) > 1 // true
```
