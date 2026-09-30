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

### Negation: `not` and `!`

Negating a condition turns it around: `not` makes true false and false true. It
is how a note says "unless", or asks that something does not hold. The word
`not` and a `!` in front of a value mean the same thing.

```solve
not true // false
not (1 > 2) // true
!(1 > 2) // true
!false // true
```

The two spellings bind differently, each the way it does in the languages it
comes from. `not` takes the whole comparison after it, as it does in Python and
SQL, so `not 1 > 2` asks whether 1 is not more than 2; it stops at `and` and
`or`, so `not true and false` is `(not true) and false`. A `!` takes only the one
value right after it, as it does in C and JavaScript, so a comparison after it
needs its brackets: `!(1 > 2)`.

```solve
not 1 > 2 // true
not true and false // false
if not 5 > 3 then 1 else 2 // 2
```

Negation is defined for `true` and `false` only. A number is not read as "zero
means false", and a `!` in front of one is not a bit flip (that is `~`, see
[bitwise operators](/syntax/bitwise-operators/)), so negating anything that is
not a boolean is refused by name, with the comparison to write instead:

```solve
not 5 // "not" works on true or false, and 5 is a number: compare it first, as in not (x > 3).
!1 > 2 // "!" works on true or false, and 1 is a number: compare it first, as in not (x > 3).
```

The boundary: a `!` straight after a value is still the factorial (`5!` is
120), and `!=` is still "is not equal to". `not` is ordinary English, so it is
read as negation only where a value is expected (at the start of a line, or
after `if`, `then`, `else`, a bracket, `and`, `or` or a comparison) and a
condition follows it. A sentence that starts with it (`not now`) stays prose,
and a variable called `not` keeps working:

```solve-doc
not = 3 // 3
not + 1 // 4
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
