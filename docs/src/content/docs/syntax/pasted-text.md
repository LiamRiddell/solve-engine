---
title: Pasted text
description: "Pull what matters out of a receipt, a log line or an API response: every number in it, the amounts of money, the part a pattern matches, or one field of JSON."
---

> **Package:** `TEXT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A notepad is where people paste things: a receipt, a line from a server log, the
answer an API sent back. Pasted in quotation marks, that is text, a run of
characters, and the numbers in it are characters too until something reads them.
This page is the reading. It finds every number in a piece of text so you can
total it, picks out the amounts of money, pulls out the part of a line that fits
a pattern, and reads one named value out of JSON.

Pasted text is only ever searched. Nothing in it is run as an expression, so a
receipt that happens to contain `2 + 2` is two numbers, not a sum.

## Every number in a piece of text

`numbers in` reads a piece of text and lists every number written in it, in the
order they appear. Put an aggregate in front of it (`total of`, `average of`,
`count of`, and the rest) and the aggregate reads those numbers directly, so a
pasted receipt totals without retyping a figure.

```solve
numbers in "Coffee 3.20, lunch 12.50, taxi 18" // [3.20, 12.50, 18]
total of numbers in "Coffee 3.20, lunch 12.50, taxi 18" // 33.70
average of numbers in "Coffee 3.20, lunch 12.50, taxi 18" // 11.23
count of numbers in "Coffee 3.20, lunch 12.50, taxi 18" // 3
```

Every list aggregate on the [statistics page](/syntax/statistics/) works this
way: `total of` (or `sum of`), `average of`, `median of`, `count of`,
`spread of`, `mode of`, and the standard deviations and variances. The text is
whatever value comes next: a quoted string, a variable holding one, or another
form that returns text. On its own, `numbers in` gives a list, which the
functions that take a list, such as `sum` and `map`, read as they read any
other.

```solve
sum(x, numbers in "3 4 5") // 12
```

### What counts as a number

A number is a run of digits, with an optional fraction after the decimal mark.
Thousands may be grouped, but only in threes and only after a first group of
one to three digits, so `1,234,567.89` is one number and `1,2345` is two. A
fraction can stand alone after a space, as in `.50`.

A minus sign makes a number negative only when it stands in front of it. Between
two numbers or two words a hyphen is a hyphen, so `10-20` is a range written as
two numbers, not ten minus twenty.

Only the number itself is read. A percentage sign, a unit or a date is left
behind, so `15%` is 15, `3 kg` is 3, and `23/09` is 23 and 9.

```solve
numbers in "1,234,567.89 and 7" // [1,234,567.89, 7]
numbers in "costs .50" // [0.50]
numbers in "a -5, b 10-20" // [-5, 10, 20]
numbers in "15% off 3 kg" // [15, 3]
numbers in "Meeting on 23/09 at 14:05" // [23, 9, 14, 5]
```

### The number format is the engine's

`1.234,56` is one number to a German reader and two to an English one. Rather
than guess from the text, `numbers in` reads it in the number format the engine
is configured with, the same one it reads typed numbers in. An engine created
with `createEngine({ locale: "de" })` marks the decimal with a comma and groups
thousands with a point, so it reads `Kaffee 3,20, Mittag 12,50` as 3.20 and
12.50, and `1.234,56` as one thousand two hundred and thirty-four and a bit. A
French engine groups with a space, including the narrow no-break space that a
number copied from a French web page carries. An English engine reads
`1.234,56` as 1.234 and 56, because that is what those characters mean in
English.

## Amounts of money

`amounts in` is `numbers in` with only the amounts of money kept: the numbers
with a currency sign or a currency code beside them. A receipt usually mixes
quantities with prices, and adding the quantities to the prices gives a number
that is neither, so this is the form for totalling what was spent. The total
keeps the currency.

```solve
amounts in "2 coffees £3.20, 1 cake £2.50" // [3.20, 2.50]
total of amounts in "2 coffees £3.20, 1 cake £2.50" // £5.70
total of numbers in "2 coffees £3.20, 1 cake £2.50" // 8.70
```

The last line shows the difference: `numbers in` counted the 2 coffees and the 1
cake as well.

A currency can be written before the amount or after it, touching it or one
space away, as a sign (`£`, `$`, `€`, `¥`, `₹` and the other signs the engine
knows) or as a three-letter code (`EUR 950`, `120 EUR`). A minus in front of the
sign makes the amount negative.

```solve
total of amounts in "Rent EUR 950, bills 120 EUR, fees €12.50" // €1,082.50
amounts in "-£5 refund, £20 charge" // [-5, 20]
```

A sign that sits between two numbers belongs to the one it touches, so `2 £5`
is a count of two and five pounds. The list shows the amounts as plain numbers,
because a list holds plain numbers; the currency is kept by the aggregates,
which read the amounts themselves.

The boundary, and why:

- **Only the common codes are read.** A code is read when it is one of the
  currencies the engine shows with a sign of its own (USD, GBP, EUR, JPY, CHF,
  AUD, CAD and the like). Many three-letter capitals are also currency codes
  (`ALL`, `TOP`, `CUP`, `AMD`), and `TOP 10` is not ten Tongan pa'anga. A rarer
  currency is read from its sign, or not at all.
- **`$` is the US dollar**, as it is everywhere else in the engine.
- **Two currencies do not add without a rate.** `total of amounts in "€3 and $4"`
  converts at the current exchange rate when the engine has one, and is refused
  as incompatible units when it has not, exactly as `total of €3, $4` is.

## Matching a pattern

Sometimes the number you want is one particular number: the order number, not
the quantity; the time a request took, not its status code. A **pattern**, or
regular expression, describes the shape of the text around it rather than the
exact text. `\d+` means one or more digits, so `#(\d+)` means a hash followed by
digits, and the brackets mark the digits as the part you want back.

