---
title: "Vectors & matrices"
description: Literals, element-wise arithmetic, matrix products, indexing and linear algebra.
---

> **Packages:** `MATRIX_PACKAGE`, and `VECTOR_PACKAGE` for the `vec2` to `vec4` constructors. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A vector is a list of numbers in a row; a matrix is a grid of them. Comma
separates columns, semicolon separates rows.

```solve
[1,2,3] // [1, 2, 3]
[1,2;3,4] // [1, 2; 3, 4]
```

`vec2`, `vec3` and `vec4` build a vector of two, three or four numbers, the
names graphics and game code give a point on a plane, a point in space, and a
point with a fourth value such as a colour's opacity. Each is the same vector
the brackets write, named by its length.

```solve
vec2(1, 2) // [1, 2]
vec3(1, 2, 3) // [1, 2, 3]
vec4(1, 2, 3, 4) // [1, 2, 3, 4]
```

A matrix's compact value is written on one line, `columns, ...; next row, ...`,
which is what the engine returns as text. In this notepad the answer column
renders it as a stacked, column-aligned grid instead, one row per line, since a
grid is easier to read; the two are the same matrix.

Each cell holds one number, a `true` or `false`, or an unknown. A list inside a
list, a piece of text or a date has no place in a cell, so the literal is refused
rather than storing it as a zero:

```solve-doc
[(1, 2), 3] // ERROR: A list cannot hold a list inside it: each cell holds one number. Write the values side by side, as in [1, 2, 3].
```

## Lists and units

A list does not carry a unit yet. A cell stores the amount a quantity has, and
the unit is left behind, so a list written in one unit is a row of plain
numbers: `[1 km, 2 km]` is `[1, 2]`, and so is `[$1, $2]`. A bare number beside
a quantity is read in its unit, as it is in [a list of
quantities](/syntax/statistics/#a-list-that-carries-units).

```solve
[1 km, 2 km] // [1, 2]
[1 km, 500] // [1, 500]
```

Two different units in one list could not both survive that, since `[1 km, 500
m]` would read as if 500 m were 500 km, and `[1 kg, 3 m]` would put a mass beside
a length as though they were one measure. Such a list is refused, naming both
units; converting the cells to one unit first gives a list that reads right.

```solve
[1 km, 500 m] // A list cannot hold quantities in km and m side by side: each cell holds one number, so both would be read in one unit. Convert the cells to one unit first, writing "in km" after each cell in another unit.
[1 kg, 3 m] // A list cannot hold quantities in kg and m side by side: each cell holds one number, and mass and length are not one measure.
[1 km, 500 m in km] // [1, 0.50]
```

For the same reason a list has no single amount to give a unit to. A unit
written after it, or a quantity it is combined with, is refused rather than
read as zero of that unit. A plain number still scales every cell.

```solve
[1, 2, 3] km // A bracketed list has no single amount to convert to km: only a number or a quantity can be converted.
[1, 2] * 1 km // A bracketed list and a quantity in km cannot be multiplied: a bracketed list has no single amount to put in km. A list does not carry a unit yet.
[1, 2] * 2 // [2, 4]
```

Lists that carry a unit, so that `[1, 2] * 1 km` would be a list of lengths, are a
planned feature; these refusals leave that answer open rather than giving a
wrong one meanwhile.

A numeric vector can be drawn as a sparkline with `[...] as sparkline`; see
[charts](/syntax/charts/).

## Element-wise arithmetic

Element-wise means one element at a time: an operation between a vector and a
number is applied to every element, and one between two vectors of the same
length pairs them up position by position, first with first and second with
second. It is how a whole column of prices is scaled or two lists of readings
are added together.

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

Two shapes line up when the first has as many columns as the second has rows.
When they do not, the product is refused, naming both shapes:

```solve-doc
[1,2,3] * [4,5,6] // ERROR: Cannot multiply a 1x3 matrix by a 1x3 matrix: the first has 3 columns and the second 1 row, and the two must match.
```

## Dot products

The dot product of two vectors multiplies their matching components and adds
the results, so it is a single number: `dot([1,2,3], [4,5,6])` is 1×4 + 2×5 +
3×6, which is 32. It says how far two directions agree, and two directions at
right angles to each other have a dot product of zero. A vector's components
are the same whether it is written as a row or a column, so `dot` reads either.

```solve
dot([1,2,3], [4,5,6]) // 32
dot([1,2,3], [4;5;6]) // 32
dot([1, 0], [0, 1]) // 0
```

Two vectors of different lengths have no dot product, and a grid of more than
one row and column is not a vector at all; the product of two matrices is `*`.
Each is refused by name:

```solve-doc
dot([1,2], [4,5,6]) // ERROR: dot needs two vectors of the same length, but one has 2 components and the other 3.
dot([1,2;3,4], [5,6;7,8]) // ERROR: dot takes two vectors, and a 2x2 matrix is not one. For a matrix product, write "*".
```

## Vectors of a fixed size

> **Package:** `VECTOR_PACKAGE`, registered by `createEngine()`.

`vec2`, `vec3` and `vec4` build a vector of two, three or four components, the
spelling graphics and physics code uses for a point or a direction. Each takes
exactly its count, so a component too many or too few is refused rather than
dropped or made up:

```solve
vec3(1, 2, 3) // [1, 2, 3]
dot(vec2(3, 4), vec2(3, 4)) // 25
```

```solve-doc
vec2(1, 2, 3) // ERROR: vec2() takes 2 arguments, but was given 3 arguments
vec3(1, 2) // ERROR: vec3() takes 3 arguments, but was given 2 arguments
```

`float(x)` is the plain number `x` is, the name some languages give a number
with a fractional part. A number is itself, a percentage is its fraction, and
text that spells a number whole is that number. Anything with no plain number
to give, such as a quantity, a list or other text, is refused by name:

```solve
float(2.5) // 2.50
float(50%) // 0.50
float("1,234.5") // 1,234.50
```

```solve-doc
float("hello") // ERROR: float takes a number, or text that is a number, and "hello" is not one.
float(5 km) // ERROR: float takes a plain number, not a length.
```

## Indexing

Indices are zero-based.

```solve
[1,2,3][0] // 1
[1,2;3,4][1,1] // 4
```

## Linear algebra

Linear algebra is the arithmetic of whole matrices, used to solve several
equations at once or to move and rotate points. The **transpose** swaps a
matrix's rows and columns, written `^T` or `transpose(...)`. The
**determinant**, `det`, is a single number that says whether the matrix can be
undone: it cannot when the determinant is zero. The **inverse**, `^-1` or
`inv(...)`, is the matrix that undoes it.

```solve
[1,2;3,4]^T // [1, 3; 2, 4]
transpose([1,2;3,4]) // [1, 3; 2, 4]
det([1,2;3,4]) // -2
[1,2;3,4]^-1 // [-2.00, 1.00; 1.50, -0.50]
```

The inverse operator leaves ordinary numbers alone, so `5^-1` is still `0.2`.

A matrix whose entries contain unknowns is inverted symbolically, and those
entries carry exact rational coefficients rather than floating-point ones. That
removes a class of wrong answer: a pivot that is structurally zero could
previously arrive as a value like `0.0000000000000000555` after elimination and
be treated as non-zero, so a singular matrix was reported as invertible. See
[Symbolic](/syntax/symbolic/).
