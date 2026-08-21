import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * An exact base-ten number, held as an integer coefficient and a scale.
 *
 * The value is `coef * 10^(-scale)`, so `Decimal(30n, 2)` is exactly `0.30` and
 * `Decimal(1005n, 3)` is exactly `1.005`. `scale` is a non-negative integer
 * count of fractional digits, the sign lives on `coef`, and zero is
 * `Decimal(0n, s)` for any `s`.
 *
 * This is the representation money is carried in so that two prices a user
 * typed add and multiply without the binary-floating-point error a double
 * introduces (`0.1 + 0.2` is `0.30000000000000004` as a double, `0.30` here).
 * It is deliberately dependency-free: a bigint coefficient plus an integer
 * scale needs nothing the runtime does not already have, which keeps the
 * engine's single-runtime-dependency contract intact.
 */
export interface DecimalData {
	/** The integer coefficient, carrying the sign. */
	readonly coef: bigint;
	/** The number of fractional digits, a non-negative integer. */
	readonly scale: number;
}

/**
 * How division and display rounding break a tie.
 *
 * Half away from zero is the reading a person doing money by hand uses (a half
 * cent rounds up to the next cent, and a negative one rounds down to the next),
 * and it is what `Intl.NumberFormat` picks by default. It is the one mode this
 * module implements, named so the call sites read as decisions rather than
 * defaults.
 */
export type RoundingMode = "halfAwayFromZero";

/**
 * How many fractional digits a non-terminating division keeps.
 *
 * `$10 / 3` has no exact decimal, so the quotient is rounded to this many
 * places. Twenty is far more than any currency displays and enough that the
 * double taken from it (via {@link decimalToNumber}) is the same one the
 * ordinary float division would have produced, so nothing downstream sees a
 * coarser answer than before.
 */
export const DEFAULT_DIVISION_SCALE = 20;

/** Powers of ten, memoized, since scale alignment asks for the same few often. */
const POW10: bigint[] = [1n];
function pow10(n: number): bigint {
	if (n < 0) {
		throw ErrorFactory.internal("DECIMAL_NEGATIVE_POWER", `pow10 needs a non-negative exponent, got ${n}`, { exponent: n });
	}
	for (let i = POW10.length; i <= n; i++) POW10[i] = POW10[i - 1] * 10n;
	return POW10[n];
}

/** Build a {@link DecimalData}, guarding the scale invariant in one place. */
export function makeDecimal(coef: bigint, scale: number): DecimalData {
	if (!Number.isInteger(scale) || scale < 0) {
		throw ErrorFactory.internal("DECIMAL_INVALID_SCALE", `A decimal scale must be a non-negative integer, got ${scale}`, { scale });
	}
	return { coef, scale };
}

/** The exact decimal for a whole number. */
export function decimalFromInteger(n: bigint | number): DecimalData {
	return { coef: typeof n === "bigint" ? n : BigInt(n), scale: 0 };
}

/**
 * The exact decimal a plain number stands for, or `null` when it has none.
 *
 * Only whole numbers convert: a whole-valued double is exactly the integer it
 * prints as, so lifting it is lossless. A fractional double (`0.1`, the result
 * of `sqrt(2)`) is NOT its printed decimal, it is the nearest double to it, so
 * there is no exact decimal to recover and this returns `null` rather than
 * inventing one. That null is the boundary that keeps float where float
 * belongs: a fractional double meeting money stays a double.
 */
export function decimalFromNumberIfExact(n: number): DecimalData | null {
	if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
	return decimalFromInteger(BigInt(n));
}

/**
 * Parse a normalized dot-decimal literal (`"0.10"`, `"1.005"`, `"1234.5"`).
 *
 * The input is what the parser has already reduced a number literal to: any
 * thousands grouping stripped and the locale's decimal separator rewritten as
 * a single `"."`. That is why this does not consult a locale, and why it is
 * exact where {@link decimalFromNumberIfExact} is not: the digits are read
 * straight into the coefficient without ever passing through a double.
 *
 * @throws A parsing `INVALID_DECIMAL_LITERAL` error for a string that is not a
 * plain decimal, which the caller should never produce (the lexer validates the
 * literal first) but which is reported rather than guessed at if it does.
 */
export function decimalFromLiteral(text: string): DecimalData {
	let s = text;
	let negative = false;
	if (s.startsWith("-")) { negative = true; s = s.slice(1); }
	else if (s.startsWith("+")) { s = s.slice(1); }
	const dot = s.indexOf(".");
	const intPart = dot < 0 ? s : s.slice(0, dot);
	const fracPart = dot < 0 ? "" : s.slice(dot + 1);
	// A single trailing dot ("5.") or a bare fraction (".5") are both fine; the
	// halves just come out empty and read as zero digits.
	const digits = (intPart + fracPart) || "0";
	if (!/^[0-9]+$/.test(digits)) {
		throw ErrorFactory.parsing("INVALID_DECIMAL_LITERAL", `Not a decimal literal: "${text}"`, { raw: text });
	}
	let coef = BigInt(digits);
	if (negative) coef = -coef;
	return { coef, scale: fracPart.length };
}

/** Bring two decimals to a shared scale, returning both coefficients and it. */
function align(a: DecimalData, b: DecimalData): { ca: bigint; cb: bigint; scale: number } {
	if (a.scale === b.scale) return { ca: a.coef, cb: b.coef, scale: a.scale };
	if (a.scale > b.scale) return { ca: a.coef, cb: b.coef * pow10(a.scale - b.scale), scale: a.scale };
	return { ca: a.coef * pow10(b.scale - a.scale), cb: b.coef, scale: b.scale };
}

/** Exact sum. */
export function decimalAdd(a: DecimalData, b: DecimalData): DecimalData {
	const { ca, cb, scale } = align(a, b);
	return { coef: ca + cb, scale };
}

