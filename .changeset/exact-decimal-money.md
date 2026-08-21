---
"solve-engine": minor
---

Money is exact. A price is a decimal, not a binary fraction.

A currency value was an IEEE double underneath, so representation error reached a user who had only typed two prices. `$0.10 + $0.20` carried `0.30000000000000004`, and `$1.005` displayed as `$1.00`, because the double handed to `toFixed` already sat below the value that was typed. That is the one class of wrong answer a calculator you can write money in cannot afford.

Amounts in a currency now carry an exact base-ten decimal (a bigint coefficient and a scale) alongside the double. Same-currency `+`, `-`, `*`, `/` and comparison read it, so the arithmetic is exact and a half-cent rounds away from zero the way a till rounds it:

```
$0.10 + $0.20    was 0.30000000000000004, now $0.30
$19.99 * 3       was $59.97 over a drifting double, now exactly $59.97
$100 - $99.99    was 0.010000000000005116, now $0.01
$0.70 * 1.10     now exactly $0.77
$10 / 3          now $3.33
$1.005           was $1.00, now $1.01
$2.675           was $2.67, now $2.68
```

The boundary is deliberate. Exactness holds wherever a currency is involved, a currency against a plain number included. A bare decimal on its own is unchanged, so `0.1 + 0.2` is still `0.30000000000000004` and `sqrt(2)^2` is still float. A conversion between two currencies goes through a live rate, which is a double, so it is not exact.

The double is still there: reading a money value as a number through `.value` or `toNumber()` is unchanged, except that the double is now the correctly-rounded image of the exact amount (`0.3` rather than the drifted sum). Money is still a unit-of-measurement value, so every existing currency path, conversion, formatting and rate arithmetic is untouched.
