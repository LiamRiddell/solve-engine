---
title: Conditionals
description: Comparisons, booleans, and the conditional expression.
---

```solve
5 > 3 // true
10 == 10 // true
3 != 4 // true
5 >= 5 // true
```

## Booleans

```solve
true and false // false
true or false // true
```

## Conditional expression

```solve
if 5 > 3 then 100 else 200 // 100
```

## A known limitation

The word `and` shares a binding power with addition, so an unparenthesised
comparison on both sides does not group the way you would expect. Parenthesise,
or use the symbol form.

```solve
(10 > 5) and (3 < 4) // true
```
