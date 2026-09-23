---
title: "Primes, factors and counting"
description: Prime numbers, prime factorisation, remainders on huge powers, factorials and choosing.
---

> **Package:** `FUNCTION_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

This is the part of maths that works on whole numbers only: which numbers are
prime, how a number breaks into primes, what remainder a huge power leaves, and
how many ways there are to arrange or choose things. Every answer is exact,
however large the numbers get (see [big integers](/syntax/big-integers/)).

## Primes

A **prime** is a whole number greater than 1 that only 1 and itself divide: 2, 3,
5, 7, 11 and so on. `isprime` asks whether a number is one, and `nextprime` finds
the first prime after a number.

```solve
isprime(97) // true
isprime(561) // false
isprime(2^61 - 1) // true
nextprime(100) // 101
```

561 is a trap for the simplest prime tests, which it passes although it is 3 ×
11 × 17; the test here is not fooled. For numbers below about 3.3 × 10^24 the
answer is a proof; above that, a number reported prime has passed a test that no
known composite number of that size passes, but is not proved.

## Breaking a number into primes

Every whole number greater than 1 is a product of primes in exactly one way, its
**prime factorisation**. `factor` writes it out, with a power where a prime
repeats, in a form that reads back as the number.

```solve
factor(360) // 2^3 * 3^2 * 5
factor(600851475143) // 71 * 839 * 1471 * 6857
factor(97) // 97
```

`factor` given an expression with an unknown in it factors the polynomial
instead (see [factoring](/syntax/factoring/)). Factoring gets expensive quickly as
numbers grow, so a whole number above 2^64 (about 1.8 × 10^19) is refused rather
than left to run.

## Remainders on huge powers

`modpow(b, e, m)` is the remainder when `b` to the power `e` is divided by `m`,
worked out without ever building `b^e`, which can have millions of digits. It is
the everyday tool of cryptography and checksums. `modinv(a, m)` is the number
that multiplies `a` to leave remainder 1 when divided by `m`, which exists only
when `a` and `m` share no factor.

```solve
modpow(7, 77, 13) // 11
modpow(2, 100, 1000000007) // 976,371,285
modinv(3, 11) // 4
```

## Factorials and choosing

The **factorial** of a whole number, written with an exclamation mark, is every
whole number up to it multiplied together: `5!` is 5 × 4 × 3 × 2 × 1, the number
of ways to put five things in order. **Choosing** counts the ways to pick some
things out of more when the order does not matter: `10 choose 3` is the number of
three-person teams from ten people. `fact`, `combination` (also `nCr` or
`binomial`) and `permutation` are the function spellings.

```solve
5! // 120
25! // 15,511,210,043,330,985,984,000,000
10 choose 3 // 120
52 choose 5 // 2,598,960
permutation(10, 3) // 720
```

`!` binds to the number beside it, as in mathematics, so `2^3!` is 2 to the
power 6. The largest factorial is `170!`, the last one an ordinary number can
hold.

## What is refused

Each of these works on whole numbers, and a fraction or an impossible request is
refused by name rather than rounded into an answer.

```solve-doc
factor(3.5) // ERROR: factor of a number works on whole numbers
modinv(4, 8) // ERROR: 4 has no inverse modulo 8: they share a factor, so no multiple of 4 leaves remainder 1.
factor(2^64 + 1) // ERROR: factor works on whole numbers up to 2^64 (18,446,744,073,709,551,616); 18446744073709551617 is larger.
```

`choose` is a keyword, so it cannot also be the name of a variable.
