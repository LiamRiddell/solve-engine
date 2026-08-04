---
title: Vectors and matrices
description: Literals, element-wise arithmetic, matrix products, indexing and linear algebra.
---

Comma separates columns, semicolon separates rows.

```solve
[1,2,3] // [1, 2, 3]
[1,2;3,4] // [1, 2; 3, 4]
```

## Element-wise arithmetic

```solve
[1,2,3] * 10 // [10, 20, 30]
[1,2,3] + [10,20,30] // [11, 22, 33]
```

## Matrix products

Multiplying two matrices whose shapes line up performs a real matrix product
rather than an element-wise one.

```solve
[1, 2; 3, 4] * [1; 2] // [5; 11]
```

## Indexing

Indices are zero-based.

```solve
[1,2,3][0] // 1
[1,2;3,4][1,1] // 4
```

## Linear algebra

```solve
[1,2;3,4]^T // [1, 3; 2, 4]
det([1,2;3,4]) // -2
[1,2;3,4]^-1 // [-2.00, 1.00; 1.50, -0.50]
```

The inverse operator leaves ordinary numbers alone, so `5^-1` is still `0.2`.

A matrix whose entries contain unknowns is inverted symbolically, and those
entries carry exact rational coefficients rather than floating-point ones. That
removes a class of wrong answer: a pivot that is structurally zero could
previously arrive as a value like `0.0000000000000000555` after elimination and
be treated as non-zero, so a singular matrix was reported as invertible. See
[Symbolic evaluation](/syntax/symbolic/).