/** Exact difference. */
export function decimalSubtract(a: DecimalData, b: DecimalData): DecimalData {
	const { ca, cb, scale } = align(a, b);
	return { coef: ca - cb, scale };
}

/** Exact product. The scales add, which is exactly the base-ten rule. */
export function decimalMultiply(a: DecimalData, b: DecimalData): DecimalData {
	return { coef: a.coef * b.coef, scale: a.scale + b.scale };
}

/** Exact negation. */
export function decimalNegate(a: DecimalData): DecimalData {
	return { coef: -a.coef, scale: a.scale };
}

/** Whether the value is exactly zero, regardless of scale. */
export function decimalIsZero(a: DecimalData): boolean {
	return a.coef === 0n;
}

/**
 * Round a coefficient/scale pair to `targetScale` fractional digits, breaking
 * ties away from zero.
 *
 * Scaling UP is exact (append zeros). Scaling DOWN drops digits, and the tie
 * rule looks only at whether twice the dropped remainder reaches the divisor,
 * which is the half-away-from-zero test done in integers so it never rounds a
 * value it was handed exactly.
 */
function roundCoefToScale(coef: bigint, scale: number, targetScale: number): bigint {
	if (targetScale >= scale) return coef * pow10(targetScale - scale);
	const divisor = pow10(scale - targetScale);
	const negative = coef < 0n;
	const magnitude = negative ? -coef : coef;
	let q = magnitude / divisor;
	const r = magnitude % divisor;
	// Away from zero on a tie: 2*r === divisor rounds up, as does 2*r > divisor.
	if (r * 2n >= divisor) q += 1n;
	return negative ? -q : q;
}

/** Round to `targetScale` fractional digits, half away from zero. */
export function decimalRound(a: DecimalData, targetScale: number): DecimalData {
	return { coef: roundCoefToScale(a.coef, a.scale, targetScale), scale: targetScale };
}

/**
 * Quotient of two decimals, exact where it terminates and rounded to
 * `maxFractionDigits` where it does not.
 *
 * The caller guarantees a non-zero divisor: exact decimal division has no
 * answer at zero, the same way integer division does not, so the money
 * arithmetic checks {@link decimalIsZero} first and keeps the double's Infinity
 * for that case rather than routing it here.
 */
export function decimalDivide(a: DecimalData, b: DecimalData, maxFractionDigits: number = DEFAULT_DIVISION_SCALE): DecimalData {
	if (decimalIsZero(b)) {
		throw ErrorFactory.internal("DECIMAL_DIVISION_BY_ZERO", "decimalDivide was called with a zero divisor", {});
	}
	// a/b at result scale s is round( a.coef * 10^(s + b.scale) / (b.coef * 10^a.scale) ).
	const s = maxFractionDigits;
	const numerator = a.coef * pow10(s + b.scale);
	const denominator = b.coef * pow10(a.scale);
	const negative = (numerator < 0n) !== (denominator < 0n);
	const num = numerator < 0n ? -numerator : numerator;
	const den = denominator < 0n ? -denominator : denominator;
	let q = num / den;
	const r = num % den;
	if (r * 2n >= den) q += 1n;
	return { coef: negative ? -q : q, scale: s };
}

/** Three-way comparison: -1, 0 or 1. */
export function decimalCompare(a: DecimalData, b: DecimalData): -1 | 0 | 1 {
	const { ca, cb } = align(a, b);
	if (ca < cb) return -1;
	if (ca > cb) return 1;
	return 0;
}

/**
 * The exact decimal as a plain string, with no rounding and no grouping.
 *
 * Used both to hand a lossless value to `Number()` (which then rounds to the
 * nearest double once, correctly) and as the basis for fixed-precision display.
 */
export function decimalToString(a: DecimalData): string {
	const negative = a.coef < 0n;
	let digits = (negative ? -a.coef : a.coef).toString();
	if (a.scale === 0) return negative ? `-${digits}` : digits;
	if (digits.length <= a.scale) digits = digits.padStart(a.scale + 1, "0");
	const cut = digits.length - a.scale;
	const whole = digits.slice(0, cut);
	const frac = digits.slice(cut);
	return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * The nearest double to the exact value.
 *
 * Goes through {@link decimalToString} so the value is rounded to a double
 * exactly once, from its full decimal form, rather than accumulating error
 * through a `Number(coef) / Number(10^scale)` division.
 */
export function decimalToNumber(a: DecimalData): number {
	return Number(decimalToString(a));
}

/**
 * Render with exactly `fractionDigits` decimal places, rounded half away from
 * zero.
 *
 * This is the money-display path, and it is where the exact representation pays
 * off visibly: `$1.005` shows as `1.01` and `$2.675` as `2.68`, where
 * `(1.005).toFixed(2)` and `(2.675).toFixed(2)` answer `1.00` and `2.67`
 * because the double handed to `toFixed` is already a hair below the value the
 * user typed. No thousands grouping, matching the existing `toFixed`-based
 * currency formatter this replaces.
 */
export function decimalToFixed(a: DecimalData, fractionDigits: number): string {
	const rounded = decimalRound(a, fractionDigits);
	const negative = rounded.coef < 0n && rounded.coef !== 0n;
	let digits = (rounded.coef < 0n ? -rounded.coef : rounded.coef).toString();
	if (fractionDigits === 0) return negative ? `-${digits}` : digits;
	if (digits.length <= fractionDigits) digits = digits.padStart(fractionDigits + 1, "0");
	const cut = digits.length - fractionDigits;
	const whole = digits.slice(0, cut);
	const frac = digits.slice(cut);
	return `${negative ? "-" : ""}${whole}.${frac}`;
}
