/**
 * Exact rational arithmetic over `bigint`, the coefficient type for every
 * part of the symbolic algebra system.
 *
 * A computer-algebra system cannot work in IEEE doubles. Factoring
 * `x^2 - x/3 - 2/3` needs `1/3` to stay `1/3` rather than becoming
 * `0.3333333333333333`, and the rational-root theorem tests candidate roots
 * by exact division, where a rounding error is indistinguishable from a
 * genuine root. Every coefficient in `SymbolicNode`, `Polynomial`, `Factor`
 * and `Solve` is a Rational for that reason.
 *
 * Values are always normalized on construction (`d > 0n`, `gcd(|n|, d) === 1n`,
 * zero is exactly `0n/1n`), so structural equality on the `{n, d}` pair is
 * mathematical equality, and the pair can be used directly as a cache key.
 *
 * A Rational holds two `bigint`s. Structured clone, which is what the
 * playground's `postMessage` uses to ship a `SymbolicNode` to the VM trace
 * view, handles bigint correctly. `JSON.stringify` does not: it throws
 * `TypeError: Do not know how to serialize a BigInt`. Do not introduce a JSON
 * round-trip anywhere a Rational can reach.
 */

import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * An exact rational number.
 *
 * Always normalized, see this module's own doc comment for the invariant.
 * Construct via {@link rational} or {@link rationalFromNumber} rather than as
 * an object literal, which would bypass normalization.
 */
export interface Rational {
	/** Signed numerator. Carries the sign of the whole value. */
	readonly n: bigint;
	/** Denominator, always strictly positive. */
	readonly d: bigint;
}

/** The rational `0`. */
export const RATIONAL_ZERO: Rational = { n: 0n, d: 1n };

/** The rational `1`. */
export const RATIONAL_ONE: Rational = { n: 1n, d: 1n };

/** The rational `-1`. */
export const RATIONAL_MINUS_ONE: Rational = { n: -1n, d: 1n };

/**
 * Magnitude ceiling, in bits, on either component of a Rational.
 *
 * Repeated exact elimination (a symbolic matrix inverse, synthetic division
 * down a long factor chain) multiplies denominators together, so an unbounded
 * Rational can grow until bigint arithmetic itself becomes the bottleneck.
 * 4096 bits is far beyond any coefficient a human writes, while still bounding
 * a single multiply to microseconds. Follows the precedent set by
 * `vm/MatrixOps.ts`'s own `SYMBOLIC_INVERSE_DIMENSION_LIMIT`: a named
 * constant with a stated reason rather than an arbitrary inline number.
 */
export const RATIONAL_MAX_BITS = 4096;

/** Precomputed `2 ** RATIONAL_MAX_BITS`, so the guard is one comparison rather than a `toString(2)` walk. */
const MAX_MAGNITUDE = 1n << BigInt(RATIONAL_MAX_BITS);

/**
 * Bigint exponentiation by repeated squaring.
 *
 * Written out rather than using `**`, deliberately. The test tsconfig targets
 * ES6, where TypeScript lowers `a ** b` to `Math.pow(a, b)`, and `Math.pow`
 * throws `TypeError: Cannot convert a BigInt value to a number`. So `10n ** 3n`
 * compiles fine and passes a typecheck, then fails only at runtime under the
 * test target. Do not reintroduce `**` on bigints anywhere in this module.
 */
function bigintPow(base: bigint, exponent: bigint): bigint {
	let result = 1n;
	let factor = base;
	let remaining = exponent;
	while (remaining > 0n) {
		if (remaining % 2n === 1n) result *= factor;
		factor *= factor;
		remaining /= 2n;
	}
	return result;
}

/** Euclid's algorithm on absolute values. Returns `0n` only when both inputs are zero. */
function gcd(a: bigint, b: bigint): bigint {
	let x = a < 0n ? -a : a;
	let y = b < 0n ? -b : b;
	while (y !== 0n) {
		const remainder = x % y;
		x = y;
		y = remainder;
	}
	return x;
}

