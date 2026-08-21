---
"solve-engine": minor
---

Successive percentage changes, written as a sentence.

**`120 up 10% then down 10%` is 118.80, not 120.** This is the arithmetic people misread most often, and the person writing it out by hand is exactly the person who reaches for 120. The 10% down comes off the larger 132, not the original 120, so the changes do not cancel. A calculator that reads like a sentence is the right place for the correct answer to be visible.

`up N%` and `down N%` apply a percentage change to a value, `then` chains them so each change lands on the running total, and `N times` repeats a step:

```
120 up 10% then down 10%   118.80   (the intuitive answer is 120)
50 up 20%                  60
80 down 15%                68
100 up 10% three times     133.10
```

Each step is `value * (1 ± N%)`, the same arithmetic as `increase value by N%`, so a chain is that step applied to the running total again and again. `then` is optional connective (`120 up 10% down 10%` reads the same), and the count in `N times` may be a digit or a word.

The unit rides along, so `$300 up 10% then down 10%` is `$297.00`.

`up` and `down` are ordinary English words, so they become operators only directly before a percentage, the one place `up 10%` can only mean a change. Prose that merely mentions them (`prices are up`, `scroll down`) and variables named after them are left alone, the same guard the `on`/`off` markup rule already relies on.
