---
title: "Number functions"
description: Common maths functions like square root, absolute value and greatest common divisor.
---

> **Package:** `FUNCTION_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A function takes one or more numbers and gives back another, written with the
name first and the inputs in brackets: `sqrt(16)` is the square root of sixteen.
These are the everyday maths functions, the ones a calculator keeps on its keys.

```solve
sqrt(16) // 4
abs(-5) // 5
round(3.7) // 4
floor(3.7) // 3
ceil(3.2) // 4
min(3, 7) // 3
max(3, 7) // 7
gcd(12, 18) // 6
```

The greatest common divisor, `gcd`, is the largest whole number that divides two
numbers exactly, and the least common multiple, `lcm`, the smallest number both
divide into: the first simplifies a fraction, the second finds when two cycles
line up again. Each can be asked in words too.

```solve
gcd of 12 and 18 // 6
lcm of 4 and 6 // 12
```

`min` and `max` read quantities in a shared unit, so the longer distance wins
whichever unit each is written in. Given only dates, they give the earliest or
the latest date. A value with no numeric reading, such as a piece of text, is
refused rather than counted as zero, and so is a date among plain numbers.

```solve
max(1 km, 500 m) // 1.00 km
max(25/12/2026, 1/1/2027) // Friday, January 1, 2027
```

A function that changes a quantity's size without changing what it measures
keeps its unit: the rounding family (`round`, `floor`, `ceil`, `trunc`), `abs`,
and `hypot`, the long side of a right-angled triangle, whose short sides are
read in a shared unit. A function that counts, such as `fact`, `gcd` or
`combination`, takes plain numbers, and refuses a quantity by name rather than
counting its bare number.

```solve-doc
trunc(3.7 m) // 3.00 m
hypot(3 m, 400 cm) // 5.00 m
fact(3 m) // ERROR: fact takes a plain number, not a length
```

Text in quotes is words, not a number, even when the words are digits, so a
function given text refuses it by name rather than reading it as zero or as its
leading digits. `as number` turns text that is a number into one, and `int`
reads such text itself, cutting any fraction off. `int` and `float` read a
number written in another base the way `as number` does, after `0x`
(hexadecimal), `0b` (binary) or `0o` (octal):

```solve
sqrt("abc") // sqrt takes a number, not text. To use a number held as text, convert it first with "as number".
round("3.5") // round takes a number, not text. To use a number held as text, convert it first with "as number".
sqrt("16" as number) // 4
int("42.9") // 42
int("0xFF") // 255
float("0o17") // 15
```

A colour or an IPv6 address has no one number either, and is refused the same
way (see [colours](/syntax/colours/) and [networking](/syntax/networking/)).

A list, such as `[4, 9]`, holds several numbers. A function of one number with
an answer for each, such as `sqrt`, `sin` or `ln`, works it out for each number
and gives back a list; one that reads its inputs as single numbers, such as
`gcd` or `root`, refuses a list by name and points at `map`. Both used to read a
list as 0. See [functions of a list](/syntax/vectors-and-matrices/#functions-of-a-list).

```solve-doc
sqrt([4, 9]) // [2, 3]
root(3, [8, 27]) // ERROR: root takes numbers, not a list: a list holds several numbers, and root works on one at a time. To work it out for each number, use map, with x standing for each one.
map(root(3, x), [8, 27]) // [2, 3]
```

`root(n, x)` is the nth root of x. A negative number has a real root of odd
degree, since -2 cubed is -8, and none of even degree, which is refused by name
as `(-1)^0.5` is.

```solve-doc
root(3, -8) // -2
root(2, -4) // ERROR: root(2, -4) has no real value: a negative number has a real root only of odd degree, as in root(3, -8).
```

## Powers and exponentials

A power multiplies a number by itself a given number of times: 2 to the power 10
is ten 2s multiplied together. `^` writes it, and `pow(x, y)` is the same thing
as a function, the spelling spreadsheets and programming languages use. `exp(x)`
is e to the power x, the curve behind continuous growth and decay.

```solve
pow(2, 10) // 1,024
2^10 // 1,024
exp(1) // 2.72
```

`expm1(x)` is `exp(x) - 1`, and `log1p(x)` is `ln(1 + x)`. Each is worked out
directly rather than by adding or taking away the 1, which loses digits when x
is very small (a daily interest rate, say), so a program that needs the small
difference exactly reaches for these two.

```solve
expm1(1) // 1.72
log1p(1) // 0.69
```

## Logarithms

A logarithm answers "what power gives this number": the base-10 logarithm of 100
is 2, because 10 squared is 100. `log` and `ln` are the natural logarithm, whose
base is e (about 2.718), the one maths and most programming languages mean by an
unmarked log. A calculator's `log` key is often base 10 instead, so the other two
common bases have names of their own, and any base can be named in words.

```solve
ln(e) // 1
log(100) // 4.61
log10(100) // 2
log2(8) // 3
log 8 base 2 // 3
log 1000 base 10 // 3
```

`ln` is a function only where a bracket follows it, so `ln` still works as a
variable name (`ln = 4`, then `ln * 2` is 8). A logarithm of zero, of a negative
number or of a quantity is refused by name, under whichever of the two names the
line wrote (see [outside a function's domain](#outside-a-functions-domain)).

## Trigonometry

`sin`, `cos` and `tan` relate an angle to the sides of a right-angled triangle:
the sine is the opposite side over the longest, the cosine the adjacent side over
the longest, and the tangent the opposite over the adjacent. A bare number is an
angle in radians, the convention maths and programming share, where a full turn
is 2π. Write `degrees` (or `grad`) after the angle to give it in those instead.

```solve
sin(30 degrees) // 0.50
cos(60 degrees) // 0.50
tan(45 degrees) // 1
sin(pi/2) // 1
```

An angle is what these take, so a quantity that is not an angle is refused. The
sine of a length has no meaning, and read as its bare number the answer would
depend on which unit happened to be written: one metre and a hundred centimetres
would give different sines. The logarithms, `exp`, and the inverse and hyperbolic
functions take a plain number and refuse any quantity the same way. A ratio of
two lengths is a plain number, so it is accepted. The degree forms, `sind`,
`cosd` and `tand`, read a bare number as degrees and an angle in its own unit,
so `sind(1 rad)` is the sine of one radian.

```solve-doc
sin(1 m) // ERROR: sin takes an angle or a plain number, not a length
log(10 kg) // ERROR: log takes a plain number, not a mass
sin(1 m / 2 m) // 0.48
```

The angles people actually type, 0, 30, 45, 60 and 90 degrees and their
multiples, and the same angles written with π, give exact answers. A computer
holds none of those angles exactly (π itself has no exact binary form), so the
sine of its nearest approximation to 180° is a tiny 0.000000000000000122 rather
than 0. The engine recognises an angle that is one of these to within that
rounding and answers with the exact value instead.

```solve
sin(180 degrees) // 0
cos(90 degrees) // 0
sin(pi) // 0
sin(45 degrees) // 0.71
```

The tangent grows without limit as the angle nears a right angle, and at exactly
90° (or 270°, or any odd number of right angles) it has no value at all. There it
is refused by name, rather than answered with the enormous finite number the
computer's nearest approximation to 90° produces. An angle close to it, but not
on it, still answers:

```solve-doc
tan(90 degrees) // ERROR: tan is undefined at 90 degrees: at an odd multiple of a right angle the tangent has no value, only an asymptote.
tan(89.9 degrees) // 572.96
```

The boundary: exactness covers the multiples of 30° and 45°. An irrational
exact value such as the sine of 45°, a half of the square root of two, is the
nearest double to it, shown to the usual places. Any other angle is computed as
before.

## Inverse trigonometry

The inverse functions go the other way, from a ratio back to the angle that
gives it. `asin`, `acos` and `atan` answer in radians; `asind`, `acosd` and
`atand` answer in degrees. `arcsin`, `arccos` and `arctan` are the longer names
some calculators print on the keys, and mean the same as the first three.

```solve
asin(1) // 1.57
arcsin(1) // 1.57
acosd(0.5) // 60.00
atand(1) // 45
```

`atan2(y, x)` is the angle of the point (x, y), measured from the positive x axis
in radians. Unlike `atan(y / x)` it knows which quarter of the plane the point is
in, since (1, 1) and (-1, -1) have the same ratio but point opposite ways, which
is why navigation and graphics code uses it. The two sides are read in a shared
unit, so a length and a mass are refused.

```solve
atan2(1, 1) // 0.79
atan2(-1, -1) // -2.36
atan2(1 m, 2 kg) // length and mass cannot be compared
```

`degtorad` and `radtodeg` convert a bare number between the two measures of an
angle: 180 degrees is π radians.

```solve
degtorad(180) // 3.14
radtodeg(pi) // 180
```

Converting an inverse function's answer to degrees converts it, so `asin(0.5)
in degrees` is 30 degrees, the same angle `asind(0.5)` gives as a plain number:

```solve
asin(0.5) in degrees // 30.00 degrees
atan2(1, 1) in degrees // 45.00 degrees
```

The call on its own is an angle, so converting it to a unit that measures
something else is refused rather than labelled: an angle is not a length.

```solve
asin(0.5) in km // an angle cannot be converted to a length
atan2(1, 1) in kg // an angle cannot be converted to a mass
```

The boundary: the conversion knows the number is an angle because the line
starts with the call. A name that holds the answer is an ordinary number, and a
plain number converted to a unit is given that unit, so `a = asin(0.5)` followed
by `a in degrees` is 0.52 degrees. Write `asind`, or `radtodeg(a)`, for that
case. A longer left side is only read as radians for an angle target, since
`asin(0.5) * 6371 km` (an arc length on the Earth) is a length and converts to
miles as one.

## Hyperbolic functions

The hyperbolic functions `sinh`, `cosh` and `tanh` are the counterparts of sine,
cosine and tangent for a hyperbola rather than a circle. They describe the curve
a hanging chain makes, and `tanh` squashes any number into the range from -1 to
1, which is why neural networks use it. `asinh`, `acosh` and `atanh` are their
inverses. Each takes a plain number.

```solve
sinh(1) // 1.18
cosh(1) // 1.54
tanh(1) // 0.76
asinh(1) // 0.88
acosh(2) // 1.32
atanh(0.5) // 0.55
```

`acosh` has a real answer only from 1 upwards, and `atanh` only strictly
between -1 and 1; outside those ranges each is refused, as the next section
explains.

## Outside a function's domain

Some functions only have a real answer for part of the number line: a logarithm
for positive numbers, the inverse sine and cosine for numbers from -1 to 1. Asked
outside that range, the computer's maths library answers anyway, with a
negative infinity for `log(0)` or `NaN` (not a number) for `asin(2)`, neither of
which is an answer. These are refused by name, saying what the function accepts.

```solve-doc
log(0) // ERROR: log(0) has no real value: log is only defined for positive numbers.
asin(2) // ERROR: asin(2) has no real value: asin is only defined for numbers from -1 to 1.
```

The same holds for `log10`, `log2`, `log1p`, `acos`, `acosh`, `atanh` and the
degree forms `asind` and `acosd`. An infinite angle has no sine, cosine or
tangent, so `sin`, `cos`, `tan` and their degree forms refuse one the same way. A
square root of a negative number is not refused: it has an exact complex answer,
so `sqrt(-1)` is `i`. Division by zero is left as it was, infinity for `1/0`,
which is the floating-point standard's defined answer rather than a function's
missing one; `0/0`, which has no single answer, is refused (see
[operators](/syntax/operators/)).

```solve-doc
sin(1/0) // ERROR: sin(∞) has no real value: sin is only defined for finite angles.
```