/** Raises {@link RATIONAL_MAX_BITS} as an error rather than letting bigint growth run away silently. */
function guardMagnitude(n: bigint, d: bigint): void {
	const magnitude = n < 0n ? -n : n;
	if (magnitude >= MAX_MAGNITUDE || d >= MAX_MAGNITUDE) {
		throw ErrorFactory.execution(
			"SYMBOLIC_RATIONAL_OVERFLOW",
			`This calculation produced a fraction too large to represent exactly (over ${RATIONAL_MAX_BITS} bits).`,
			{ limitBits: RATIONAL_MAX_BITS },
		);
	}
}

/**
 * Reduces a numerator/denominator pair to the normalized form this module
 * guarantees everywhere.
 *
 * @param n - Numerator, may be negative.
 * @param d - Denominator, may be negative, must not be zero.
 * @returns The normalized rational.
 * @throws {EngineError} `SYMBOLIC_DIVISION_BY_ZERO` when `d` is zero,
 * `SYMBOLIC_RATIONAL_OVERFLOW` past {@link RATIONAL_MAX_BITS}.
 */
function normalize(n: bigint, d: bigint): Rational {
	if (d === 0n) {
		throw ErrorFactory.execution("SYMBOLIC_DIVISION_BY_ZERO", "Division by zero in a symbolic expression.");
	}
	if (n === 0n) return RATIONAL_ZERO;

	// Carry the sign on the numerator so `d > 0n` always holds, which is what
	// lets rationalCompare() cross-multiply without tracking sign flips.
	let numerator = d < 0n ? -n : n;
	let denominator = d < 0n ? -d : d;

	const divisor = gcd(numerator, denominator);
	numerator /= divisor;
	denominator /= divisor;

	guardMagnitude(numerator, denominator);
	return { n: numerator, d: denominator };
}

/**
 * Builds a normalized rational from bigint components.
 *
 * @param numerator - The numerator.
 * @param denominator - The denominator, defaulting to `1n`.
 * @returns The normalized rational.
 * @throws {EngineError} `SYMBOLIC_DIVISION_BY_ZERO` when `denominator` is zero.
 */
export function rational(numerator: bigint, denominator: bigint = 1n): Rational {
	return normalize(numerator, denominator);
}

/** Matches every form `Number.prototype.toString` produces for a finite value, including the `e±n` variants used outside `[1e-6, 1e21)`. */
const DECIMAL_FORM = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Converts a JavaScript number to its exact rational value **as written**,
 * via the decimal string form rather than the IEEE expansion.
 *
 * This distinction is the single sharpest edge in this module. The double
 * nearest to `0.1` is exactly `3602879701896397 / 36028797018963968`, which is
 * mathematically correct and useless to display or factor with. Going through
 * `String(0.1)`, which is `"0.1"`, yields `1/10`: the number the user actually
 * typed. `Number.prototype.toString` is specified to emit the shortest decimal
 * that round-trips, so this is well defined rather than a heuristic.
 *
 * @param value - Any finite number.
 * @returns The exact rational for that number's decimal representation.
 * @throws {EngineError} `SYMBOLIC_NONFINITE_OPERAND` for `NaN` or `±Infinity`,
 * neither of which has a rational image.
 */
export function rationalFromNumber(value: number): Rational {
	if (!Number.isFinite(value)) {
		throw ErrorFactory.execution(
			"SYMBOLIC_NONFINITE_OPERAND",
			`"${String(value)}" has no exact value, so it cannot appear in a symbolic expression.`,
			{ value: String(value) },
		);
	}
	if (Number.isInteger(value)) return normalize(BigInt(value), 1n);

	const parts = DECIMAL_FORM.exec(String(value));
	if (parts === null) {
		throw ErrorFactory.internal(
			"INTERNAL_RATIONAL_PARSE",
			`Internal error: could not read "${String(value)}" as a decimal number.`,
			{ value: String(value) },
		);
	}

	const [, sign, integerDigits, fractionDigits = "", exponentDigits] = parts;
	let numerator = BigInt(integerDigits + fractionDigits);
	let denominator = bigintPow(10n, BigInt(fractionDigits.length));

	const exponent = exponentDigits === undefined ? 0 : Number(exponentDigits);
	if (exponent > 0) numerator *= bigintPow(10n, BigInt(exponent));
	else if (exponent < 0) denominator *= bigintPow(10n, BigInt(-exponent));

	return normalize(sign === "-" ? -numerator : numerator, denominator);
}

