/**
 * Exact base-ten arithmetic for plain numbers written with a decimal point.
 *
 * A double is a binary fraction, and most decimals have no finite binary form:
 * `0.1` is stored as the nearest double, 0.1000000000000000055511151231257827.
 * Adding two of those lands on 0.30000000000000004, which displays as 0.30 at
 * the default places and then compares unequal to the `0.3` on the next line.
 * A note that shows 0.30 and says `0.1 + 0.2 == 0.3` is false contradicts
 * itself, which is the failure this module exists to remove.
 *
 * A decimal-point literal already carries the decimal it was written as, in the
 * `exact` sidecar (see the PUSH_DECIMAL opcode), and money has kept that exact
 * through its arithmetic for a long time. This carries it through plain-number
 * arithmetic too: `+`, `-`, `*`, `mod`, a division that terminates, a whole
 * power, adding or taking a percentage, the comparisons, the rounding family,
 * and the totals and averages of a list or a column.
 * The value stays a {@link ValueType.Number} whose `value` is the nearest double
 * to the exact answer, so every reader of `.value` or `toNumber()` is unchanged
 * and only ever sees a better double than it used to.
 *
 * The boundary, and why:
 *
 * - **An operand needs an exact value.** A decimal literal has one, and so does
 *   a whole number within the safe range, since that double is exactly the
 *   integer it prints as. A computed irrational (`sqrt(2)`, `pi`, `ln 3`) has
 *   none, nor does a number typed in scientific notation or past the safe range
 *   (the double is a rounding of what was typed, see vm/ExactIntegers.ts). One
 *   such operand drops the operation to the double it always was.
 * - **A result stays within {@link EXACT_DECIMAL_DIGITS} digits.** Past that it
 *   falls back to the double, exactly as the operation answered before. The
 *   limit keeps the work bounded, and keeps the exact value one whose nearest
 *   double is a faithful reading of it.
 * - **A division that does not terminate is a fraction, not a decimal.**
 *   `0.1 / 3` has no finite decimal, so it carries the exact rational 1/30, the
 *   same sidecar integer division gives `1/3`, and `0.1 / 3 * 3 == 0.1` is true.
 * - **Everything else reads the double.** A transcendental function, a unit
 *   conversion, a matrix, a statistic and a measurement with an uncertainty
 *   work in floating point, as they always have.
 *
 * A whole-number result is handed back in the integer form the engine already
 * uses (a plain double, or the exact integer past the safe range), not as a
 * decimal, so `0.5 * 4` is the same plain `2` that `1 + 1` is and the next
 * operation takes the plain fast path again.
 */

import { Value, ValueType, numberValue, numberValueExact, numberValueRational, errorValue } from "@solve-js/vm/Value";
import { decimalCompare, decimalToString, type DecimalData } from "@solve-js/decimal";
import { rational, rationalToNumber, type Rational } from "@solve-js/symbolic";
import { bigIntPow, exactIntegerValue, exactIntegerArithmetic, exactIntegerRemainder } from "@solve-js/vm/ExactIntegers";

/**
 * How many digits an exact decimal result may carry before it falls back to the
 * double, counted both as significant digits and as places after the point.
 *
 * Thirty-four is the precision of the IEEE 754 decimal128 format, the standard
 * base-ten type, and about twice what a double resolves (15 to 17 digits), so
 * every sum and product of the numbers a person types stays exact with a wide
 * margin. It also bounds the work: an operand past it declines up front, so no
 * result is ever built from more than two 34-digit coefficients. A chain that
 * grows past it (compound growth, `1.05 ^ 30`, is 61 digits) answers the double
 * it answered before this module existed.
 */
export const EXACT_DECIMAL_DIGITS = 34;

/**
 * The globals this module calls on every exact operation, read once.
 *
 * A global lookup is slow inside a sandboxed realm such as Node's `vm` context,
 * which is where Jest runs the benchmark suite; reading `Number.MAX_SAFE_INTEGER`
 * inside the VM's addition doubled `1 + 2` there (see `SAFE_INTEGER_LIMIT` in
 * vm/VM.ts). Module constants cost nothing in either realm.
 */
const toBigInt = BigInt;
const toDouble = Number;
const isSafeInteger = Number.isSafeInteger;

