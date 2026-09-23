/**
 * Whole-number arithmetic that stays exact past 2^53.
 *
 * A double holds every whole number up to 9,007,199,254,740,991
 * (`Number.MAX_SAFE_INTEGER`, the "safe range") and only some of them beyond
 * it, so an integer result past that line used to come back as the nearest
 * double: `3^40` printed 12,157,665,459,056,929,000 where the answer is
 * 12,157,665,459,056,928,801, `2^53 + 1` answered 2^53, and `7^77 mod 13` took
 * its remainder from a number with the wrong low digits.
 *
 * Such a result is now computed as a bigint and carried on the answer as its
 * `rational` sidecar (n/1), the same sidecar integer division already seeds for
 * `1/3`. The value stays a Number, so a unit, a percentage, a fraction or money
 * reads it exactly as it read any other number, and the next `+`, `-`, `*`,
 * `/`, comparison or `as fraction` already reads the sidecar in preference to
 * the double. The remainder and the formatter read it here.
 *
 * Which results qualify is deliberately narrow, and the boundary is provenance:
 *
 * - The operands must be whole numbers within the safe range, or already carry
 *   an exact integer. A number TYPED past the safe range (`1e16`,
 *   `12345678901234567890`) was rounded to a double before the engine saw it,
 *   so exact arithmetic on it would print invented digits as if they were
 *   exact. It keeps its double, which is why `1e16 + 1 - 1e16` is still 0 while
 *   `10^16 + 1 - 10^16` is 1. The `n` suffix is the way to type a large exact
 *   integer.
 * - The result must be finite as a double. Past about 1.8e308 a double has no
 *   finite value, and the answer is Infinity exactly as it was; `2 ^ 100000`
 *   is unchanged. That also bounds the work: a finite result is at most 1,024
 *   bits, so an exact power here never needs more than a dozen squarings.
 */

import { Value, ValueType, numberValue, numberValueRational } from "@solve-js/vm/Value";
import { rational, rationalNeg } from "@solve-js/symbolic";

/**
 * `base ** exponent` for bigints, by repeated squaring.
 *
 * Written out rather than using the `**` operator on purpose. TypeScript
 * downlevels `**` to `Math.pow()` for any target below ES2016, and the test
 * config compiles at ES6, so the operator form threw "Cannot convert a BigInt
 * value to a number" under the test runner while working in the shipped build:
 * a difference between what is tested and what ships, which is worse than the
 * loop. `symbolic/Complex.ts`'s `complexPow` does the same thing for the same
 * shape of reason.
 *
 * `exponent` must be non-negative; callers check.
 */
export function bigIntPow(base: bigint, exponent: bigint): bigint {
    let result = 1n;
    let factor = base;
    let remaining = exponent;
    while (remaining > 0n) {
        if (remaining % 2n === 1n) result *= factor;
        remaining /= 2n;
        // Skipped on the last pass, where squaring would only build a number
        // twice the size of the answer and throw it away.
        if (remaining > 0n) factor *= factor;
    }
    return result;
}

/**
 * An operand's exact whole-number value, or null when it has none.
 *
 * A Number carrying an integer sidecar hands that over; a fraction's sidecar
 * has no integer value and gives null. A plain double is read by `seeding`:
 *
 * - `true` (a new exact result is being made): only a whole number within the
 *   safe range counts, because past it the double may already be a rounding of
 *   what was typed. See this module's doc comment.
 * - `false` (an exact result is being consumed, as `mod` does): any finite
 *   whole double counts, at its exact value. The operation is exact on the
 *   operands it was given, the same guarantee `%` on two doubles already makes.
 *
 * A number carrying an uncertainty has no exact value to give, and neither
 * does any other type.
 */
export function exactIntegerOf(v: Value, seeding: boolean): bigint | null {
    if (v.type !== ValueType.Number || v.uncertainty !== undefined) return null;
    const r = v.rational;
    if (r !== undefined) return r.d === 1n ? r.n : null;
    const n = v.value as number;
    return (seeding ? Number.isSafeInteger(n) : Number.isInteger(n)) ? BigInt(n) : null;
}

/**
 * A whole-number result as a Value: a plain Number within the safe range, where
 * the double is already exact, and one carrying the exact integer past it.
 *
 * A result past a double's range is its infinity with no sidecar, the answer
 * the double path gives, so an exact integer never rides on an Infinity.
 */
export function exactIntegerValue(n: bigint): Value {
    const approx = Number(n);
    // Number() rounds, but never across the safe boundary: every integer up to
    // it is exact, so the test on the double is the test on n.
    if (approx <= Number.MAX_SAFE_INTEGER && approx >= -Number.MAX_SAFE_INTEGER) return numberValue(approx);
    if (!Number.isFinite(approx)) return numberValue(approx);
    return numberValueRational(approx, rational(n));
}

