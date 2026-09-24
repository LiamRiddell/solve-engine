---
"solve-engine": minor
---

Primes, prime factorisation, modular arithmetic, `n choose k` and `5!`

The whole-number side of maths gains its missing pieces: primality, the next prime, prime factorisation, modular power and inverse, and the mathematical spellings of the factorial and of choosing. Every answer is exact at any size, building on the exact integers of #526.

| expression | before | now |
| --- | --- | --- |
| `isprime(97)` | error: Undefined function: isprime | true |
| `nextprime(2^53)` | error: Undefined function: nextprime | 9,007,199,254,740,997 |
| `factor(360)` | 360 | 2^3 * 3^2 * 5 |
| `modpow(7, 77, 13)` | error: Undefined function: modpow | 11 |
| `modinv(3, 11)` | error: Undefined function: modinv | 4 |
| `5!` | error: Unexpected trailing token | 120 |
| `10 choose 3` | error: Unexpected trailing token | 120 |
| `nCr(10, 3)` | error: Undefined function: nCr | 120 |

Primality is Miller-Rabin with the first thirteen primes as witnesses, a proof for every number below 3.3 × 10^24 and not fooled by Carmichael numbers such as 561. `factor` of a whole number writes its prime factorisation in a form that reads back as the number, trial division then Pollard's rho, and `factor` of an expression with an unknown still factors the polynomial. `modpow` never builds the power, so `modpow(2, 100, 1000000007)` answers at once. `!` is a postfix factorial binding as tightly as `%`, so `2^3!` is 2 to the power 6 and `-3!` is -6, and `choose` binds like `*`; `nCr`, `ncr` and `binomial` are names for `combination`, and `powmod` for `modpow`. A new page, "Primes, factors and counting", explains each, and documents the factorial, permutation and combination functions, which had no page.

The boundary: `factor` refuses a whole number above 2^64, since factoring is the one step whose cost grows faster than a number's length; above 3.3 × 10^24 `isprime` reports a strong probable prime rather than a proved one. `choose` becomes a keyword, so it cannot name a variable. The word `prime` still means an exponent (`x prime`), so `97 is prime` and a `prime(n)` for the nth prime are not forms here. A fraction, a zero to factor, a negative exponent for `modpow` and a number with no inverse are each refused by name.

`AlgebraSurface.spec.ts` pinned `factor(12)` as 12, the number handed back unchanged; it now asserts the factorisation.

## Verification

A new suite pins primality (including Carmichael numbers), the next prime, modular power and inverse, factorisations up to 2^64 - 1, every engine form, the read-back, the polynomial `factor` that is unchanged, the factorial and choose precedence, `!=`, and every refusal by code. `npm run verify:ci` passes: 10,709 tests across 517 suites.
