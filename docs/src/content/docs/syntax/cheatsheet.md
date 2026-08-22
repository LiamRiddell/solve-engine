---
title: Cheatsheet
description: Every syntax form the engine understands, one line each.
sidebar:
  order: 1
---

One page covering everything, for scanning or bookmarking. Each area has its own
page with the full detail.

Every example below is executed against the engine when the documentation is
built, so if one of them is wrong the build fails rather than the page quietly
going stale.

## Arithmetic

```solve
2 + 2 * 10 // 22
(2 + 3) * 4 // 20
2^10 // 1,024
17 mod 5 // 2
2.5k // 2,500
3M // 3,000,000
```

Note that `%` means percent, not modulo. Use `mod` or `modulo` for remainder.
Writing `17 % 5` is a parse error rather than `2`, because `17 %` is already a
complete expression.

## Percentages

```solve
10% of 250 // 25
increase 100 by 10% // 110.00
100 to 150 // 50.00%
5% of what is 6 // 120
```

## Units

```solve
100cm + 2m // 300.00 cm
1 km + 500 m // 1.50 km
5 km to miles // 3.11 miles
1 hour to minutes // 60 minutes
72F to C // 22.22 C
20C in F // 68.00 F
```

## Functions

```solve
sqrt(16) // 4
max(3, 7) // 7
round(3.7) // 4
round(3.14159, 2) // 3.14
3.14159 to 4 dp // 3.1416
gcd(12, 18) // 6
hex(255) // 0xFF
bin(5) // 0b101
```

## Statistics and phrasing

```solve
average of 10, 20, 30 // 20
median of 1, 5, 3 // 3
larger of 10 and 4 // 10
half of 50 // 25
clamp 15 between 1 and 10 // 10
```

## Conversions

```solve
255 as hex // 0xFF
255 as binary // 0b11111111
0.5 as % // 50.00%
0.75 as fraction // 3/4
```

## Programmer math

```solve
0xFF // 255
0b1010 // 10
0o17 // 15
1 << 8 // 256
0xFF & 0x0F // 15
0xF0 | 0x0F // 255
12 xor 10 // 6
1 KiB in bytes // 1024.00 bytes
```

## Colours

```solve
#ff0000 // #ff0000
rgb(255, 128, 0) // rgb(255, 128, 0)
color("rebeccapurple") // rebeccapurple
lighten(#3366cc, 20%) // #85a3e0
mix(#ff0000, #0000ff) // #800080
contrast(#ffffff, #000000) // 21
#ff0000 as hsl // hsl(0, 100%, 50%)
```

## Conditionals

```solve
5 > 3 // true
10 == 10 // true
true and false // false
if 5 > 3 then 100 else 200 // 100
```

## Variables and functions

Colon-prefixed names are explicit. A bare name works too.

```solve
:a = 10
:b = 20
:a + :b // 30
```

```solve
f(x) = 2*x + 1
f(5) // 11
```

## Matrices and vectors

```solve
[1,2;3,4] // [1, 2; 3, 4]
[1,2,3] * 10 // [10, 20, 30]
[1,2,3] + [10,20,30] // [11, 22, 33]
[1,2,3][0] // 1
[1,2;3,4]^T // [1, 3; 2, 4]
det([1,2;3,4]) // -2
```

## Ranges, map and reduce

A range is written `start:end`. It is only recognised inside brackets or a
function call, because a bare `0:3` is a clock time. See
[map, reduce and aggregates](/syntax/map-reduce-and-aggregates/).

```solve
map(10*x, 0:3) // [0, 10, 20, 30]
sum(x, 0:4) // 10
sum(x, [10, 20, 30]) // 60
reduce(acc+x, [1,2,3]) // 6
prod(x, [2,3,4]) // 24
```

## Symbolic

An unknown stays an unknown rather than becoming an error.

```solve
1+2+b+3+b => // 2b+6
x^2+3x+2 => // x^2+3x+2
```

## Algebra

```solve
expand((x+1)*(x+2)) // x^2+3x+2
factor(x^2-4) // (x-2)*(x+2)
solve(x^2-4=0, x) // [-2, 2]
solve(2x+6=0, x) // -3
cancel((x^2-1)/(x-1)) // x+1
apart((3x+5)/(x^2-1)) // 4/(x-1)-1/(x+1)
```

An equation with one unknown can also be written on its own line.

```solve
x^2-4 = 0
x => // [-2, 2]
```

## Complex numbers

```solve
3i // 3i
1i*1i // -1
sqrt(-4) // 2i
conj(2+3i) // 2-3i
solve(x^2+1=0, x) // [-i, i]
```

## Calculus

```solve
der(x^3, x) // 3x^2
integral(x^2, x) // 1/3x^3
taylor(sin(x), x=0, 5) // 1/120x^5-1/6x^3+x
jacobian(x*y, x+y) // [y, x; 1, 1]
```

## Money

```solve
$100 + $50 // $150.00
10 dollars // $10.00
tax on 100 at 20% // 20
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 at 4% over 25 years // 1,055.67
```

The term and the rate read in either order, so `at 4% over 25 years` and
`over 25 years at 4%` are the same.

Currency conversion such as `10 USD to GBP` reaches the network, so it resolves
asynchronously rather than returning a value immediately. See
[async and live data](/guide/async-and-live-data/).

## Dates and times

Results depend on the current date, so these are shown rather than asserted.

| Expression | Result |
| --- | --- |
| `25/12/2023 + 20 days` | `Sunday, January 14, 2024` |
| `next friday` | the date of the coming Friday |
| `days until 25/12/2026` | the number of days, as a duration |
| `9:00am + 3 hours` | `12:00:00 PM` on the current day |
| `7:30 to 20:45` | `795 minutes` |

## Bigger integers

```solve
123n * 2 // 246
```

## Comments and headings

A line starting with `#` is a heading and evaluates to nothing. Text after `//`
is a comment.

```solve
2 + 2 // comment // 4
```

A label followed by a colon is kept, and the expression after it is evaluated.

```solve
total: 5 + 3 // 8
```