/**
 * The exact result of `+`, `-`, `*` or `^` whose double answer left the safe
 * range, or that double when there is no exact one.
 *
 * The VM's plain-number fast paths call this only after the result they
 * computed failed one comparison against the safe range, so an ordinary
 * `2 + 3` never reaches it. `approx` is that double result, returned as it was
 * whenever an operand is not an exact whole number (`1e16 + 1`, `2^60 + 0.5`),
 * the exponent is negative (`2^-60` is a fraction), or the result is not
 * finite.
 */
export function exactIntegerArithmetic(l: Value, r: Value, approx: number, op: "add" | "sub" | "mul" | "pow"): Value {
    if (!Number.isFinite(approx)) return numberValue(approx);
    const a = exactIntegerOf(l, true);
    if (a === null) return numberValue(approx);
    const b = exactIntegerOf(r, true);
    if (b === null) return numberValue(approx);
    switch (op) {
        case "add": return exactIntegerValue(a + b);
        case "sub": return exactIntegerValue(a - b);
        case "mul": return exactIntegerValue(a * b);
        // A finite approx bounds the exponent: a base of magnitude two or more
        // cannot pass 1,024 bits, and a base of 0, 1 or -1 never leaves the safe
        // range to arrive here.
        case "pow": return b < 0n ? numberValue(approx) : exactIntegerValue(bigIntPow(a, b));
    }
}

/**
 * The exact remainder when either operand carries an exact integer, or null.
 *
 * `(2^53 + 1) mod 2` is 1, where the double `%` reads the left side as 2^53
 * and answers 0. Null (keeping the double `%`) when either side is not a whole
 * number, so `(7/2) mod 2` is 1.5 as before, and for a zero divisor, whose
 * answer the double path already gives. The sign follows the dividend, as `%`
 * does.
 */
export function exactIntegerRemainder(l: Value, r: Value): Value | null {
    const a = exactIntegerOf(l, false);
    if (a === null) return null;
    const b = exactIntegerOf(r, false);
    if (b === null || b === 0n) return null;
    return exactIntegerValue(a % b);
}

/**
 * `gcd` or `lcm` over exact integers, or null when an operand is not one.
 *
 * The double `lcm` is `(a / gcd) * b`, which rounds once the answer passes the
 * safe range: `lcm(2^40, 3^20)` lost its low digits. Operands are read as a new
 * exact result's are (see {@link exactIntegerOf}), so a number typed past the
 * safe range, or a fractional one that `gcd` truncates, keeps the double path.
 */
export function exactGcdOrLcm(a: Value, b: Value, which: "gcd" | "lcm"): Value | null {
    let x = exactIntegerOf(a, true);
    if (x === null) return null;
    let y = exactIntegerOf(b, true);
    if (y === null) return null;
    if (x < 0n) x = -x;
    if (y < 0n) y = -y;
    if (which === "lcm" && (x === 0n || y === 0n)) return numberValue(0);
    let g = x;
    let h = y;
    while (h !== 0n) {
        const t = h;
        h = g % h;
        g = t;
    }
    return exactIntegerValue(which === "gcd" ? g : (x / g) * y);
}

/**
 * What `as hex`, `as binary` and `as octal` convert: a bigint's own value, an
 * exact integer's digits when it carries one past the safe range, and the
 * double otherwise. `(2^53 + 1) as hex` is 0x20000000000001, where the double
 * gave 0x20000000000000.
 */
export function baseConversionOperand(v: Value): number | bigint {
    if (v.type === ValueType.BigInt) return v.value as bigint;
    const r = v.rational;
    if (r !== undefined && r.d === 1n && !Number.isSafeInteger(v.value as number)) return r.n;
    return v.toNumber();
}

/**
 * A rounding function's answer for an exact integer, or null.
 *
 * `floor`, `ceil`, `round` and `trunc` leave a whole number where it is, and
 * `abs` only changes its sign, so an operand carrying an exact integer is
 * handed back exact rather than as the double it rounds to: `floor(2^53 + 1)`
 * is 9,007,199,254,740,993. Null for everything else, which keeps its path.
 */
export function wholeNumberUnchanged(v: Value, absolute: boolean): Value | null {
    const r = v.rational;
    if (v.type !== ValueType.Number || r === undefined || r.d !== 1n) return null;
    if (absolute && r.n < 0n) return numberValueRational(-(v.value as number), rationalNeg(r));
    return v;
}