/** Powers of ten as bigints, memoised; alignment asks for the same few. */
const POW10: bigint[] = [1n];
function pow10(n: number): bigint {
	for (let i = POW10.length; i <= n; i++) POW10[i] = POW10[i - 1] * 10n;
	return POW10[n];
}

/** 10^34: a coefficient at or past this has more than {@link EXACT_DECIMAL_DIGITS} digits. */
const COEFFICIENT_LIMIT = pow10(EXACT_DECIMAL_DIGITS);
const NEGATIVE_COEFFICIENT_LIMIT = -COEFFICIENT_LIMIT;

/**
 * Powers of ten as doubles, each exactly representable (10^22 is the last one
 * that is). Dividing an exactly-representable coefficient by one of these is a
 * single correctly rounded IEEE operation, so it gives the nearest double to
 * the decimal without the string round trip {@link decimalToString} needs.
 */
const POW10_DOUBLE: readonly number[] = Array.from({ length: 23 }, (_, i) => toDouble(`1e${i}`));

/** 2^53 as a bigint: a coefficient strictly inside +/- this converts to a double exactly. */
const SAFE_COEFFICIENT = 9007199254740992n;
const NEGATIVE_SAFE_COEFFICIENT = -SAFE_COEFFICIENT;

/** Whether a decimal is within {@link EXACT_DECIMAL_DIGITS} digits and places. */
function withinLimit(d: DecimalData): boolean {
	return d.scale <= EXACT_DECIMAL_DIGITS && d.coef < COEFFICIENT_LIMIT && d.coef > NEGATIVE_COEFFICIENT_LIMIT;
}

/**
 * The nearest double to an exact decimal.
 *
 * The common case (a coefficient below 2^53 and at most 22 places) is one
 * division of two exact doubles, which IEEE 754 rounds correctly. Anything
 * larger goes through the decimal string, which `Number()` also rounds
 * correctly, so both routes give the same double.
 */
function nearestDouble(d: DecimalData): number {
	if (d.coef < SAFE_COEFFICIENT && d.coef > NEGATIVE_SAFE_COEFFICIENT && d.scale < POW10_DOUBLE.length) {
		return toDouble(d.coef) / POW10_DOUBLE[d.scale];
	}
	return toDouble(decimalToString(d));
}

/**
 * A plain number's exact decimal value, or null when it has none.
 *
 * A Number carrying the `exact` sidecar (a decimal literal, or a result this
 * module made) hands it over. A whole number within the safe range is exactly
 * the integer it prints as, so it lifts losslessly: that is what lets
 * `0.1 * 3` stay exact. Anything else has no exact decimal: a computed
 * fraction, a number past the safe range, NaN and the infinities, a value
 * carrying a rational or an uncertainty (those have their own paths), and every
 * type that is not a plain Number.
 *
 * @param v - The operand.
 * @returns Its exact decimal, or null.
 */
export function exactDecimalOf(v: Value): DecimalData | null {
	if (v.type !== ValueType.Number) return null;
	if (v.exact !== undefined) return v.exact;
	if (v.rational !== undefined || v.uncertainty !== undefined) return null;
	const n = v.value as number;
	return isSafeInteger(n) ? { coef: toBigInt(n), scale: 0 } : null;
}

/** An operand's exact decimal, when it has one within the digit limit. */
function boundedOperand(v: Value): DecimalData | null {
	const d = exactDecimalOf(v);
	return d !== null && withinLimit(d) ? d : null;
}

/** Drop trailing fractional zeros, so `0.50` and `0.5` are the same coefficient. */
function trimmed(d: DecimalData): DecimalData {
	let { coef, scale } = d;
	while (scale > 0 && coef % 10n === 0n) {
		coef /= 10n;
		scale--;
	}
	return scale === d.scale ? d : { coef, scale };
}

/**
 * An exact decimal result as a Value, or null when it is past the digit limit.
 *
 * A whole-number result becomes the integer form the engine already uses (see
 * {@link exactIntegerValue}), so it carries no decimal sidecar and the next
 * operation on it takes the plain fast path. Anything else is a Number whose
 * `value` is the nearest double and whose `exact` is the decimal.
 *
 * `approx` is the double answer to the same operation, read only for a zero
 * result. A decimal has no negative zero, but the engine keeps IEEE's, whose
 * sign is observable (`1 / (0.0 * -1)` is -Infinity, as `1 / (0 * -1)` is), so a
 * zero takes the double's sign where the double is a zero too. Where the double
 * is not a zero at all (`0.1 + 0.2 - 0.3` is 5.55e-17 in doubles) the answer is
 * a plain zero.
 */
