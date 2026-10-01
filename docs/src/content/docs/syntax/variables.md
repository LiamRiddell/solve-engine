---
title: Variables
description: Defining values, reading them back, and user-defined functions.
---

> **Package:** `VARIABLES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A colon prefix marks a definition explicitly.

```solve
:subtotal = 100
:subtotal * 2 // 200
```

A bare name also works, and behaves as the colon form does while the note is
edited: change the value a name is given, and every line that uses it follows.

```solve
count = 10
count + 5 // 15
```

That includes another bare definition, so changing `deposit` below updates
`payment`.

```solve-doc
deposit = 100
payment = deposit * 40 // 4,000
```

A name can be defined from one the note has not given a value yet. The
definition then holds a formula, an expression still waiting for its unknown,
and shows it as one. A line further down reads the formula with the value the
unknown has by then, so the answer is the one the lines would give in the other
order:

```solve-doc
y = x + 1   // x+1
x = 5       // 5
y + x       // 11
```

The formula is read with a plain number, or with another formula, which is
read the same way. An unknown that has since been given money, a quantity in a
unit, a date or text is refused by name, since the formula was written without
that unit and adding one to it would be a guess; define the unknown above the
line that uses it instead:

```solve-doc
y = x + 1   // x+1
x = $5      // $5.00
y + x       // ERROR: y was written as a formula in x before x had a value, and x now holds money, which the formula cannot take. Define x above the line that defines y.
```

A line above the definition of `x` still sees only the formula, and a `=>` line
keeps its unknowns as they are. A pair of formulas that each name the other has
no value to give, so each stays a formula.

A name can be a letter that is also a unit symbol, `m` for mass or `s` for
distance, as a physics formula would write it. A unit is always written after a
value (`9.81 m/s^2`), so where a name stands on its own, at the start of a line or
after an operator, it is read as your variable:

```solve-doc
m = 3
s = 2
m/s^2 // 0.75
9.81 m/s^2 // 9.81 m/s²
```

The capital `L` is the litre in the same way, so a variable named `L` is read as
the variable on its own and after an operator, and straight after a number it is
the unit: `2L` is two litres, not twice `L`. Write `2 * L` for the product. The
same goes for the other unit words, such as `amp`, `volts` and `therm`.

```solve-doc
L = 3
L * 2 // 6
2 * L // 6
2L // 2.00 L
```

A slash is an operator too, and a bare unit after one is otherwise read as a
rate: `100 / t` on its own is a hundred per tonne. When a variable of that name
is defined above the line, the slash divides by it instead, as it would by any
other name:

```solve-doc
distance = 120
t = 2
speed = distance / t // 60
```

What decides it is the line above, so defining or deleting `t` changes the
answer of every line that divides by it. A unit written before the slash keeps
the rate whatever the name holds, because a unit after a value is a unit:
`$15 / h`, `60 km / h` and `100 per h` are rates even with `h` defined.

```solve-doc
h = 4
100 / h // 25
$15 / h // $15.00/h
60 km / h // 60.00 km/h
```

A name that was never defined is an error, and when it is one or two letters
from a name that was, the error says so rather than quietly using it:

```solve-doc
budget = 100
budgte * 2 // ERROR: Undefined variable: budgte. Did you mean budget?
sqr(16) // ERROR: Undefined function: sqr. Did you mean sqrt?
```

## A value that is still arriving

Some values come from outside the note: a share price, an exchange rate, the
weather. The first time a line asks for one, the engine starts fetching it and
the line shows that it is waiting. A variable given such a value waits with it,
and so does every line that reads the variable: `:price = stock(AAPL)` and then
`price * 10` or `check price > 100` all show as waiting, rather than calling
`price` undefined, and all answer once the price arrives. A bare definition
(`price = stock(AAPL)`) waits and answers the same way.

The boundary: the waiting is only for a value that is on its way. A name the note
never defines is still undefined, and a fetch that fails answers with its
error on the line that asked for it.

## Names of several words

A name can be the words you would say, not only one word: `hourly rate`,
`monthly rent`, `take home pay`. The words become one name on the line that
defines it, the line that gives it a value with `=`, and from there on the same
words on any line below read as that name.

```solve-doc
hourly rate = $50 // $50.00
hours = 8 // 8
hourly rate * hours // $400.00
```

Where two names share words, the longest one the note defines is read first, so
a one-word name and a longer one that ends with it can sit side by side:

```solve-doc
rate = 5 // 5
hourly rate = $50 // $50.00
hourly rate * rate // $250.00
```

Only the line with the `=` makes the words a name, which is what keeps prose
from turning into one: words that no line defines stay the error they always
were, and a line above the definition does not read the name yet.

```solve-doc
hourly rate * 2 // ERROR: Expected an operator or the end of the line, but found "rate"
hourly rate = $50 // $50.00
```

A name is two to four plain words. A word the engine already reads cannot be
one of them, so a name never hides a unit, an operator or a phrase. A line that
would make one of those part of a name is refused by name, rather than read as
something else: `take` is a spelling of minus, and `take home = 5` used to be
stored quietly as the equation `-home = 5`.

```solve-doc
take home = 5 // ERROR: "take home" cannot be a name: "take" is a spelling of minus. Choose other words, or join them as take_home. For the equation, write -home = 5.
tax on = 5 // ERROR: "tax on" cannot be a name: "tax on" is a phrase the engine reads. Choose other words, or join them as tax_on.
```

The same holds for an operator word at the end of the words. `monthly take`
cannot be a name, because the line below it would then read `take` two ways:
as part of the name in `monthly take * 12`, and as minus in `monthly take 500`,
which subtracts 500 from `monthly`. An operator with nothing after it is not
arithmetic either, so the line is refused by name, with the word and what it
means, rather than reported as a sum that stops too early. Joining the words
with an underscore, or choosing another word, makes a name that works.

```solve-doc
monthly take = 4000 // ERROR: "monthly take" cannot be a name: "take" is a spelling of minus. Choose other words, or join them as monthly_take.
monthly_take = 4000 // 4,000
monthly pay = 4000 // 4,000
```

### Possessives

A possessive, the `'s` that says whose something is, can be part of a name:
`Alice's food`, `the Smiths' rent`. An apostrophe straight after a letter
belongs to its word, whether it sits inside the word or ends it. Either
apostrophe will do. The straight `'` a keyboard types and the curly `’` a phone
or a word processor puts in its place are the same apostrophe in a name, so a
name typed with one is read when it is typed with the other.

