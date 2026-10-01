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
rather than storing it as a zero. A percentage is refused too: a cell is a plain
number, so it would keep only the fraction (0.1 for 10%) and lose the meaning
"a share of something" (see [a percentage and a list](/syntax/percentages/#a-percentage-and-a-list)):

```solve-doc
[(1, 2), 3] // ERROR: A list cannot hold a list inside it: each cell holds one number. Write the values side by side, as in [1, 2, 3].
[1, 7%] // ERROR: A list holds plain numbers, so it cannot hold 7% as a percentage. To take a share of each number, put the percentage outside the list, as in [100, 200] + 10%; to keep the fraction, write it as a number (0.07 for 7%).
```

## Lists and units

A list of quantities carries **one unit** for all of its cells, the way a column
in a spreadsheet is headed "km" or "£". The unit is the first quantity's, and
every later cell is read in it: a quantity in another unit of the same measure
is converted, and a bare number is taken to be in the list's unit already, as it
is in [a list of quantities](/syntax/statistics/#a-list-that-carries-units). Each
cell is shown as the quantity it stands for, so a list of money shows as money.

```solve
[1 km, 2 km] // [1.00 km, 2.00 km]
[1 km, 500 m] // [1.00 km, 0.50 km]
[1 km, 500] // [1.00 km, 500.00 km]
[$5, $6] // [$5.00, $6.00]
```

A unit written straight after a plain list gives every cell that unit, and `in`
converts every cell:

```solve
[1, 2, 3] km // [1.00 km, 2.00 km, 3.00 km]
[1 km, 500 m] in m // [1,000.00 m, 500.00 m]
[10 °C, 20 °C] in °F // [50.00 °F, 68.00 °F]
```

The element-wise arithmetic below keeps the unit: scaling by a plain number,
adding or taking away a quantity of the same measure, or a second list in one.
A plain list meeting a quantity is worked the same way, cell by cell. Reading
one cell answers a quantity, and `map` and `reduce` hand each cell to their
expression as the quantity it is.

```solve
[1 km, 500 m] * 2 // [2.00 km, 1.00 km]
[$5, $6] * 2 // [$10.00, $12.00]
[1 km, 2 km] + 500 m // [1.50 km, 2.50 km]
[1, 2] * 3 km // [3.00 km, 6.00 km]
[1 km, 500 m][1] // 0.50 km
map(x in m, [1 km, 2 km]) // [1,000.00 m, 2,000.00 m]
reduce(acc+x, [$1, $2]) // $3.00
```

Two cells of different measures have no one unit to share, so the list is
refused, naming both. So is money in two currencies, which has no fixed rate
between them, and a true or false or a percentage beside a quantity, since
neither is an amount in the list's unit:

```solve
[1 kg, 3 m] // A list holds one unit, and a cell in m has no reading in kg: mass and length are not one measure.
[$5, €6] // A list holds one unit, and a cell in EUR has no reading in USD, since there is no conversion between them.
[true, 1 km] // A list in km cannot hold a true or false: every cell of a list with a unit is an amount in it.
```

The boundary: a list carries one unit, so an operation whose cells would come
out in different units, or in a unit made from two, is refused rather than
answered in plain numbers. Multiplying a list of quantities by another quantity
(`[1 m, 2 m] * 3 m`) and dividing a number by one are refused by name. So is matrix
algebra on quantities (a determinant, an inverse, a matrix product or power, a
dot product), whose answer would be in a power of the unit; write the list
without its unit to work on the amounts. A formula cell (an unknown) has no
unit, so a list with one cannot carry one.

```solve
[1 km, 2 km] * 3 m // A list of quantities cannot be multiplied by another quantity cell by cell: a list carries one unit. Scale it by a plain number, or add a quantity of the same measure.
det([1 km, 2 km; 3 km, 4 km]) // A determinant of a list in km is not covered: matrix algebra works on plain numbers, so write the list without its unit to work on the amounts.
```

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

A percentage is a share of each element, as it is of one number, so a 10%
rise on a list raises every element by a tenth of itself, and a list with a
unit keeps it (see [a percentage and a list](/syntax/percentages/#a-percentage-and-a-list)):

```solve
[100, 200] + 10% // [110, 220]
[1 km, 2 km] + 10% // [1.10 km, 2.20 km]
10% of [1 km, 2 km] // [0.10 km, 0.20 km]
```

## Comparing a list

A comparison asks a yes-or-no question, such as "is this more than 150?" (see
[conditionals](/syntax/conditionals/)). Asked of a list, it is asked of each
element, the same element-wise way arithmetic works, so the answer is a list of
`true` and `false` in the list's shape, one answer per element. It is how a
column of readings is checked against a limit. The other side can be one value
or a second list of the same shape, and a list with a unit compares each
element as the quantity it is, converting where the units differ.

```solve
[100, 200] > 150 // [false, true]
[100, 200] == 100 // [true, false]
150 < [100, 200] // [false, true]
[1, 2] > [0, 3] // [true, false]
[1 km, 2 km] > 1500 m // [false, true]
[$100, $200] <= $150 // [true, false]
```

Lists of answers combine element by element with `and`, `or` and `not`, and
`sum` counts the `true` answers, since each counts as 1:

```solve
([1, 2, 3] > 1) and ([1, 2, 3] < 3) // [false, true, false]
not ([1, 2] > 1) // [true, false]
not [true, false] // [false, true]
sum([12, 18, 25] > 15) // 2
```

The boundary: each element is compared as it would be on a line of its own, so
a length beside a mass is refused for the whole list, as it is for one length,
and two lists of different shapes are refused. A list of answers is not one
answer, so a list where one `true` or `false` is needed, the condition of an
`if`, is refused by name; compare one element, or let `map` choose for each
element. A [check](/syntax/checks/) gives one verdict, so it refuses a list in
the same way. These used to give one wrong answer for the whole list:
`[100, 200] < 5` was `true` and `[100, 200] > 5` was `false`, because the list
was read as the number 0.

```solve
[1 km, 2 km] > 1 kg // length and mass cannot be compared
if [1, 2] > 0 then 1 else 2 // "if" needs one true or false, and this is a list of 2 cells. Compare one cell, as in v[0] > 5, or choose for each cell with map, as in map(if x > 5 then 1 else 0, v).
map(if x > 150 then 1 else 0, [100, 200]) // [0, 1]
```

## Functions of a list

A function of one number, such as a square root, a sine or a logarithm, has an
answer for each number, so given a list it works one element at a time too and
gives back a list of the answers, in the same shape. It is how a column of
areas becomes a column of side lengths, or a list of angles a list of sines,
without writing `map` for it. The functions worked this way are `sqrt`, `cbrt`,
`exp`, `expm1`, `ln`, `log`, `log10`, `log2`, `log1p`, `sin`, `cos`, `tan` and
their inverses and degree forms (`asin`, `sind`, `asind` and the rest), the
hyperbolic functions (`sinh`, `asinh` and the rest), `sign`, `trunc`, `fact`
(and `!`), `degtorad`, `radtodeg`, `fround` and `clz32`. The rounding family
works the same way (see [rounding a list](/syntax/rounding/#rounding-a-list)).

```solve
sqrt([4, 9]) // [2, 3]
sqrt([4, 9; 16, 25]) // [2, 3; 4, 5]
sin([30 deg, 90 deg]) // [0.50, 1]
[3, 4]! // [6, 24]
sqrt([4 m2, 9 m2]) // [2.00 m, 3.00 m]
```

A list holds real numbers, so a number in it whose answer is not one, or that
the function refuses on its own line, refuses the whole list rather than being
left out or shown as something else. A list of `true` and `false` has no numbers
to work on.

```solve-doc
sqrt([4, -9]) // ERROR: sqrt of -9 in this list has no real answer, and a list holds real numbers. Work that number out on its own line.
ln([1, 0]) // ERROR: ln(0) has no real value: ln is only defined for positive numbers.
sqrt([true, 4]) // ERROR: sqrt works on a list only when every cell is a number: this one holds a true or false.
```

A function that reads each of its inputs as one number, but whose answer for a
list is not simply one answer per number, refuses a list by name: `gcd`, `lcm`,
`root`, `atan2`, `isprime`, `nextprime`, `modpow`, `hex`, `bin`, `combination`,
`permutation` and the parts of a complex number (`re`, `im`, `conj`), and so do
the phrases that read one number, such as a rate (`[1, 2] per hour`), a split
or `in hours and minutes`. `map`
works any of them out for each number, with `x` standing for each one.

```solve-doc
gcd([4, 6], 2) // ERROR: gcd takes numbers, not a list: a list holds several numbers, and gcd works on one at a time. To work it out for each number, use map, with x standing for each one.
map(gcd(x, 2), [4, 6]) // [2, 2]
```

The boundary: every one of these used to read a list as 0, the number a list
gives where one number is asked of it, and answer for 0: `sqrt([4, 9])` was 0
and `cos([0, 1])` was 1. `abs` is left as it was, since `abs` of a square
matrix is its determinant (the `|a|` notation), and the functions that take a
list as a whole (`sum`, `det`, `dot`, `transpose`) are unchanged.

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
