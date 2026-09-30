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
 *   an exact integer. A whole number typed in plain digits past the safe range
 *   (`9007199254740993`) carries its exact integer from the literal (see
 *   {@link exactWholeLiteral}), since the digits are all there to read. One
 *   typed in scientific notation (`1e16`) names a double, and a double past
 *   the safe range may already be a rounding, so exact arithmetic on it would
 *   print invented digits as if they were exact. It keeps its double, which is
 *   why `1e16 + 1 - 1e16` is still 0 while `10^16 + 1 - 10^16` is 1.
 * - The result must be finite as a double. Past about 1.8e308 a double has no
 *   finite value, and the answer is Infinity exactly as it was; `2 ^ 100000`
 *   is unchanged. That also bounds the work: a finite result is at most 1,024
 *   bits, so an exact power here never needs more than a dozen squarings.
 */

import { Value, ValueType, numberValue, numberValueRational, errorValue, hexValue, bigIntValue, type IpCidrData, type DisplayBase } from "@solve-js/vm/Value";
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
    // A value already written in a base keeps the bigint it holds past the
    // safe range: through toNumber(), `(2^100 + 1) in binary as hex` rounded
    // to the nearest double and lost its final 1.
    if (typeof v.value === "bigint" && (v.type === ValueType.BigInt || v.type === ValueType.Hex)) return v.value;
    // An IPv6 address converts from its 128 bits, which no double holds.
    if (v.type === ValueType.IpCidr) {
        const addr6 = (v.value as IpCidrData).addr6;
        if (addr6 !== undefined) return addr6;
    }
    const r = v.rational;
    if (r !== undefined && r.d === 1n && !Number.isSafeInteger(v.value as number)) return r.n;
    return v.toNumber();
}

/** How a base is named after `in`, for a message: "in hex", "in binary", "in octal". */
const BASE_WORDS: Readonly<Record<DisplayBase, string>> = { hex: "in hex", bin: "in binary", oct: "in octal" };

/**
 * The refusal for a number with no digits to write in a base, or null when it
 * has them.
 *
 * An infinity or a NaN has no digits in any base, and `(1/0) in hex` and
 * `2^4000 in binary as hex` displayed "Infinity" as though it were a numeral.
 * An ordinary number past about 1.8e308 (the largest a double holds) is
 * already infinite before any conversion, since no exact integer is made for
 * it (see this module's doc comment), so the message points at the `n` form,
 * which keeps every digit up to its own stated power limit.
 *
 * @param n - What {@link baseConversionOperand} read.
 * @param base - The base asked for.
 * @returns The `BASE_NOT_FINITE` error Value, or null for a finite number or a bigint.
 */
export function nonFiniteInBase(n: number | bigint, base: DisplayBase): Value | null {
    if (typeof n === "bigint" || Number.isFinite(n)) return null;
    const where = BASE_WORDS[base];
    return errorValue(
        "BASE_NOT_FINITE",
        Number.isNaN(n)
            ? `A result with no value has no digits to write ${where}.`
            : `An infinite value has no digits to write ${where}. An ordinary number past about 1.8e308 is infinite; a whole number written with n, as in 2n^4000, keeps every digit.`,
    );
}

/**
 * A value written in base 16, 2 or 8 from its own digits (see
 * {@link baseConversionOperand}), or the refusal for one with none (see
 * {@link nonFiniteInBase}). What `in hex`, `as binary`, `hex()` and `bin()`
 * give for everything but a colour.
 *
 * @param v - The value, already checked for a fault.
 * @param base - The base to write it in.
 */
export function valueInBase(v: Value, base: DisplayBase): Value {
    const n = baseConversionOperand(v);
    return nonFiniteInBase(n, base) ?? hexValue(n, base);
}

/** `Number.MAX_SAFE_INTEGER` as a bigint, the line past which a double stops holding every whole number. */
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The whole number a value written in a base holds past the safe range, or
 * null for any other value.
 *
 * `in hex` keeps a bigint inside the value it writes once the number passes
 * 2^53 (see {@link baseConversionOperand}), and arithmetic straight on it read
 * it through `toNumber()`, the nearest double: `(2^100 + 1) in hex + 1` lost
 * its last digits while `(2^100 + 1) in hex as number + 1` kept them. Within
 * the safe range the double is already exact, so null leaves that value on
 * its ordinary path.
 *
 * @param v - Any value.
 */
export function bigBaseInteger(v: Value): bigint | null {
    if (v.type !== ValueType.Hex || typeof v.value !== "bigint") return null;
    const n = v.value;
    return n > MAX_SAFE_BIG || n < -MAX_SAFE_BIG ? n : null;
}

/**
 * A whole number read out of a value written in a base, as an answer: an
 * ordinary number carrying its exact integer (see {@link exactIntegerValue}),
 * or, past about 1.8e308 where a double has no finite value, the `n` whole
 * number, so `(2n^2000) in hex + 1` and `-((2n^2000) in hex)` keep every digit
 * rather than answering an infinity.
 *
 * @param n - The whole number.
 */
export function wholeFromBase(n: bigint): Value {
    return Number.isFinite(Number(n)) ? exactIntegerValue(n) : bigIntValue(n);
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

/**
 * The Value a whole-number literal past the safe range compiles to: a Number
 * carrying its exact integer, as {@link exactIntegerValue} builds for a result.
 *
 * `9007199254740993` is 9,007,199,254,740,993, where the double reads it as
 * 9,007,199,254,740,992. The parser only sends plain digits here (see
 * `parser/WholeLiteral.ts`); anything else, which no compiled program holds,
 * is null rather than a throw from `BigInt`.
 *
 * @param digits - The literal's digits, grouping removed.
 * @returns The exact Number, or null for text that is not plain digits.
 */
export function exactWholeLiteral(digits: string): Value | null {
    if (!/^\d+$/.test(digits)) return null;
    return exactIntegerValue(BigInt(digits));
}