function decimalResult(d: DecimalData, approx: number): Value | null {
	const t = trimmed(d);
	if (!withinLimit(t)) return null;
	if (t.scale === 0) return t.coef === 0n ? numberValue(approx === 0 ? approx : 0) : integerResult(t.coef);
	return numberValueExact(nearestDouble(t), t);
}

/**
 * A whole number as a Value: a plain double within the safe range, and the
 * exact integer past it (see {@link exactIntegerValue}). The safe case is
 * decided on the bigint here, so it reads no global.
 */
function integerResult(n: bigint): Value {
	if (n < SAFE_COEFFICIENT && n > NEGATIVE_SAFE_COEFFICIENT) return numberValue(toDouble(n));
	return exactIntegerValue(n);
}

/** Bring two decimals to a shared scale. */
function aligned(a: DecimalData, b: DecimalData): { ca: bigint; cb: bigint; scale: number } {
	if (a.scale === b.scale) return { ca: a.coef, cb: b.coef, scale: a.scale };
	if (a.scale > b.scale) return { ca: a.coef, cb: b.coef * pow10(a.scale - b.scale), scale: a.scale };
	return { ca: a.coef * pow10(b.scale - a.scale), cb: b.coef, scale: b.scale };
}

/**
 * The exact result of `+`, `-`, `*` or `mod` between two plain numbers, or null
 * when the operation should keep its double.
 *
 * The VM calls this only when an operand carries an `exact` sidecar, so two
 * whole numbers never reach it. Null (the caller then runs the double path it
 * always ran) when an operand has no exact decimal, when the result is past
 * {@link EXACT_DECIMAL_DIGITS}, and for `mod` by zero, whose answer (NaN) the
 * double path already gives. The remainder takes the dividend's sign, as `%`
 * does.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param op - Which operation.
 * @returns The exact result, or null.
 */
export function exactDecimalArithmetic(l: Value, r: Value, op: "add" | "sub" | "mul" | "mod"): Value | null {
	const a = boundedOperand(l);
	if (a === null) return null;
	const b = boundedOperand(r);
	if (b === null) return null;
	const x = l.value as number, y = r.value as number;
	switch (op) {
		case "add": {
			const { ca, cb, scale } = aligned(a, b);
			return decimalResult({ coef: ca + cb, scale }, x + y);
		}
		case "sub": {
			const { ca, cb, scale } = aligned(a, b);
			return decimalResult({ coef: ca - cb, scale }, x - y);
		}
		case "mul":
			return decimalResult({ coef: a.coef * b.coef, scale: a.scale + b.scale }, x * y);
		case "mod": {
			if (b.coef === 0n) return null;
			const { ca, cb, scale } = aligned(a, b);
			return decimalResult({ coef: ca % cb, scale }, x % y);
		}
	}
}

/**
 * What the VM's plain `+`, `-` and `*` push when the double answer cannot simply
 * be taken: an operand carries an exact decimal, or the result left the safe
 * range.
 *
 * The decimal path first (see {@link exactDecimalArithmetic}); where it
 * declines, exactly what the fast path did before decimals were exact: the
 * double within the safe range, and the exact-integer path past it (see
 * vm/ExactIntegers.ts). Kept out of the dispatch loop on purpose, so the loop's
 * own code grows by two property tests and no more (see the note on
 * `executeBytecode`'s size in vm/VM.ts).
 *
 * @param l - The left operand, a plain Number.
 * @param r - The right operand, a plain Number.
 * @param approx - The double answer the fast path computed.
 * @param op - Which operation.
 * @returns The result to push.
 */
export function exactArithmetic(l: Value, r: Value, approx: number, op: "add" | "sub" | "mul"): Value {
	if (l.exact !== undefined || r.exact !== undefined) {
		const exact = exactDecimalArithmetic(l, r, op);
		if (exact !== null) return exact;
	}
	return approx <= SAFE_LIMIT && approx >= -SAFE_LIMIT ? numberValue(approx) : exactIntegerArithmetic(l, r, approx, op);
}

