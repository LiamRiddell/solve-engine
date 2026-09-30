---
title: "Cooking"
description: Oven gas marks, and scaling a recipe up or down by its servings.
---

> **Package:** `COOKING_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Two things a recipe asks for that are not ordinary conversions: reading an oven's gas mark, and working out how much of everything to use when you are cooking for a different number of people.

## Gas marks

A British gas oven is not marked in degrees. Its dial runs from a quarter up to nine, and each mark stands for an oven temperature: gas mark 4 means 180°C. That makes it a lookup rather than a sum, because the steps are uneven, so there is no formula to apply. Write the temperature and ask for the mark, or write the mark and ask for the temperature.

```solve
180C in gas mark // gas 4
350F in gas mark // gas 4
gas mark 4 // 180.00 C
gas 6 // 200.00 C
```

`gas mark 4` and `gas 6` mean the same thing, because a recipe writes it both ways. The answer is an ordinary temperature, so it converts onwards like any other.

```solve
gas 6 in F // 392.00 F
```

The answer to `in gas mark` is text, not a number, because "gas 4" is what the dial says. That also keeps the two fractional settings readable: 110°C is `gas 1/4`, which is a dial position rather than the number a quarter. Read the other way, `gas 1/4` is that one setting, so it stands for its own temperature rather than being a quarter of gas 1.

```solve
gas 1/4 in C // 110.00 C
gas 1/2 in C // 120.00 C
```

### The table

These are the standard British figures, as printed on cooker dials.

| Gas mark | °C | | Gas mark | °C |
| --- | --- | --- | --- | --- |
| 1/4 | 110 | | 5 | 190 |
| 1/2 | 120 | | 6 | 200 |
| 1 | 140 | | 7 | 220 |
| 2 | 150 | | 8 | 230 |
| 3 | 170 | | 9 | 240 |
| 4 | 180 | | | |

A temperature between two marks is read as the nearer one, within ten degrees, which is half the widest step in the table. Further out than that is not a gas setting at all, and saying so is more use than naming a mark the oven cannot reach.

```solve
300C in gas mark // 300C is not a gas setting: the dial runs from gas 1/4 (110C) to gas 9 (240C)
```

## Which cup

A cup is not one size. A recipe measures by the cup of the country it was
written in, and the three in common use differ by about a fifth from smallest to
largest, which is enough to spoil a cake.

- The **US cup**, 236.59 millilitres, is the one American recipes and most online
  converters mean. A bare `cup` is this one, and `US cup` names it explicitly.
- The **metric cup**, 250 millilitres, is the one recipes from Australia, New
  Zealand and Canada use. Write it `metric cup`.
- The **imperial cup**, half an imperial pint (284.13 millilitres), is the one an
  older British recipe means. Write it `imperial cup`.

```solve
1 cup in ml // 236.59 ml
1 US cup in ml // 236.59 ml
1 metric cup in ml // 250.00 ml
1 imperial cup in ml // 284.13 ml
```

Each takes a plural, a mixed number and an ingredient like any other volume, so a
recipe's quantities convert as written:

```solve
2 metric cups flour in grams // 265.00 grams
1 1/2 metric cups in ml // 375.00 ml
300g butter in metric cups // 1.25 metric cups
2 imperial cups in imperial pints // 1.00 imperial pints
```

The two words are read as one unit only together, and only in that case: `US`
is upper case (`us` is an English word), and `metric` or `imperial` on its own
is still an ordinary word, or a name you have defined.

The boundary: a bare `cup` stays the US cup, because changing it would move
every recipe answer already written. The engine does not choose a cup from your
locale, and the metric tablespoon and teaspoon (the same question one size down)
are not spelled; `tbsp` and `tsp` are the US spoons.

## Mixed numbers

A recipe is written in mixed numbers rather than decimals, so a whole number and
a fraction beside it read as the single quantity they are, and carry a unit like
any other number.

```solve
1 1/2 cups in ml // 354.88 ml
2 1/4 kg in lb // 4.96 lb
```

The fraction can be one of the characters a keyboard offers, on its own or after
a whole number:

```solve
½ tsp in ml // 2.46 ml
2 ½ cups in ml // 591.47 ml
¼ // 0.25
```

`and` between the two parts reads the same way when a unit follows, which is the
spelling that used to answer wrongly: `1 and 1/2 cups` was read as one plus half
a cup.

```solve
1 and 1/2 cups in ml // 354.88 ml
```

### What is deliberately left alone

`+` is not `and`. A sum written as a sum stays a sum, so `1 + 1/2 cups` is one
plus half a cup, which is a different quantity and an answer nobody should have
changed underneath them.

```solve
1 + 1/2 cups in ml // 119.29 ml
```

The hyphenated `1-1/2` is ambiguous against subtraction and is left as the
subtraction it reads as, and none of this changes how a fraction prints:
`1.5 as fraction` is still `3/2`. See [fractions](/syntax/fractions/).

## Scaling a recipe

A recipe serves four and six people are coming. What you need is the number to multiply every quantity by, and that is what this gives you.

```solve
scale 4 servings to 6 // 1.50
scale 6 servings to 4 // 0.67
```

The word for what you are counting is yours to choose, and you can leave it out.

```solve
scale 4 people to 10 // 2.50
scale 2 to 5 // 2.50
```

The factor is a plain number, so it multiplies whatever you write beside it, or the line above it.

```solve-doc
:factor = scale 4 servings to 6 // 1.50
300g * factor // 450.00 g
200g * factor // 300.00 g
```

This is a factor, not a recipe parser. It will not read a block of ingredients and rewrite them; it gives you the number, and you apply it to the quantities you care about.

## What is not here

Converting an ingredient between cups and grams already works, because the units know what common ingredients weigh, and Fahrenheit to Celsius is an ordinary unit conversion. Neither needed this page.

```solve
2 cups flour in grams // 250.78 grams
300g butter in cups // 1.32 cups
180C in F // 356.00 F
```

`gas` and `scale` stay ordinary words everywhere else. They are only read as cooking when the rest of the phrase is there: a number after `gas`, and a full `scale ... to ...` around `scale`. So `:scale = 1.5` still defines a variable, and a line about a gas bill is still a line about a gas bill.
