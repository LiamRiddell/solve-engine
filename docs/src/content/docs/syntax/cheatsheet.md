---
title: Cheatsheet
description: One proven line for each area of the syntax reference, with a link to the page that explains it.
sidebar:
  order: 1
---

> **Packages:** this page spans every built-in. `createEngine()` registers them all; for a slimmer engine, register just the packages the features you use need (each syntax page names its own, see [choosing packages](/getting-started/installation/)).

A map of the syntax reference. Every area of the language has a line or two here
that you can edit in place, and a link to its own page, where the form is
explained in full. This page is for scanning: the explanations, the variations and
the edge cases stay on the pages it links to. The areas are grouped the way the
sidebar groups them.

Every example below is executed against the engine when the documentation is
built, so if one of them is wrong the build fails rather than the page quietly
going stale. The few areas whose answers come from the network, or from a
function the host application supplies, have no fixed answer to check, so they
are named in text rather than shown as a live line.

## Writing a note

A note is a column of lines, and each line is worked out on its own unless it
reads another. Text after `//` is a comment the engine skips. A label before a
colon is kept while the rest of the line is worked out (see
[labels](/syntax/trigger-words/#labels-are-preserved)). A line starting with `#`
is a heading: it gives no answer, and it names a [section](/syntax/sections/).

```solve
2 + 2 // comment // 4
total: 5 + 3 // 8
```

## Arithmetic

**[Operators](/syntax/operators/)**: add, subtract, multiply, divide and raise
to a power, in symbols or in words, with multiplication done before addition.
`%` means percent, so the remainder after a division is `mod`.

```solve
2 + 2 * 10 // 22
10 plus 5 times 2 // 20
17 mod 5 // 2
```

**[Number suffixes](/syntax/number-suffixes/)**: a letter after a number as
shorthand for thousands (`k`), millions (`M`), billions (`B`) and trillions
(`T`).

```solve
2.5k // 2,500
3M // 3,000,000
```

**[Decimals](/syntax/decimals/)**: a number with a decimal point is kept as the
exact decimal you typed and worked in base ten, so `0.1 + 0.2` is exactly 0.3
rather than a near miss.

```solve
0.1 + 0.2 == 0.3 // true
```

**[Fractions](/syntax/fractions/)**: a quotient of whole numbers stays exact,
and `as fraction` shows it as one.

```solve
1/3 + 1/3 + 1/3 // 1
10/4 as fraction // 5/2
```

**[Percentages](/syntax/percentages/)**: a percentage of a number, a discount
or a markup, the change from one value to another, and the whole a percentage
was taken from.

```solve
10% of 250 // 25
15% off 80 // 68
100 to 150 // 50.00%
5% of what is 6 // 120
```

**[Ratios](/syntax/ratios/)**: a ratio reduced to its lowest whole-number
terms.

```solve
ratio(1920, 1080) // 16:9
```

**[Rounding](/syntax/rounding/)**: to a number of decimal places (dp), in a
chosen direction, or to the nearest ten, hundred or other step.

```solve
round(3.14159, 2) // 3.14
3.14159 to 4 dp // 3.1416
-25 to nearest 10 // -30
```

**[Number functions](/syntax/number-functions/)**: everyday maths functions such
as the square root, the absolute value (the size of a number without its sign)
and the greatest common divisor (the largest number that divides both).

```solve
sqrt(16) // 4
abs(-5) // 5
gcd(12, 18) // 6
```

**[Uncertainty](/syntax/uncertainty/)**: a measurement with a tolerance, written
`+/-`, carried through the arithmetic so the answer says how far it can be
trusted.

```solve
(12.3 +/- 0.5) * 4 // 49.2 ± 2.0
```

## Numbers

**[Numerals](/syntax/numerals/)**: a number written out in words, as an ordinal
(1st, 2nd, 3rd) or in Roman numerals.

```solve
1234 as words // one thousand two hundred and thirty-four
3 as ordinal // 3rd
2024 as roman // MMXXIV
```

**[Big integers](/syntax/big-integers/)**: whole numbers past
9,007,199,254,740,991, where an ordinary floating-point number starts to drop
digits, stay exact; the `n` suffix writes one directly.

```solve
2^53 + 1 // 9,007,199,254,740,993
123n * 2 // 246
```

**[Primes, factors and counting](/syntax/number-theory/)**: testing whether a
number is prime, breaking it into its prime factors, and factorials (`5!` is
every whole number from 1 to 5 multiplied together).

```solve
isprime(97) // true
factor(360) // 2^3 * 3^2 * 5
5! // 120
```

**[Complex numbers](/syntax/complex/)**: numbers with an imaginary part, written
with `i` (the square root of -1), which is what the square root of a negative
number needs.

```solve
sqrt(-4) // 2i
(1+1i)*(1-1i) // 2
```

**[Constants](/syntax/constants/)**: named physical and mathematical constants,
carrying their units.

```solve
speed of light // 299,792,458.00 m/s
gravity * 70 kg as N // 686.47 N
```

## Programmer math

**[Number bases](/syntax/number-bases/)**: numbers written in hexadecimal
(`0x`), binary (`0b`) or octal (`0o`), and shown in any of them with `as`.

```solve
0xFF // 255
255 as binary // 0b11111111
```

**[Bit shifting](/syntax/bit-shifting/)**: moving the bits of a whole number
left or right, which multiplies or divides it by a power of two.

```solve
1 << 8 // 256
```

**[Bitwise operators](/syntax/bitwise-operators/)**: and, or, exclusive or
(`xor`) and complement, applied to each bit of a whole number.

```solve
0xFF & 0x0F // 15
12 xor 10 // 6
```

**[Data sizes](/syntax/data-sizes/)**: bytes and bits, with the decimal prefixes
(a kB is 1,000 bytes) kept apart from the binary ones (a KiB is 1,024), and how
long a download takes at a given speed.

```solve
1 KiB in bytes // 1,024.00 bytes
4 GB at 50 Mbps // 10.67 min
```

## Algebra

**[Expanding](/syntax/expanding/)**: multiplying out brackets and collecting the
like terms.

```solve
expand((x+1)*(x+2)) // x^2+3x+2
```

**[Factoring](/syntax/factoring/)**: writing a polynomial as a product of
simpler factors, the reverse of expanding.

```solve
factor(x^2-4) // (x-2)*(x+2)
```

**[Solving equations](/syntax/solving-equations/)**: the values of an unknown
that make an equation true, exactly where there is a method and numerically
where there is not.

```solve
solve(x^2-4=0, x) // [-2, 2]
solve(cos(x) = x, x) // 0.74
```

**[Cancelling a fraction](/syntax/cancelling-fractions/)**: a fraction of
polynomials reduced to its lowest terms.

```solve
cancel((x^2-1)/(x-1)) // x+1
```

**[Splitting a fraction](/syntax/splitting-fractions/)**: a fraction of
polynomials broken into the simpler fractions that add up to it (partial
fractions).

```solve
apart((3x+5)/(x^2-1)) // 4/(x-1)-1/(x+1)
```

**[Exact coefficients](/syntax/exact-coefficients/)**: the numbers in front of
the terms of a symbolic expression (its coefficients) stay exact fractions, so
they pick up no floating-point error.

```solve
0.1x + 0.2x => // 0.3x
```

**[Calculus](/syntax/calculus/)**: derivatives (rates of change), integrals
(areas under a curve), limits, Taylor series and Jacobians.

```solve
der(x^3, x) // 3x^2
integral(x^2, x, 0, 3) // 9
```

**[Symbolic](/syntax/symbolic/)**: a letter with no value stays an unknown
rather than an error, and `=>` at the end of a line asks for the simplified
expression.

```solve
1+2+b+3+b => // 2b+6
```

## Statistics

**[Vectors & matrices](/syntax/vectors-and-matrices/)**: lists of numbers in
square brackets, with `;` between the rows of a matrix, worked on element by
element or with linear algebra.

```solve
[1,2,3] * 10 // [10, 20, 30]
det([1,2;3,4]) // -2
```

**[Statistics](/syntax/statistics/)**: averages, medians, totals and other
summaries of a list, in plain phrasing.

```solve
average of 10, 20, 30 // 20
median of 1, 5, 3 // 3
half of 50 // 25
```

**[Probability distributions](/syntax/probability-distributions/)**: the normal,
binomial, Poisson and Student's t distributions, for the chance of a result and
the result for a chance.

```solve
normalcdf(1.96) // 0.98
binompdf(10, 0.5, 3) // 0.12
```

## Finance

**[Currency](/syntax/currency/)**: money written with a symbol, a code or a
word. Converting between currencies, as in `10 USD in GBP`, uses live exchange
rates, so it has no fixed answer to show here.

```solve
$100 + $50 // $150.00
10 dollars // $10.00
```

**[Money precision](/syntax/money-precision/)**: money is held as an exact
decimal, so a column of prices adds up to the cent instead of drifting by a
fraction of a penny.

```solve
$0.10 + $0.20 // $0.30
$10 / 3 // $3.33
```

**[Tax](/syntax/tax/)**: adding tax to a price, taking it off a total, or
finding how much of a total was tax.

```solve
tax on 100 at 20% // 20
tax off 120 at 20% // 100
tax in 120 at 20% // 20
```

**[Recurring schedules](/syntax/recurring-schedules/)**: the total of a payment
that repeats, such as rent every month for a year and a half.

```solve
450 monthly for 18 months // 8,100
```

**[Splitting a bill](/syntax/splitting-a-bill/)**: an amount divided between
people, with the odd penny accounted for rather than lost.

```solve
split $100 between 3 // $33.33 each, with 1 share paying $33.34
$120 + 18% split 3 ways // $47.20 each
```

**[Interest & inflation](/syntax/interest-and-inflation/)**: compound interest,
loan and mortgage repayments, and what an amount of money from one year is
worth in another.

```solve
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 over 25 years at 4% // 1,055.67
what is $500 in 1990 worth in 2010 // $834.35
```

**[Savings goals](/syntax/savings-goals/)**: how long it takes to reach a
target, or how much to put by each month.

```solve
how long to save $10,000 at $500 monthly // 20 months
how much per month to save $12,000 in 2 years // $500.00
```

**[NPV, IRR & payback](/syntax/cash-flow/)**: judging an investment from its
cash flows, the money paid out first and the money that comes back after: the
net present value (NPV, what the flows are worth today) and the internal rate of
return (IRR, the rate at which they break even).

```solve
npv of -1000, 300, 400, 500 at 10% // -21.04
irr of -1000, 300, 400, 500 // 8.90%
```

**[Payroll & take-home](/syntax/payroll/)**: UK take-home pay from a salary,
after income tax and National Insurance.

```solve
£50,000 after tax // £39,519.60
```

**[Comparison shopping](/syntax/shopping/)**: which of two prices is the better
deal, and by how much, with `vs`.

```solve
£3 / 500g vs £4 / 750g // the second is cheaper, 11% less
```

**[Stocks](/syntax/stocks/)** and **[crypto](/syntax/crypto/)**: share and coin
prices, as in `stock(AAPL)` and `crypto("BTC")`, from a data source the host
application supplies. A price is live, so there is no fixed answer to show here.

## Dates

A line that depends on today is worked out for noon on Wednesday 11 March 2026
in London, the fixed moment these pages are checked against, and the notepad
works it out for your own today.

**[Date literals](/syntax/date-literals/)**: a date written day first, year
first, or with the month's name.

```solve
25/12/2023 // Monday, December 25, 2023
25 Dec 2026 // Friday, December 25, 2026
```

**[Date arithmetic](/syntax/date-arithmetic/)**: adding days, weeks, months or
hours to a date, or taking them away.

```solve
25/12/2023 + 20 days // Sunday, January 14, 2024
30 days from 3 March 2026 // Thursday, April 2, 2026
```

**[Relative dates](/syntax/relative-dates/)**: a day named by its relation to
today, such as tomorrow, next friday, three days ago or the end of the month.

```solve
tomorrow // Thursday, March 12, 2026, 12:00:00 PM
next friday // Friday, March 13, 2026, 12:00:00 PM
3 days ago // Sunday, March 8, 2026, 12:00:00 PM
end of month // Tuesday, March 31, 2026
```

**[Relative months](/syntax/relative-months/)**: a month named by its relation
to now, which gives the month's first day.

```solve
next month // Wednesday, April 1, 2026
```

**[The nth weekday](/syntax/nth-weekday/)**: the nth, or the last, weekday of a
month, the way many holidays and meetings are set.

```solve
last Friday of November 2026 // Friday, November 27, 2026
```

**[Age](/syntax/age/)**: whole years from a birth date, today or on a day you
name.

```solve
age of 15/06/1990 // 35 years
age of 15/06/1990 on 25/12/2030 // 40 years
```

**[Date differences](/syntax/date-differences/)**: the span between two dates,
or the time until or since one. A count from today includes the part of today
already gone, which is why it is not a whole number at noon.

```solve
days until 25/12/2026 // 288.50 days
weeks between 01/01/2024 and 01/06/2024 // 21.71 weeks
```

**[Timestamps](/syntax/timestamps/)**: a Unix timestamp, a count of seconds
since 1970, read as the date it names, and a date written as one.

```solve
1710000000 as date // Saturday, March 9, 2024, 4:00:00 PM
2024-03-09 as timestamp // 1,709,942,400
```

**[Working days](/syntax/working-days/)**: counting only the days that are not
weekends (nor public holidays, when the host application supplies them).

```solve
25/12/2023 + 5 workdays // Monday, January 1, 2024
working days between 01/01/2024 and 31/01/2024 // 23
```

**[Displaying dates](/syntax/displaying-dates/)**: whether a date is spelled out
or written in numbers is a setting in the host application, not something a line
writes, so it has no line here.

**[Time](/syntax/time/)**: clock times, durations, and the span between two
times, with frame rates and timecode. A clock time is shown as the time of day,
with the days it has moved beside it when it crosses midnight.

```solve
9:00am + 3 hours // 12:00:00 PM
11pm + 2 hours // 1:00:00 AM (+1 day)
7:30 to 20:45 // 795 minutes
2h 30m // 150 minutes
```

**[Time zones](/syntax/time-zones/)**: a time in another place, in several
places at once, and the office hours two places share. Without a date the answer
is today's; add `on 23 September 2026` to fix the day, since clocks change
through the year.

```solve
3pm London in Tokyo and New York // Tokyo 12:00 AM (+1 day), New York 11:00 AM
overlap of 9am to 5pm in London and New York // 4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM
3pm London on 23 September 2026 in Tokyo // 11:00 PM
```

**[Timesheets](/syntax/timesheets/)**: adding up hours worked from clock times or
spans, and paying them at an hourly rate.

```solve
9am to 5:30pm // 510 minutes
8:15 + 7:45 at £15/hour // £240.00
```

## Units

**[Unit arithmetic](/syntax/unit-arithmetic/)**: quantities in different units
add and subtract, with the answer in the first one's unit.

```solve
100cm + 2m // 300.00 cm
1 km + 500 m // 1.50 km
```

**[Multiplying and dividing units](/syntax/unit-algebra/)**: units multiply,
divide and cancel the way numbers do, so an area comes out in square metres and
a price per kilogram times a weight comes out in money.

```solve
5 m * 3 m // 15.00 m²
3 kg * $5/kg // $15.00
```

**[Cooking](/syntax/cooking/)**: oven gas marks, and the number to multiply a
recipe by when it has to serve a different number of people.

```solve
180C in gas mark // gas 4
scale 4 servings to 6 // 1.50
```

**[Converting units](/syntax/converting-units/)**: a quantity turned into
another unit with `to`, `in` or `into`.

```solve
5 km to miles // 3.11 miles
72F to C // 22.22 C
```

**[Other representations](/syntax/unit-representations/)**: `as` shows a value
in another form, such as a percentage or an exact fraction.

```solve
0.5 as % // 50.00%
0.75 as fraction // 3/4
```

**[Defining your own units](/syntax/custom-units/)**: a unit the engine does
not ship, named in terms of one it does.

```solve
1 sprint = 2 weeks // sprint defined
6 sprints in days // 84 days
```

**[CSS units](/syntax/css-units/)**: pixels and rems (a size relative to the
page's base font size) for front-end work, at the usual 16px base or one you
name.

```solve
16px in rem // 1.00 rem
```

**[Screen and image sizes](/syntax/screen-and-image-sizes/)**: the shape of a
screen or an image (its aspect ratio), and the other side after a resize.

```solve
1920x1080 as ratio // 16:9
resize 4000x3000 to 1200 wide // 1200 x 900
```

**[Rates & speeds](/syntax/rates-and-speeds/)**: units written with a slash,
such as km/h, converted like any other and multiplied or divided back into
distance and time.

```solve
100 km/h in mph // 62.14 mph
120 km / 60 km/h // 2.00 h
```

**[Travel](/syntax/travel/)**: what a journey burns in fuel, what it costs, and
how long it takes.

```solve
cost to drive 500 km at 7 l/100km at £1.50/litre // £52.50
250 miles at 60 mph // 4.17 h
```

**[Fuel economy](/syntax/fuel-economy/)**: miles per gallon and litres per 100
km, which run opposite ways (more miles per gallon is fewer litres per 100 km).

```solve
40 mpg in l/100km // 5.88 l/100km
```

**[Named derived units](/syntax/derived-units/)**: quantities multiplied into a
named physical unit, such as volts times amps into watts.

```solve
230 V * 13 A as W // 2,990.00 W
```

**[Electricity](/syntax/electricity/)**: volts, amps, ohms and amp-hours, with
Ohm's law, and the energy a battery holds.

```solve
12 V / 2 A // 6.00 Ω
3000 mAh * 3.7 V // 11.10 Wh
```

**[Energy units](/syntax/energy-units/)**: calories and kilocalories, BTU,
therms and electronvolts, beside joules and kilowatt-hours.

```solve
2000 kcal in kJ // 8,368.00 kJ
1 therm in kWh // 29.31 kWh
```

**[Pressure](/syntax/pressure/)**: pascals, bar, psi, atmospheres and
millimetres of mercury, from tyres to blood pressure.

```solve
32 psi in bar // 2.21 bar
120 mmHg in kPa // 16.00 kPa
```

**[Distances in space](/syntax/distances-in-space/)**: the astronomical unit,
the light-year and the parsec.

```solve
1 AU in km // 149,597,870.70 km
```

**[Moles](/syntax/moles/)**: the mole and the millimole, chemistry's count of
particles.

```solve
1 mol in mmol // 1,000.00 mmol
```

**[Surveying & older units](/syntax/surveying-units/)**: furlongs, chains, rods
and other historic units of length and mass.

```solve
1 furlong in m // 201.17 m
```

**[Geometry](/syntax/geometry/)**: the area, perimeter and volume of the common
shapes, from their dimensions.

```solve
area of circle radius 5 // 78.54
```

**[Health & fitness](/syntax/health/)**: body mass index (BMI, a weight measured
against a height), and the pace or speed of a run from its distance and time.

```solve
bmi(70 kg, 175 cm) // 22.86
pace(10 km, 50 min) // 5:00 /km
```

## Text

**[Text operations](/syntax/text-operations/)**: text in quotes, measured,
tested and reshaped: its length, its case, and what it contains.

```solve
length of "hello" // 5
"hello world" as upper // HELLO WORLD
```

**[Pasted text](/syntax/pasted-text/)**: the numbers, the amounts of money or
one field of JSON pulled out of text pasted from a receipt, a log or an API
response.

```solve
total of numbers in "Coffee 3.20, lunch 12.50, taxi 18" // 33.70
```

**[Text encoding](/syntax/text-encoding/)**: text turned into base64, a URL-safe
form or hex bytes and back again, which is how text travels through systems that
accept only certain characters.

```solve
"hello" as base64 // aGVsbG8=
```

**[Hashing](/syntax/hashing/)**: the digest of a piece of text, a short
fingerprint that changes completely when one character changes, used to check
that data arrived intact.

```solve
sha256("hello") // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

**[Networking](/syntax/networking/)**: IPv4 subnets, the blocks of addresses a
network is divided into: how many machines (hosts) one holds, its netmask and
broadcast address, and whether an address falls inside it.

```solve
hosts in 192.168.1.0/24 // 254
```

## Visual

**[Charts](/syntax/charts/)**: a series or a function turned into a chart. The
engine never draws: it describes the chart as data, and the host application
draws it.

```solve
plot x^2 from -3 to 3 // x^2 over [-3, 3]
```

**[Colours](/syntax/colours/)**: hex, rgb, hsl and named colours as values, with
functions to lighten, mix and check the contrast between them.

```solve
lighten(#3366cc, 20%) // #85a3e0
mix(#ff0000, #0000ff) // #800080
contrast(#ffffff, #000000) // 21
```

## Everyday

**[Coordinates, distance and bearing](/syntax/coordinates/)**: places on the
globe by latitude and longitude, and the distance and compass direction between
two of them.

```solve
London = 51.5074°N 0.1278°W // [51.51, -0.13]
Tokyo = 35.6762°N 139.6503°E // [35.68, 139.65]
distance from London to Tokyo // 9,558.57 km
```

**[Dice](/syntax/dice/)**: a random whole number in a range. `random seed` makes
the draws repeat, which is how this one can be checked.

```solve-doc
random seed 42
roll(1, 6) // 1
```

**[Randomness](/syntax/random/)**: random identifiers and choices: a uuid, random
hex, a pick from a list, a shuffle and a coin toss, repeatable after a seed.

```solve-doc
random seed 42
pick("north", "south", "east", "west") // east
coin // tails
```

## Live data

**[Weather](/syntax/weather/)**: the current conditions and temperature for a
place, as in `weather in London`, from a free service that needs no key. The
answer is live, so it is named here rather than checked.

**[Knowledge](/syntax/knowledge/)**: a plain-English question, as in
`ask: distance to the moon`, handed to an answering function the host application
supplies. The answer comes from that function, so it is named here rather than
checked.

**[Frozen answers](/syntax/frozen-answers/)**: `frozen` keeps a line's answer
fixed, with the day it was fixed, so a live rate in a shared note reads the same
later. It is shown on a plain sum here, since a live rate has no fixed answer to
check.

```solve-doc
:deposit = 250 * 4 frozen // 1,000
deposit + 50 // 1,050
```

## Working across lines

These forms read other lines of the note, so each is shown as a small note of
its own, worked out as one document.

**[Variables](/syntax/variables/)**: a name for a value, to use it again later,
written with or without a leading colon. `+=` and `-=` keep a running total, and
a function of your own is defined the same way.

```solve
:a = 10
:b = 20
:a + :b // 30

:budget = 500
budget -= 120 // 380
budget -= 63 // 317

f(x) = 2*x + 1
f(5) // 11
```

**[Line references](/syntax/line-references/)**: an earlier line read by its
number or its position, and the lines above totalled.

```solve-doc
10
20
30
total above // 60
line 1 * 2 // 20
```

**[Category tags](/syntax/category-tags/)**: a `#tag` in the middle of a line
labels its category and is left out of that line's own answer. `total of`,
`average of` and `count of` gather every line carrying the tag, and
`total by tag` breaks the whole note down. A tag starts with a letter, which
keeps it clear of a [colour](/syntax/colours/) such as `#c0ffee`.

```solve-doc
40 + 15 #grocery      // 55
12 #grocery           // 12
30 #fuel              // 30
total of #grocery     // 67
sum of #grocery       // 67
average of #grocery   // 33.50
count of #grocery     // 2
total by tag          // grocery 67 (69%) · fuel 30 (31%)
```

**[Sections](/syntax/sections/)**: the lines under a markdown heading, down to
the next heading at the same level or above, are its section, added up by the
heading's name from anywhere below it.

```solve-doc
# Travel
Flights: $450                 // $450.00
Hotel: $220                   // $220.00

# Summary
total of section "Travel"     // $670.00
sum of section "Travel"       // $670.00
average of section "Travel"   // $335.00
count of section "Travel"     // 2
```

**[Table columns](/syntax/table-columns/)** and
**[table lookups](/syntax/table-lookups/)**: a markdown table's column totalled
or averaged by its name, and one cell read by the label on its row, the way you
read a price off a list.

```solve-doc
| item | cost |
| ---- | ---- |
| rent | 1200 |
| food |  300 |
| taxi |   12 |
sum of column "cost" above       // 1,512
average of column "cost" above   // 504
column "cost" for "food"         // 300
```

**[Banded rates](/syntax/banded-rates/)**: a tax, commission or tariff schedule
written as a table of bands, where each rate applies only to the part of the
amount inside its band.

```solve-doc
| from   | rate |
| ------ | ---- |
| 0      | 0%   |
| 10,000 | 20%  |
| 40,000 | 40%  |
45,000 through bands above   // 8,000
```

**[Map, reduce & aggregates](/syntax/map-reduce-and-aggregates/)**: a range
written `start:end`, an expression applied to every item of a list, and a list
folded down to one value. A range is read only inside brackets or a function
call, since a bare `0:3` is a clock time.

```solve
map(10*x, 0:3) // [0, 10, 20, 30]
sum(x, 0:4) // 10
reduce(acc+x, [1,2,3]) // 6
```

**[Conditionals](/syntax/conditionals/)**: comparisons that answer true or
false, `and` and `or`, `if ... then ... else`, and `check`, which marks a line
stating something the note should keep true.

```solve
10 == 10 // true
if 5 > 3 then 100 else 200 // 100
check 1 km == 1000 m // ✓
```

**[Goal seek](/syntax/goal-seek/)**: working backwards to the input that makes
a line reach a target you name.

```solve-doc
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate   // 527.84
solve line 3 for deposit = 900                        // 170,507.23
```

**[Tracing inputs](/syntax/tracing-inputs/)**: which lines fed a result, and
which lines fed those.

```solve-doc
10
20
total above
line 3 * 2
inputs of line 4   // 60 (line 4) <- 30 (line 3) <- [10 (line 1), 20 (line 2)]
```

**[Trigger words](/syntax/trigger-words/)**: ordinary words such as `total` and
`sum` are not reserved keywords, so a variable can take one as its name.

```solve
:total = 100
:total + 5 // 105
```

**[What-if and sweeps](/syntax/what-if/)**: what a line would say if an input
were different, without editing the note, or its answers across a range of
inputs.

```solve-doc
deposit = 100000                                               // 100,000
rate = 4%                                                      // 4.00%
payment = monthly repayment on deposit over 25 years at rate   // 527.84
line 3 with deposit = 150000                                   // 791.76
line 3 for rate from 3% to 5% step 1%                          // [474.21, 527.84, 584.59]
```