/**
 * What the VM's plain `^` pushes when the double answer cannot simply be taken:
 * the base carries an exact decimal, or the result left the safe range. The
 * power counterpart of {@link exactArithmetic}.
 *
 * @param l - The base, a plain Number.
 * @param r - The exponent, a plain Number.
 * @param approx - The double power the fast path computed.
 * @returns The result to push.
 */
export function exactPowerArithmetic(l: Value, r: Value, approx: number): Value {
	// NaN fails both range tests on the fast path, so it arrives here too.
	if (approx !== approx) return negativeBaseRoot(l, r) ?? numberValue(approx);
	if (l.exact !== undefined) {
		const exact = exactDecimalPower(l, r);
		if (exact !== null) return exact;
	}
	return approx <= SAFE_LIMIT && approx >= -SAFE_LIMIT ? numberValue(approx) : exactIntegerArithmetic(l, r, approx, "pow");
}

/**
 * The nearest whole number to `x`, a half away from zero: 2.5 is 3 and -2.5 is
 * -3. `Math.round` takes a half towards positive infinity, so -2.5 was -2 while
 * `round(-2.5, 0)` and `-2.5 to 0 dp` were -3 (#584). This is the rule those
 * already followed, and a spreadsheet's `ROUND`.
 */
export function roundHalfAwayFromZero(x: number): number {
	return x < 0 ? -round(-x) : round(x);
}

/** A number as a message writes it: at most twelve significant figures. */
function shownNumber(x: number): string {
	return String(Number(x.toPrecision(12)));
}

/**
 * A negative base to a fractional power, which a double answers with NaN: its
 * real root where it has one, a refusal by name where it does not, or null
 * when the base is not a negative number and the NaN is someone else's.
 *
 * A negative number has a real root of odd degree (`(-8)^(1/3)` is -2, since
 * -2 cubed is -8) and none of even degree, so the exponent has to be known as a
 * fraction to tell which it is. It is one when it carries a fraction's sidecar
 * (`1/3`) or was typed as a decimal (`0.2` is 1/5); `(-8)^(2/3)` is then the
 * cube root squared, 4. An exponent known only as a double, or one whose
 * fraction has an even denominator (`0.5` is 1/2), has no real answer and is
 * refused, as `log(-1)` is (#510, #588). `sqrt(-1)` answers `i`: `^` stays
 * in the real numbers.
 *
 * @param l - The base.
 * @param r - The exponent.
 */
export function negativeBaseRoot(l: Value, r: Value): Value | null {
	if (l.type !== ValueType.Number || r.type !== ValueType.Number) return null;
	const base = l.toNumber();
	const exponent = r.toNumber();
	if (!(base < 0) || !Number.isFinite(base) || !Number.isFinite(exponent)) return null;
	const fraction = r.rational ?? rationalOfExactDecimal(r);
	if (fraction !== null && fraction.d % 2n === 1n) {
		const degree = Number(fraction.d);
		let rootOf = Math.pow(-base, 1 / degree);
		// Take the whole root where there is one, so `(-8)^(1/3)` is exactly -2
		// rather than the nearest double to 8^0.333...
		const whole = round(rootOf);
		if (Math.pow(whole, degree) === -base) rootOf = whole;
		const magnitude = Math.pow(rootOf, Number(fraction.n));
		return numberValue(fraction.n % 2n === 0n ? magnitude : -magnitude);
	}
	return errorValue(
		"POWER_NO_REAL_VALUE",
		`(${shownNumber(base)})^${shownNumber(exponent)} has no real value: a negative number to a fractional power has one only when the fraction's denominator is odd, as in (-8)^(1/3).`,
	);
}

/**
 * The exact remainder when an operand carries an exact integer or an exact
 * decimal, or null, which keeps the double `%`.
 *
 * An exact integer takes its remainder from that integer (see
 * vm/ExactIntegers.ts's `exactIntegerRemainder`); a decimal takes it in base
 * ten, so `0.5 mod 0.2` is exactly 0.1.
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns The exact remainder, or null.
 */
export function exactRemainder(l: Value, r: Value): Value | null {
	if (l.rational !== undefined || r.rational !== undefined) return exactIntegerRemainder(l, r);
	return exactDecimalArithmetic(l, r, "mod");
}

/**
 * The exact rational a decimal stands for, `coef / 10^scale`, reduced.
 *
 * @param d - A decimal within the digit limit.
 * @returns The same number as a {@link Rational}.
 */
