---
"solve-engine": minor
---

Operations spelled out in words.

Every one of these already existed as a symbol or a function call. What was missing was the spelling anyone reaches for when writing a calculation rather than typing one:

```
3 multiplied by 4        12
1,000 divided by 200     5
greater of 100 and 200   200
lesser of 5 and 10       5
gcd of 20 and 30         10
lcm of 5 and 8           40
square root of 81        9
cube root of 27          3
```

No new maths: `gcd of 20 and 30` calls the same builtin as `gcd(20, 30)`, and `square root of 81` the same one as `sqrt(81)`. The gap was grammar, not capability, and the function forms are untouched.

All of them are fused two-word phrases rather than bare keywords, so `:greater` and `:lesser` remain usable as variable names. `larger of 1 + 1 and 3` also parses now, which the operand slot could not express while `and` was still the `+` token.