```solve-doc
Alice's food = £30 // £30.00
Bob’s food = £20 // £20.00
Alice’s food + Bob's food // £50.00
the Smiths' rent = £900 // £900.00
the Smiths' rent / 3 // £300.00
```

A mark that only looks like an apostrophe is refused by name rather than made
part of a name, since it would make a second name that reads the same as the
first: an opening quotation mark `‘`, or the prime `′` that marks feet and
minutes of arc. So is an apostrophe before a word's first letter, since a word
in a name starts with a letter.

```solve-doc
Alice‘s food = 3 // ERROR: "Alice‘s food" cannot be a name: "‘" in "Alice‘s" is a quotation mark, not an apostrophe. Write the apostrophe as ' or ’.
’tis rate = 5 // ERROR: "’tis rate" cannot be a name: "’tis" starts with an apostrophe, and a word in a name starts with a letter.
```

The boundary: a straight apostrophe after a digit or an underscore, or before a
word, is not read as part of anything and is skipped, as any stray mark is, so
`'rent'` reads as the word `rent`. A name of one word may hold an apostrophe
too, as `O'Brien = 4` does.

The boundary: the words are matched as written, so `Hourly rate` is another
name from `hourly rate`, as `Rate` is from `rate`. The colon forms `:name` and
`global :name` keep their one-word name. A line with more than four words
before its `=` is left as it was, since that is more often a sentence than a
name.

## Running totals

`+=` and `-=` update a named total in place, so a note becomes a running balance
where each line adjusts the last.

```solve
:budget = 500
budget -= 120 // 380
budget -= 63 // 317
budget // 317
```

A first `+=` or `-=` on a name that has not been set yet starts it at zero, so a
ledger can open straight into a spend.

```solve
spent += 40 // 40
spent += 12 // 52
```

`*=` and `/=` do the same by multiplying and dividing, for a balance that grows by
a rate or a quantity cut down in place. Money stays exact to the penny and a unit
stays its unit.

```solve
:balance = $1000
balance *= 1.05 // $1,050.00
balance *= 1.05 // $1,102.50
```

```solve
:length = 10 m
length /= 4 // 2.50 m
```

There is no starting value for a product: zero would make every product zero, so
a first `*=` or `/=` on a name that has not been set is refused as an undefined
variable, where `+=` and `-=` start from zero.

The compound forms apply to bare names, not the colon `:name` or `global :name`
grammars, and the right-hand side keeps its own precedence, so `budget -= 1 + 2`
subtracts three and `balance *= 1 + 0.05` multiplies by 1.05.

## Functions

A function is a formula with a name and a blank to fill in, written once and
used as often as needed. Write the name, the blank (the parameter) in brackets,
`=`, and the formula; then give the name a value in brackets and it works the
formula out with that value in the blank.

```solve
f(x) = 2*x + 1
f(5) // 11
```

Parameters are scoped to the call, so a parameter named `x` never disturbs a
variable named `x` defined elsewhere in the document.

```solve
:x = 100
double(x) = x * 2
double(5) // 10
```