function rationalOf(d: DecimalData): Rational {
	return rational(d.coef, pow10(d.scale));
}

/**
 * The exact rational a plain number's decimal stands for, or null.
 *
 * The bridge between the two exact sidecars: a fraction meeting a decimal
 * (`1/3 + 0.1`, `1/3 < 0.34`) is decided on fractions, and this is the decimal's
 * fraction. Only a plain Number carrying `exact` answers, and only within the
 * digit limit; money carries `exact` too but must keep its currency, so a unit
 * never converts here.
 *
 * @param v - The operand.
 * @returns `exact` as a reduced rational, or null.
 */
export function rationalOfExactDecimal(v: Value): Rational | null {
	if (v.type !== ValueType.Number || v.exact === undefined || !withinLimit(v.exact)) return null;
	return rationalOf(v.exact);
}

/**
 * The number of places a reduced fraction's decimal expansion has, or null when
 * it never ends.
 *
 * A fraction terminates in base ten exactly when its denominator has no prime
 * factor but 2 and 5, and then it needs as many places as the larger of the two
 * counts: 1/8 is 2^-3, three places; 1/20 is 2^-2 * 5^-1, two.
 */
function terminatingPlaces(denominator: bigint): number | null {
	let rest = denominator;
	let twos = 0;
	let fives = 0;
	while (rest % 2n === 0n) { rest /= 2n; twos++; }
	while (rest % 5n === 0n) { rest /= 5n; fives++; }
	return rest === 1n ? Math.max(twos, fives) : null;
}

/**
 * A reduced fraction as the exact Value the engine carries for it: a decimal
 * where it terminates within the digit limit, the fraction itself where it does
 * not, or null when even that has no finite double. `approx` is the double
 * quotient, for the sign of a zero (see {@link decimalResult}).
 */
function quotientResult(q: Rational, approx: number): Value | null {
	const places = terminatingPlaces(q.d);
	if (places !== null && places <= EXACT_DECIMAL_DIGITS) {
		const asDecimal = decimalResult({ coef: q.n * (pow10(places) / q.d), scale: places }, approx);
		if (asDecimal !== null) return asDecimal;
	}
	const nearest = rationalToNumber(q);
	if (!Number.isFinite(nearest)) return null;
	return numberValueRational(nearest, q);
}

/**
 * The exact quotient of two plain numbers, or null when the division should
 * keep its double.
 *
 * Exact where it terminates (`1.2 / 0.4` is exactly 3, `0.3 / 0.1` exactly 3,
 * `1 / 0.8` exactly 1.25) and an exact fraction where it does not: `0.1 / 3`
 * carries 1/30, the rational sidecar `1/3` already carries, so the rest of the
 * engine treats the two alike. Null for a zero divisor, which keeps the double's
 * Infinity or NaN exactly as `1 / 0` answers, and whenever an operand has no
 * exact decimal.
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns The exact quotient, or null.
 */
export function exactDecimalDivide(l: Value, r: Value): Value | null {
	const a = boundedOperand(l);
	if (a === null) return null;
	const b = boundedOperand(r);
	if (b === null || b.coef === 0n) return null;
	// a / b = (a.coef * 10^b.scale) / (b.coef * 10^a.scale), reduced.
	return quotientResult(rational(a.coef * pow10(b.scale), b.coef * pow10(a.scale)), (l.value as number) / (r.value as number));
}

/**
 * The exact value of a decimal raised to a whole power, or null.
 *
 * `1.1 ^ 2` is exactly 1.21, the product it abbreviates. Only a base carrying
 * an exact decimal and a whole-number exponent qualify; a fractional exponent
 * is a root, which is irrational in general and stays in floating point. A
 * negative exponent is the reciprocal of the positive power, a quotient like any
 * other, so `2.5 ^ -1` is exactly 0.4 and `0.3 ^ -1` the fraction 10/3. Null
 * past the digit limit, which a size estimate refuses before any power is
 * built, and for zero raised to a negative power, whose answer (Infinity) the
 * double path already gives.
 *
 * @param base - The base.
 * @param exponent - The exponent.
 * @returns The exact power, or null.
 */
