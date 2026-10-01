/**
 * The quotients with no single answer, refused by name.
 *
 * `5 / 0` is ∞: as the divisor shrinks towards zero the quotient grows without
 * bound, and the engine answers with that infinity. `0 / 0` has no such
 * answer. Every number times 0 is 0, so every number is an equally good
 * quotient, and JavaScript answers NaN ("not a number"), which reached the
 * reader with nothing to say why. An infinity over an infinity is the same
 * case from the other end. Both are now refused, as `0 mod 0` already is.
 *
 * The boundary is the division itself. A NaN that arrives as an operand is
 * passed along as it came; `∞ - ∞` and `0 * ∞` are not divisions and keep
 * their NaN; and a list divided cell by cell (`[0, 1] / 0`) keeps its NaN
 * cell, since a cell of a list holds a number and has no room for a refusal.
 */

import { Value, ValueType, errorValue, numberValue } from "@solve-js/vm/Value";

/**
 * The quotient of a division whose divisor is zero, as a Value: the infinity
 * the double gives, marked as one a division by zero gave (see
 * `Value.divisionByZero`), so a refusal further on can say so rather than call
 * it a number too large to hold. A quotient that is not infinite (NaN, which
 * {@link indeterminateQuotient} refuses before this is reached) is unmarked.
 *
 * @param q - The double quotient, `a / 0` for some `a`.
 * @returns The Number Value.
 */
export function zeroDivisorQuotient(q: number): Value {
	const v = numberValue(q);
	if (q === Number.POSITIVE_INFINITY || q === Number.NEGATIVE_INFINITY) v.divisionByZero = true;
	return v;
}

/**
 * An infinite result of `+`, `-`, `*` or `^`, carrying the mark of an operand
 * that came from a division by zero (see {@link zeroDivisorQuotient}), so
 * `1 - 40/0` is still an infinity a division by zero gave. Unmarked when no
 * operand is marked: two finite numbers whose result is infinite grew past
 * the largest double.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param approx - The infinite result.
 * @returns The Number Value.
 */
export function infiniteResult(l: Value, r: Value, approx: number): Value {
	const v = numberValue(approx);
	if ((l.divisionByZero === true || r.divisionByZero === true) && (approx === Number.POSITIVE_INFINITY || approx === Number.NEGATIVE_INFINITY)) v.divisionByZero = true;
	return v;
}

/**
 * A plain number, an amount in a unit, or a percentage: the operands whose
 * value is one number and whose quotient could be NaN.
 */
function numericValue(v: Value): number | null {
	if (v.type !== ValueType.Number && v.type !== ValueType.Uom && v.type !== ValueType.Percentage) return null;
	return typeof v.value === "number" ? v.value : null;
}

/** Plus or minus infinity, and not NaN. */
function isInfinite(n: number): boolean {
	return n === Number.POSITIVE_INFINITY || n === Number.NEGATIVE_INFINITY;
}

/**
 * The refusal for a division with no single answer, or null for every other.
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns An error Value for zero over zero (either sign) or an infinity
 * over an infinity; null otherwise, including for any operand that is not a
 * single number.
 */
export function indeterminateQuotient(l: Value, r: Value): Value | null {
	const a = numericValue(l);
	if (a === null) return null;
	const b = numericValue(r);
	if (b === null) return null;
	if (a === 0 && b === 0) {
		return errorValue("QUOTIENT_UNDEFINED", "0 divided by 0 has no single answer: every number times 0 is 0, so no one quotient is right.");
	}
	if (isInfinite(a) && isInfinite(b)) {
		return errorValue("QUOTIENT_UNDEFINED", "∞ divided by ∞ has no single answer: two infinities have no size to compare, so no one quotient is right.");
	}
	return null;
}
