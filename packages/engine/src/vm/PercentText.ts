import { numberText } from "@solve-js/utilities/Number";
import { cellDecimal } from "@solve-js/vm/ListRounding";
import { decimalFromLiteral, decimalMultiply, decimalToString } from "@solve-js/decimal";

/**
 * A percentage written back as the reader wrote it, for a refusal that quotes
 * one. A leaf of its own, so the list cells (vm/MatrixUnits.ts) and the
 * aggregates (vm/VMConversion.ts) can both quote a percentage without the two
 * modules reading each other.
 */

/** One hundred, as an exact decimal, to move a fraction's point two places. */
const HUNDRED = decimalFromLiteral("100");

/**
 * A fraction as the percentage a reader wrote, with no rounding noise: 0.07 is
 * `7`, where the double `0.07 * 100` is 7.000000000000001. The fraction's
 * shortest decimal is moved two places exactly. A fraction too large or too
 * small to write out in full is given in exponent form.
 *
 * @param fraction - A finite fraction (0.1 for 10%).
 * @returns The percentage's number, with its sign.
 */
export function percentText(fraction: number): string {
	const magnitude = Math.abs(fraction);
	const exact = magnitude === 0 || (magnitude >= 1e-6 && magnitude < 1e15) ? cellDecimal(fraction) : undefined;
	if (exact === undefined) return numberText(fraction * 100);
	const text = decimalToString(decimalMultiply(exact, HUNDRED));
	return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