export function exactDecimalPower(base: Value, exponent: Value): Value | null {
	if (base.exact === undefined) return null;
	const b = boundedOperand(base);
	if (b === null) return null;
	const e = exponent.type === ValueType.Number && exponent.rational === undefined && exponent.uncertainty === undefined
		? (exponent.value as number)
		: NaN;
	if (!isSafeInteger(e)) return null;
	const t = trimmed(b);
	const n = Math.abs(e);
	// Refused from its size before it is built, since the result has to fit in
	// the limit anyway. An n-th power has about n times the base's digits, and a
	// coefficient of two or more at least doubles with every power, so past 4 *
	// 34 powers it is certainly too long even when it is one digit wide (`5.0 ^
	// 1000000000` would otherwise build a 700-million-digit integer to discard).
	const magnitude = t.coef < 0n ? -t.coef : t.coef;
	if (magnitude > 1n && n > 4 * EXACT_DECIMAL_DIGITS) return null;
	const digits = magnitude.toString().length;
	if (n > 0 && (digits - 1) * n > EXACT_DECIMAL_DIGITS) return null;
	if (t.scale * n > EXACT_DECIMAL_DIGITS) return null;
	const power: DecimalData = { coef: bigIntPow(t.coef, toBigInt(n)), scale: t.scale * n };
	const approx = Math.pow(base.value as number, e);
	if (e >= 0) return decimalResult(power, approx);
	if (power.coef === 0n) return null;
	return quotientResult(rational(pow10(power.scale), power.coef), approx);
}

/**
 * Three-way comparison of two plain numbers on their exact decimals, or null.
 *
 * `0.1 + 0.2 == 0.3` is decided on 0.3 against 0.3, not on the two doubles.
 * Null when either side has no exact decimal (a computed irrational, NaN, an
 * infinity), which leaves the caller's double comparison in place, so NaN is
 * still unequal to everything and `sqrt(2) * sqrt(2) == 2` still answers what
 * floating point says. No digit limit applies: a comparison builds nothing.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns -1, 0 or 1, or null.
 */
export function compareExactDecimals(l: Value, r: Value): -1 | 0 | 1 | null {
	const a = exactDecimalOf(l);
	if (a === null) return null;
	const b = exactDecimalOf(r);
	if (b === null) return null;
	return decimalCompare(a, b);
}

/**
 * The exact total, or mean, of a list of plain numbers, or null.
 *
 * `total above`, `sum(line 1 : line 3)`, `total of #tag` and `total of 0.1, 0.2`
 * all add a column, and a column of decimals has an exact total the same way a
 * pair of them has an exact sum. Only when every value is a plain Number with an
 * exact decimal and at least one carries the sidecar; a column with a unit, a
 * fraction, a measurement or a computed irrational in it keeps the double sum,
 * and so does a column of whole numbers, whose double sum is already exact. A
 * mean is the total divided by the count, exact where it terminates and a
 * fraction where it does not, as {@link exactDecimalDivide} is.
 *
 * @param values - The values to add, already checked to be numeric.
 * @param mean - Divide by the count when true.
 * @returns The exact total or mean, or null.
 */
export function exactDecimalTotal(values: readonly Value[], mean: boolean): Value | null {
	if (values.length === 0) return null;
	let sawSidecar = false;
	let coef = 0n;
	let scale = 0;
	let approx = 0;
	for (const v of values) {
		if (v.type !== ValueType.Number) return null;
		if (v.exact !== undefined) sawSidecar = true;
		const d = boundedOperand(v);
		if (d === null) return null;
		if (d.scale > scale) {
			coef *= pow10(d.scale - scale);
			scale = d.scale;
		}
		coef += d.coef * pow10(scale - d.scale);
		approx += v.value as number;
	}
	if (!sawSidecar) return null;
	const total: DecimalData = { coef, scale };
	if (!mean) return decimalResult(total, approx);
	return quotientResult(rational(coef, pow10(scale) * toBigInt(values.length)), approx / values.length);
}

/**
 * Round a plain number carrying an exact decimal to a whole number, or null.
 *
 * `floor`, `ceil`, `trunc` and `round` read the decimal rather than its double,
 * which can sit on the far side of a whole number from the value typed:
 * 2.99999999999999999 is a double of exactly 3, so its floor was 3. `round`
 * keeps the rule it has always had, a half rounds up (towards positive
 * infinity), so `round(-2.5)` is -2 as before. Null for anything without the
 * sidecar, which keeps its path.
 *
 * @param v - The operand.
 * @param mode - Which rounding.
 * @returns The whole-number result, or null.
 */