/**
 * Approximates a rational as a double, for the boundary back into ordinary
 * numeric Values and matrix cells.
 *
 * @param r - The rational.
 * @returns The nearest double, or `±Infinity` when the value genuinely
 * exceeds double range.
 */
export function rationalToNumber(r: Rational): number {
	if (r.d === 1n) return Number(r.n);

	const direct = Number(r.n) / Number(r.d);
	if (!Number.isNaN(direct)) return direct;

	// Both components individually overflow a double, so the naive division is
	// Infinity/Infinity. Dividing in bigint space with 64 guard bits first
	// keeps the ratio, and scaling back by a power of two is exact in binary
	// floating point.
	const GUARD_BITS = 64n;
	return Number((r.n << GUARD_BITS) / r.d) / 2 ** 64;
}

/**
 * Exact addition.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a + b`, normalized.
 */
export function rationalAdd(a: Rational, b: Rational): Rational {
	return normalize(a.n * b.d + b.n * a.d, a.d * b.d);
}

/**
 * Exact subtraction.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a - b`, normalized.
 */
export function rationalSub(a: Rational, b: Rational): Rational {
	return normalize(a.n * b.d - b.n * a.d, a.d * b.d);
}

/**
 * Exact multiplication.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a * b`, normalized.
 */
export function rationalMul(a: Rational, b: Rational): Rational {
	return normalize(a.n * b.n, a.d * b.d);
}

/**
 * Exact division.
 *
 * @param a - Dividend.
 * @param b - Divisor.
 * @returns `a / b`, normalized.
 * @throws {EngineError} `SYMBOLIC_DIVISION_BY_ZERO` when `b` is zero.
 */
export function rationalDiv(a: Rational, b: Rational): Rational {
	if (b.n === 0n) {
		throw ErrorFactory.execution("SYMBOLIC_DIVISION_BY_ZERO", "Division by zero in a symbolic expression.");
	}
	return normalize(a.n * b.d, a.d * b.n);
}

/**
 * Exact negation.
 *
 * @param r - The rational to negate.
 * @returns `-r`. Already normalized, since negating cannot change the gcd.
 */
export function rationalNeg(r: Rational): Rational {
	return r.n === 0n ? RATIONAL_ZERO : { n: -r.n, d: r.d };
}

/**
 * Exact integer power, including negative exponents (which invert the base).
 *
 * @param base - The base.
 * @param exponent - Integer exponent, may be negative.
 * @returns `base ** exponent`, normalized.
 * @throws {EngineError} `SYMBOLIC_DIVISION_BY_ZERO` for a zero base raised to a
 * negative exponent.
 */
export function rationalPow(base: Rational, exponent: bigint): Rational {
	if (exponent === 0n) return RATIONAL_ONE;
	if (exponent < 0n) {
		if (base.n === 0n) {
			throw ErrorFactory.execution("SYMBOLIC_DIVISION_BY_ZERO", "Zero raised to a negative power is undefined.");
		}
		const positive = -exponent;
		return normalize(bigintPow(base.d, positive), bigintPow(base.n, positive));
	}
	return normalize(bigintPow(base.n, exponent), bigintPow(base.d, exponent));
}

/**
 * Three-way comparison.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `-1` when `a < b`, `0` when equal, `1` when `a > b`.
 */
