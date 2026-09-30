---
"solve-engine": patch
---

A time held in a variable converts from the zone named after it: `t London in Tokyo`, with `t = 3pm`

The clock-time form, `3pm London in Tokyo`, reads its source zone inside its own parselet, straight after the time it wrote out, and a time held in a variable had no such reading. Worse, `t` is also a teaspoon, so the ingredient rule read "london" as a substance measured in teaspoons and asked for a mass or a volume. `zoneAfterNameNormalizerRule` now retypes the zone after a variable, or after a closing bracket, in the whole shape `<name> <zone> in <zone>`, an infix parselet reads the time before it, and `zoneConvertNamedHandler` answers as the clock-time form does, down to the day shift and the refusal of a skipped or repeated reading. The ingredient rule leaves a unit spelling alone where a value starts, since there it is a name the reader chose. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `t = 3pm`, then `t London in rio de janeiro` | Expected a value with a mass or volume unit (e.g. "300g", "10 cups"), got a plain number | 11:00 AM |
| `t = 3pm`, then `t London in Tokyo, New York` | Expected an operator or the end of the line, but found "," | Tokyo 11:00 PM, New York 10:00 AM |
| `t = 3pm`, then `(t + 1 hour) London in Tokyo` | Undefined variable: London | 12:00 AM (+1 day) |
| `t = 5`, then `t London in Tokyo` | the same cooking error as the first line | A zone after a name converts the time of day it holds, as in "t London in Tokyo" with t = 3pm, and this holds a number. |

The boundary: the zone must be a name the zone table lists and must be followed by `in` and another zone, so `x cat in kg`, a variable named `london`, and `2 cups butter in grams` are read as before. The numeric `UTC+5` spelling after a variable is not read here; the clock-time form keeps it. The time-zones page shows the variable form, proven, and the refusal. `TIME_ZONE_EXPECTED_TIME` is a new code in the timezone catalogue.

## Verification

`FoundBug_zoneAfterTimeVariable.spec.ts` (17 tests) holds the lines above, agreement with the clock-time form, the cooking and variable forms unchanged, unit tests of `namesListedZone`, `endsNamedTime`, `zoneAfterNameAt`, the rule, the ingredient rule's new check and `zoneConvertNamedHandler` (a failed or pending time passed through, a number, text, nothing, a time outside the calendar, a skipped reading), and the adversarial sides: prototype words as the variable and both zones, two hundred target zones, markup, a typo in the zone, both passes and the single-line path, every numeric edge as the variable's value, a date with a time, and CRLF. The adversarial sweep gains the form's two document templates.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