`match(text, pattern)` returns that part: the text inside the first bracketed
group that took part in the match, or the whole match when the pattern has no
group. The answer is text; add `as number` to calculate with it.

```solve
match("Order #4471 shipped", "#(\d+)") // 4471
match("Order #4471 shipped", "#\d+") // #4471
match("Total: £12.50 paid by card", "Total: (\S+)") // £12.50
match("GET /api/orders 200 35ms", "(\d+)ms") as number // 35
```

`matches(text, pattern)` asks whether the pattern occurs at all, and
`matchcount(text, pattern)` how many times, counting matches that do not
overlap.

```solve
matches("2026-09-23", "^\d{4}-\d{2}-\d{2}$") // true
matches("23/09/2026", "^\d{4}-\d{2}-\d{2}$") // false
matchcount("GET 200, GET 404, POST 200", "\b200\b") // 2
```

Starting a pattern with `(?i)` makes letters match regardless of case, which
suits log lines that shout.

```solve
match("ERROR disk full", "(?i)error (.+)") // disk full
```

### The pattern syntax

The syntax is JavaScript's. A pattern copied from a JavaScript program that uses
only what the table lists finds the same text here, with the same groups; the
one difference is how a character is counted, just below.

| Pattern | Matches |
| --- | --- |
| `abc` | those characters, in that order |
| `.` | any one character except a line break |
| `\d`, `\w`, `\s` | a digit; a word character (letter, digit or underscore); a space. `\D`, `\W` and `\S` match anything else |
| `[abc]`, `[a-z]`, `[^abc]` | one of the listed characters; one in the range; any character not listed |
| `x*`, `x+`, `x?` | any number of `x`, including none; one or more; none or one |
| `x{3}`, `x{2,5}`, `x{2,}` | exactly three; between two and five; two or more |
| `x*?`, `x+?`, `x{2,5}?` | the same, taking as few as it can rather than as many |
| `(...)`, `(?<name>...)` | a group whose text is captured, named or not |
| `(?:...)` | a group that is not captured |
| `a\|b` | `a` or `b`, preferring `a` |
| `^`, `$` | the start and the end of the text |
| `\b`, `\B` | the edge of a word; anywhere that is not one |
| `\.`, `\$`, `\(` | a character that would otherwise have a meaning, as itself |

A character is a Unicode code point, so `é` or a single emoji is one character
to `.`, where JavaScript without its `u` flag would count an emoji as two
halves. A thumbs-up with a skin tone is two code points, the thumb and the tone,
so it is two characters to a pattern, where the
[text operations](/syntax/text-operations/) count it as the one a reader sees.

### What a pattern cannot do, and why

A matcher that tries one way of matching at a time and backs up when it fails,
as JavaScript's does, can take exponential time on the wrong pattern. Given
`(a+)+$` and a run of letters ending in a full stop, it tries every way of
sharing the letters between the two loops, and each further letter doubles the
work: in Node.js, twenty-six letters take over half a second and thirty-six
around ten minutes. A pasted text and a hand-typed pattern are exactly the pair
nobody checks first, so the patterns here run on a matcher that tries every way
at once and reads each character only once. Forty letters answer at once:

```solve
matches("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "(a+)+$") // false
```

That guarantee rules out two features, which are refused by name rather than
approximated. A **backreference** (`\1`) asks whether the text repeats
something matched earlier, and no matcher can promise to answer that quickly.
**Lookahead and lookbehind** (`(?=...)`, `(?<=...)`) test the text around a
position without moving past it, which a single pass that reads each character
once has no way to do. The only flag is `(?i)`, and only at the start.

