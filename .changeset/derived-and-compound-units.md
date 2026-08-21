---
"solve-engine": minor
---

Rates written in slash notation now convert.

`100 kph in mph` answered **62.14 mph**, but `100 km/h in mph`, the same speed spelled the way it is read off a sign, answered **INCOMPATIBLE_UNITS**. The lexer split `km/h` into three tokens, so the compound was never one unit, and nothing could convert a rate once it was built.

A slash between two units is now one unit whose spelling is the rate, and a rate converts to another rate, or to any single-word speed spelling, by converting the numerator and the denominator on their own:

```
100 km/h in mph            was INCOMPATIBLE_UNITS,  now 62.14 mph
10 m/s in km/h             was INCOMPATIBLE_UNITS,  now 36.00 km/h
60 mph in km/h             was INCOMPATIBLE_UNITS,  now 96.56 km/h
100 km/h to m/s            was 60.00 km/h (silent), now 27.78 m/s
120 km / 2 hours in kph    was INCOMPATIBLE_UNITS,  now 60.00 kph
```

The last one needed a second fix. A unit literal that is the right operand of `*` or `/` no longer swallows a trailing `in`/`to`, so `120 km / 2 hours in kph` groups as `(120 km / 2 hours) in kph` rather than dividing by an incompatible conversion. The same correction fixes negative quantities on offset scales, where the sign used to land on the converted number: **`-40 C in F` is now -40 F**, not -104.

A numbered denominator is still a division, not a fused unit, so `90 km / 3 day` is unchanged, and rate arithmetic (`$50/hour * 3 hours` is `$150.00`) is untouched.

Naming a compound derived unit on output, `9.81 m/s^2 * 70 kg` as `N` rather than `kg*m/s^2`, is deliberately left for a later slice: this change makes the rate a first-class value to hold and convert, which is what the written-out speeds needed.