export function roundExactDecimalToWhole(v: Value, mode: "floor" | "ceil" | "trunc" | "round"): Value | null {
	if (v.type !== ValueType.Number || v.exact === undefined) return null;
	const { coef, scale } = v.exact;
	// A negative value rounding to zero is IEEE's negative zero, as Math.ceil,
	// Math.trunc and Math.round give it (`ceil(-0.5)` is -0), and so is a
	// negative zero rounded; see decimalResult for why that sign is kept.
	const negative = coef < 0n || Object.is(v.value, -0);
	if (scale === 0) return wholeResult(coef, negative);
	const divisor = pow10(scale);
	// BigInt division truncates towards zero; the remainder takes coef's sign.
	const truncated = coef / divisor;
	const remainder = coef % divisor;
	if (remainder === 0n) return wholeResult(truncated, negative);
	let whole: bigint;
	switch (mode) {
		case "trunc": whole = truncated; break;
		case "floor": whole = remainder < 0n ? truncated - 1n : truncated; break;
		case "ceil": whole = remainder > 0n ? truncated + 1n : truncated; break;
		case "round": {
			// A half goes away from zero, the rule `to N dp` rounds by (#584):
			// 2.5 is 3 and -2.5 is -3.
			const doubled = 2n * remainder;
			if (remainder > 0n) whole = doubled >= divisor ? truncated + 1n : truncated;
			else whole = -doubled >= divisor ? truncated - 1n : truncated;
			break;
		}
	}
	return wholeResult(whole, negative);
}

/** A whole number as a Value, a zero carrying the sign of the value it came from. */
function wholeResult(whole: bigint, negative: boolean): Value {
	if (whole === 0n) return numberValue(negative ? -0 : 0);
	return integerResult(whole);
}

/**
 * How many significant digits every decimal keeps through a double unchanged.
 * Fifteen is the guarantee IEEE 754 gives: any decimal that short converts to a
 * double and back to the same digits, so a double that is the nearest one to a
 * decimal that short is that decimal someone typed, not a rounding of a longer one.
 */
const ROUND_TRIP_LIMIT = 1e15;

/** The largest whole number a double holds exactly, held as a constant (see the note on the globals above). */
const SAFE_LIMIT = 9007199254740991;
const round = Math.round;
const abs = Math.abs;

/** Where {@link readPercent} writes what it found, so the hot path allocates nothing. */
let percentCoef = 0;
let percentPlaces = 0;

/**
 * The typed decimal behind a percentage's proportion, as a coefficient and a
 * place count, written to {@link percentCoef} and {@link percentPlaces}.
 *
 * A percentage is held as a proportion in a double (`15%` is 0.15). The decimal
 * it was typed as is the one with the fewest places whose nearest double is
 * the proportion: `round(p * 10^k) / 10^k === p` at the first `k` it holds for.
 * That test is exact, because the coefficient and the power of ten are both
 * exact doubles and one IEEE division rounds correctly. It is the typed decimal
 * whenever it has at most fifteen significant digits, which every percentage a
 * person writes does; a longer one is a computed proportion (`(1/3) as %`), and
 * keeps the double. Done in doubles rather than through the proportion's
 * string, because this runs on every `x + p%` and `p% of x`.
 *
 * @returns Whether a typed decimal was found.
 */
function readPercent(proportion: number): boolean {
	let scale = 1;
	for (let places = 0; places < POW10_DOUBLE.length; places++) {
		const coef = round(proportion * scale);
		if (coef / scale === proportion) {
			if (abs(coef) >= ROUND_TRIP_LIMIT) return false;
			percentCoef = coef;
			percentPlaces = places;
			return true;
		}
		scale = POW10_DOUBLE[places + 1];
	}
	return false;
}

/**
 * `x * factor / 10^places` for a whole number `x` and a whole `factor`, done in
 * doubles while the product stays exact, or null past that. The common shape of
 * a percentage on a plain number (`200 + 15%`, `50% of 200`), and cheap: a
 * whole-number answer builds no bigint at all.
 */
function scaleWholeExactly(x: number, factor: number, places: number, approx: number): Value | null {
	const product = x * factor;
	if (!(abs(product) <= SAFE_LIMIT)) return null;
	if (product === 0) return numberValue(approx === 0 ? approx : 0);
	const divisor = POW10_DOUBLE[places];
	if (product % divisor === 0) return numberValue(product / divisor);
	let coef = product;
	let scale = places;
	while (coef % 10 === 0) { coef /= 10; scale--; }
	return numberValueExact(coef / POW10_DOUBLE[scale], { coef: toBigInt(coef), scale });
}

