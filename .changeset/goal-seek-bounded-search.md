---
"solve-engine": patch
---

A goal seek finishes, whatever its target is

Goal seek reads its target as an exact rational, and an ordinary floating-point
sum is not a tidy one. `0.1 + 0.2` is `0.30000000000000004`, whose denominator is
around 10^17, and the rational-root search begins by trial-dividing to the square
root of that: about 1.7 billion candidates. The loop is synchronous, so no
timeout, watchdog or test deadline could interrupt it, and the path it sits on is
the one a live editor drives on every keystroke.

| document | before | now |
| --- | --- | --- |
| `0.1` / `0.2` / `solve line 2 for x = total above` | 12,584 ms, then a refusal | 2 ms, `-4.85` |
| `1.1 + 2.2` / `solve line 2 for x = prev` | 7,000 ms, then a refusal | 1 ms, `-3.35` |
| `1 / 3` / `solve line 2 for x = prev` | 7,944 ms, `-4.833333333333334` | 1 ms, `-4.833333333333334` |
| `1e-320` / `solve line 2 for x = prev` | never returned | 1 ms, `-5` |

Two changes, and the first is why the answers are better rather than only faster.

**A line has one root and it is closed form.** `bx + c` is zero at `-c/b`.
Reaching for the rational-root theorem at degree one means factoring both
coefficients to rediscover a division, which is exactly where the time went. It
is answered directly now, so the first two rows above go from a twelve-second
refusal to the correct negative root. Those roots lie outside the numeric
bisection range, which is why only the exact route could ever find them, and why
the third row had to keep the answer it already gave.

**A candidate cap for everything above degree one.** The existing limit bounds
the divisors *found*, which stops a highly composite coefficient; it does nothing
for the opposite shape, where a value with very few divisors runs the whole trial
division to find none. A hundred thousand candidates costs about five
milliseconds and factors any magnitude up to 10^10 completely, which is every
coefficient a written expression produces. Past that the value is float noise
rather than something anyone typed, and the caller already treats "not factorable
this way" as a fallback.

`parseDocument` and `evaluateExpression` were never affected: they refuse goal
seek with `GOAL_SEEK_NO_DOCUMENT` in a millisecond or two.