```solve-doc
match("abab", "(ab)\1") // ERROR: match: in the pattern "(ab)\1", a backreference such as \1 is not supported: no matcher can promise to answer one in time proportional to the text, and this one makes that promise
match("abc", "(a") // ERROR: match: in the pattern "(a", the pattern has a "(" that is never closed
match("abc", "x") // ERROR: match: the pattern "x" does not occur in the text
```

The work is bounded as well as fast. A pattern may be 500 characters long, with
up to 32 captured groups and repeat counts up to 1,000, and the pattern forms on
one line may take 5,000,000 steps between them before the line is refused with
`TEXT_PATTERN_TOO_COSTLY`. An ordinary pattern over a pasted line takes a few
thousand.

## A field of JSON

**JSON** is the text format most web services answer in: names in quotation
marks, each paired with a value, and values that can be lists or further
groups of names, as in `{"order": {"total": 12.5, "items": [...]}}`. The
`jwt` and `query` forms on the [text encoding page](/syntax/text-encoding/) hand
back what they decode as JSON. `field(json, "name")` reads one value out of it.
A value that JSON holds as a number comes back as a number; a query string holds
every value as text, so a count read from one is converted with `as number`
before it is added to (see [text operations](/syntax/text-operations/)).

```solve
field(query("name=John+Doe&page=2"), "name") // John Doe
field(query("name=John+Doe&page=2"), "page") as number + 1 // 3
field(jwt("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"), "name") // John Doe
```

A value inside another is reached by a **path**: names joined by dots, and a
list entry by its position in square brackets, counting from 0, so
`order.items[0].price` is the price of the first item in the order. JSON typed
into a line has each of its quotation marks written `\"`, and `field` reads it
as the JSON it spells.

```solve
field("{\"order\": {\"paid\": true, \"items\": [{\"name\": \"tea\", \"price\": 3.5}, {\"name\": \"cake\", \"price\": 4}]}}", "order.items[0].price") // 3.50
field("{\"order\": {\"paid\": true, \"items\": [{\"name\": \"tea\", \"price\": 3.5}, {\"name\": \"cake\", \"price\": 4}]}}", "order.items[1].name") // cake
field("{\"order\": {\"paid\": true, \"items\": [{\"name\": \"tea\", \"price\": 3.5}, {\"name\": \"cake\", \"price\": 4}]}}", "order.paid") // true
```

A number comes back as a number, a string as text and `true` or `false` as a
boolean. A list or a group of names comes back as its JSON, which can be read
further, or handed to `numbers in`:

```solve
total of numbers in field("{\"prices\": [3.5, 4, 2.25]}", "prices") // 9.75
```

A path that leads nowhere is refused with the names that are there, so a
misspelling shows its correction. A field holding `null` is refused too, since
it holds no value, and so is a whole number past 9,007,199,254,740,991, which
the engine's numbers cannot hold exactly; `match` reads its digits as text
instead. Text that is not JSON is refused with a pointer to `match`, which is
the tool for a label in ordinary text such as `Total: 12`.

```solve-doc
field(query("name=John+Doe&page=2"), "nme") // ERROR: The JSON has no "nme": at the top its fields are "name", "page"
field("{\"note\": null}", "note") // ERROR: The field "note" is null: it holds no value
```

The boundary: a name that itself contains a dot or a square bracket cannot be
reached by a path, since both mean a step down.

## Refusals, by code

Each form answers or refuses with a named error a host can read without parsing
the sentence. None throws, and none answers with a guessed number.

| Code | Meaning |
| --- | --- |
| `TEXT_EXPECTED` | a form was given something other than text where it reads text |
| `TEXT_ARGUMENT_COUNT` | `match`, `matches`, `matchcount` or `field` was given other than two arguments |
| `TEXT_NO_NUMBERS`, `TEXT_NO_AMOUNTS` | the text holds no numbers, or no amounts of money (`count of` answers 0 instead) |
| `TEXT_TOO_MANY_NUMBERS` | the text holds more than 10,000 numbers, the limit for one read |
| `TEXT_NO_MATCH` | `match` found no place the pattern occurs |
| `TEXT_PATTERN_INVALID` | the pattern is not well formed |
| `TEXT_PATTERN_UNSUPPORTED` | the pattern uses a backreference, lookaround, or another feature this matcher refuses |
| `TEXT_PATTERN_TOO_LARGE` | the pattern is past a size limit |
| `TEXT_PATTERN_TOO_COSTLY` | the pattern forms on one line took more than 5,000,000 steps |
| `TEXT_NOT_JSON` | `field` was given text that is not JSON |
| `TEXT_FIELD_PATH_INVALID` | the path is empty or badly written, such as `a..b` |
| `TEXT_FIELD_NOT_FOUND` | the path leads nowhere in the JSON |
| `TEXT_FIELD_NULL` | the field holds `null` |
| `TEXT_FIELD_INEXACT_NUMBER` | the field holds a whole number too large to read exactly |