/**
 * `x + p%` or `x - p%` on a plain number, exact, or null.
 *
 * The plain-number counterpart of money's percentage scaling: `x * (1 + p)`
 * formed in base ten, so `100 + 10%` is exactly 110 (the doubles give
 * 110.00000000000001, which showed as 110.00) and `0.1 + 10% == 0.11` is true.
 * Null when the number has no exact decimal or the percentage has no typed
 * decimal (see {@link readPercent}), which keeps the double.
 *
 * @param v - The number being scaled.
 * @param proportion - The percentage as a proportion (`0.15` for 15%).
 * @param sign - `1` to add the percentage, `-1` to take it away.
 * @returns The exact result, or null.
 */
export function scaleByPercentExact(v: Value, proportion: number, sign: 1 | -1): Value | null {
	if (v.type !== ValueType.Number || !readPercent(proportion)) return null;
	const approx = (v.value as number) * (1 + sign * proportion);
	const one = POW10_DOUBLE[percentPlaces];
	const factor = sign === 1 ? one + percentCoef : one - percentCoef;
	if (v.exact === undefined && v.rational === undefined && v.uncertainty === undefined && isSafeInteger(v.value as number)) {
		const quick = scaleWholeExactly(v.value as number, factor, percentPlaces, approx);
		if (quick !== null) return quick;
	}
	const a = boundedOperand(v);
	if (a === null) return null;
	return decimalResult({ coef: a.coef * toBigInt(factor), scale: a.scale + percentPlaces }, approx);
}

/**
 * `p% of x` (or `x * p%`) on a plain number, exact, or null.
 *
 * A share of a number is a product, and exact for the same reason `x + p%` is:
 * `10% of 0.1` is exactly 0.01. Null under the same conditions as
 * {@link scaleByPercentExact}.
 *
 * @param v - The number the share is taken of.
 * @param proportion - The percentage as a proportion.
 * @returns The exact share, or null.
 */
export function multiplyByPercentExact(v: Value, proportion: number): Value | null {
	if (v.type !== ValueType.Number || !readPercent(proportion)) return null;
	const approx = (v.value as number) * proportion;
	if (v.exact === undefined && v.rational === undefined && v.uncertainty === undefined && isSafeInteger(v.value as number)) {
		const quick = scaleWholeExactly(v.value as number, percentCoef, percentPlaces, approx);
		if (quick !== null) return quick;
	}
	const a = boundedOperand(v);
	if (a === null) return null;
	return decimalResult({ coef: a.coef * toBigInt(percentCoef), scale: a.scale + percentPlaces }, approx);
}

/**
 * The absolute value of a plain number carrying an exact decimal, still exact,
 * or null for anything without the sidecar.
 *
 * A fresh Value rather than the operand itself, so a display precision the
 * operand was given (`abs(-1.5 to 3 dp)`) is not carried to the result, which
 * is how `abs` has always treated it.
 *
 * @param v - The operand.
 * @returns `|v|` with its exact decimal, or null.
 */
export function absExactDecimal(v: Value): Value | null {
	if (v.type !== ValueType.Number || v.exact === undefined) return null;
	const { coef, scale } = v.exact;
	return numberValueExact(Math.abs(v.value as number), coef < 0n ? { coef: -coef, scale } : v.exact);
}

/**
 * Round an exact fraction to a number of places, half away from zero, as the
 * exact decimal it rounds to.
 *
 * The rational counterpart of `decimalRound`, for `to N dp` on a value that
 * carries a fraction: `(201/200) to 2 dp` is 1.01, where the double (1.00499...)
 * rounded down to 1.00.
 *
 * @param q - The fraction.
 * @param places - The number of places, a non-negative integer.
 * @returns The rounded decimal.
 */
export function roundRationalToPlaces(q: Rational, places: number): DecimalData {
	const scaled = (q.n < 0n ? -q.n : q.n) * pow10(places);
	let whole = scaled / q.d;
	if ((scaled % q.d) * 2n >= q.d) whole += 1n;
	return { coef: q.n < 0n ? -whole : whole, scale: places };
}