export function rationalCompare(a: Rational, b: Rational): -1 | 0 | 1 {
	// Both denominators are positive by the normalization invariant, so
	// cross-multiplying cannot flip the inequality.
	const left = a.n * b.d;
	const right = b.n * a.d;
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

/**
 * Whether a rational is exactly zero.
 *
 * The reason this exists rather than a `=== 0` on a double: a pivot that is
 * structurally zero can arrive as `5.551e-17` in floating point, so
 * `vm/MatrixOps.ts` used to treat a singular symbolic matrix as invertible.
 * With exact coefficients the test is decisive.
 *
 * @param r - The rational.
 * @returns True when `r` is zero.
 */
export function isRationalZero(r: Rational): boolean {
	return r.n === 0n;
}

/**
 * Whether a rational is exactly one.
 *
 * @param r - The rational.
 * @returns True when `r` is one.
 */
export function isRationalOne(r: Rational): boolean {
	return r.n === 1n && r.d === 1n;
}

/**
 * Whether a rational is exactly negative one.
 *
 * @param r - The rational.
 * @returns True when `r` is minus one.
 */
export function isRationalMinusOne(r: Rational): boolean {
	return r.n === -1n && r.d === 1n;
}

/**
 * Whether a rational is a whole number.
 *
 * @param r - The rational.
 * @returns True when the denominator is one, which after normalization is the
 * only way a rational can be integral.
 */
export function isRationalInteger(r: Rational): boolean {
	return r.d === 1n;
}

/**
 * Longest exact decimal this module will render in full.
 *
 * Ten digits matches what the previous double-based formatter produced, so
 * display width does not regress.
 */
const MAX_DECIMAL_DIGITS = 10;

/**
 * Largest component either side of a fraction may have and still be shown as
 * one.
 *
 * This is what stops an exact conversion from being unreadable. `sqrt(2)`
 * evaluates numerically to `1.4142135623730951`, whose exact rational value is
 * `14142135623730951/10000000000000000`: correct, and useless on screen. A
 * fraction is only clearer than a decimal when its parts are small enough to
 * recognise, so past this bound the rounded decimal wins.
 */
const MAX_FRACTION_COMPONENT = 1_000_000n;

/**
 * Renders a rational for display.
 *
 * A whole number prints as digits (`2`). A fraction whose denominator divides
 * a power of ten prints as its exact decimal (`2.5`), since that is how a user
 * wrote it and how they expect to read it back. Anything else prints as
 * `n/d` (`1/3`), which is exact where a decimal would have to lie.
 *
 * @param r - The rational to render.
 * @returns The display string, with a leading minus for negative values.
 */
export function formatRational(r: Rational): string {
	if (r.d === 1n) return String(r.n);

	// A fraction terminates in base ten exactly when its denominator's only
	// prime factors are 2 and 5. Strip those and see what is left.
	let remaining = r.d;
	let twos = 0;
	let fives = 0;
	while (remaining % 2n === 0n) {
		remaining /= 2n;
		twos++;
	}
	while (remaining % 5n === 0n) {
		remaining /= 5n;
		fives++;
	}

	const terminates = remaining === 1n;
	const decimals = Math.max(twos, fives);
	if (!terminates || decimals > MAX_DECIMAL_DIGITS) {
		const magnitude = r.n < 0n ? -r.n : r.n;
		if (magnitude <= MAX_FRACTION_COMPONENT && r.d <= MAX_FRACTION_COMPONENT) return `${r.n}/${r.d}`;
		// Too large to read as a fraction, so fall back to the same rounded
		// decimal the previous double-based formatter produced.
		return String(Math.round(rationalToNumber(r) * 1e10) / 1e10);
	}

	const scaled = (r.n < 0n ? -r.n : r.n) * bigintPow(10n, BigInt(decimals)) / r.d;
	const digits = String(scaled).padStart(decimals + 1, "0");
	const whole = digits.slice(0, digits.length - decimals);
	const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
	const sign = r.n < 0n ? "-" : "";
	return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
