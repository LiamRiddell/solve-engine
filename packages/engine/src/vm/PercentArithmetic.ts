import { Value, ValueType, errorValue, numberValue } from "@solve-js/vm/Value";
import { percentageAnswer, percentageNotFinite, power } from "@solve-js/vm/VMConversion";
import { negativeBaseRoot, percentPower, percentProduct, percentQuotient } from "@solve-js/vm/ExactDecimals";
import { percentText } from "@solve-js/vm/PercentText";
import { numberText } from "@solve-js/utilities/Number";

/**
 * The products, quotients and powers whose answer is still a percentage.
 *
 * A percentage is held as its fraction (0.1 for 10%), and `*`, `/` and `^`
 * used to read it as that fraction and answer a plain number, so `10% * 20%`
 * was 0.02 where the reader wrote two shares, and `rate / 12` was 0.005 where
 * the reader wanted a monthly rate. The rule each operator now follows:
 *
 *   10% * 20%     2%       a share of a share is a share, as `10% of 20%` is
 *   10% / 2       5%       half a share is a share
 *   10% ^ 2       1%       a share of a share, written as a power
 *   10% * 200     20       a share of a number is that part of it (unchanged)
 *   10% * $5      $0.50    a share of an amount is an amount (unchanged)
 *   10% / 20%     0.5      a share over a share is a ratio (unchanged)
 *   200 / 10%     2,000    a number over a share is a number (unchanged)
 *
 * A percentage times a plain number keeps its documented reading, the share of
 * that number (`50% * 30` is 15, as `50% of 30` is), since that is what a
 * reader writing `100 * 40%` means. Dividing has no such reading: no one means
 * `10% / 2` as a share of a half, so it is half the share.
 *
 * Each answer is formed in base ten (see `percentProduct` and its siblings in
 * vm/ExactDecimals.ts), so `10% * 20% == 2%` is true. Kept out of the dispatch
 * loop, which calls each helper only after its own plain-number fast path.
 *
 * @module PercentArithmetic
 */

/**
 * `p% * q%` (and `p% of q%`, which compiles to the same multiply) as a
 * percentage, or null when the two operands are not both percentages.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns The percentage, a refusal for one too large to write, or null.
 */
export function percentageTimesPercentage(l: Value, r: Value): Value | null {
	if (l.type !== ValueType.Percentage || r.type !== ValueType.Percentage) return null;
	return percentageAnswer(percentProduct(l.value as number, r.value as number));
}

/**
 * `p% / n` for a plain number `n` as a percentage, or null for any other pair
 * (a percentage over a percentage is a plain ratio, a number over a percentage
 * a plain number, and a divisor carrying an uncertainty keeps its own path).
 * A zero divisor is refused as a percentage with no finite value, rather than
 * shown as an infinite percentage. A true or false divisor counts as 1 or 0, as
 * it does in every other sum (`10% / true` is 10%, where it was a plain 0.10).
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns The percentage, a refusal, or null.
 */
export function percentageOverNumber(l: Value, r: Value): Value | null {
	if (l.type !== ValueType.Percentage || r.uncertainty !== undefined) return null;
	if (r.type !== ValueType.Number && r.type !== ValueType.Boolean) return null;
	const divisor = r.type === ValueType.Boolean ? (r.value ? 1 : 0) : (r.value as number);
	if (divisor === 0) return percentageNotFinite();
	return percentageAnswer(percentQuotient(l.value as number, divisor));
}

/**
 * `p% ^ n` for a plain number `n` as a percentage, or null for any other pair.
 * A negative percentage to a fractional power has a real answer only for an
 * odd root, as a negative number has (see `negativeBaseRoot`), and is refused
 * by name otherwise, where the double power was NaN; a zero raised to a
 * negative power is a division by zero, and is refused as one.
 *
 * @param l - The base.
 * @param r - The exponent.
 * @returns The percentage, a refusal, or null.
 */
export function percentageToPower(l: Value, r: Value): Value | null {
	if (l.type !== ValueType.Percentage || r.type !== ValueType.Number) return null;
	const base = l.value as number;
	const exponent = r.value as number;
	const approx = power(base, exponent);
	if (approx !== approx) {
		const root = negativeBaseRoot(numberValue(base), r);
		if (root === null) return null;
		if (!root.isError()) return percentageAnswer(root.toNumber());
		return errorValue(
			"POWER_NO_REAL_VALUE",
			`(${percentText(base)}%)^${numberText(exponent)} has no real value: a negative percentage to a fractional power has one only when the fraction's denominator is odd, as in (-8%)^(1/3).`,
		);
	}
	if (base === 0 && exponent < 0) return percentageNotFinite();
	return percentageAnswer(percentPower(base, exponent, approx));
}
