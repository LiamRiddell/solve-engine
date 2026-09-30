import { Value, ValueType, numberValue, errorValue } from "@solve-js/vm/Value";
import { describeQuantity, nonNumericKind, datetimeConversionRefused } from "@solve-js/vm/VMConversion";

/**
 * The two forms that take a plain number and nothing else: `float(x)` and
 * `<x> as multiplier` (#828, #829).
 *
 * Both used to read whatever they were given through `toNumber()`, which is 0
 * for text and the bare magnitude for a quantity, so `"hello" as multiplier`
 * answered `0x`, `5 km as multiplier` answered `5x` with the kilometres
 * dropped, and `float` built a one-by-one matrix. Each now answers for a plain
 * number (and a percentage, which is one) and refuses anything else by name.
 */

/** A number written as text: digits with optional commas grouping thousands, a decimal part and an exponent. */
const NUMBER_TEXT = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** The longest piece of the reader's text a refusal quotes back. */
const QUOTED_TEXT_LIMIT = 40;

/**
 * How a refusal names a value that is not a plain number: "text", "a length",
 * "true or false", or undefined when the value is one.
 *
 * @param v - The value to name.
 */
export function notPlainNumberKind(v: Value): string | undefined {
	switch (v.type) {
		case ValueType.Number:
		case ValueType.Percentage:
		case ValueType.BigInt:
		case ValueType.Hex:
			return undefined;
		case ValueType.Uom:
			return v.unit === undefined ? undefined : describeQuantity(v.unit);
		case ValueType.Boolean:
			return "true or false";
		default:
			return nonNumericKind(v) ?? "a value with no plain number";
	}
}

/**
 * `float(x)`: the plain number `x` is.
 *
 * A number is returned as it is, exact digits and all; a percentage is its
 * fraction (`float(50%)` is 0.5); a big integer or a hex value is its number;
 * text that spells a number whole is that number (`float("2.5")` is 2.5).
 * Everything else is refused with `FLOAT_TAKES_NUMBER`, text that is not a
 * number included, rather than read as 0.
 *
 * @param v - The argument, already evaluated.
 * @returns The number, or the refusal as an error Value.
 */
export function floatOf(v: Value): Value {
	if (v.type === ValueType.Error) return v;
	if (v.type === ValueType.Number) return v;
	if (v.type === ValueType.String) {
		const text = String(v.value);
		const trimmed = text.trim();
		if (NUMBER_TEXT.test(trimmed)) return numberValue(Number(trimmed.replace(/,/g, "")));
		const quoted = text.length > QUOTED_TEXT_LIMIT ? `${text.slice(0, QUOTED_TEXT_LIMIT)}...` : text;
		return errorValue("FLOAT_TAKES_NUMBER", `float takes a number, or text that is a number, and "${quoted}" is not one.`);
	}
	const kind = notPlainNumberKind(v);
	if (kind !== undefined) {
		return errorValue("FLOAT_TAKES_NUMBER", `float takes a plain number, not ${kind}.`);
	}
	return numberValue(v.toNumber());
}

/**
 * The refusal for `<x> as multiplier` when `x` is not a plain number or a
 * percentage, or null when it is.
 *
 * A multiplier is how many times something grows (`0.5 as multiplier` is
 * `0.5x`, `50% as multiplier` is `1.5x`), so it is a bare count: text has none,
 * and a quantity's unit would be dropped without a word. A date keeps the
 * refusal every numeric conversion gives it.
 *
 * @param v - The value being converted, already checked for an error operand.
 * @returns The error Value to answer with, or null.
 */
export function multiplierRefused(v: Value): Value | null {
	const date = datetimeConversionRefused(v, "a multiplier");
	if (date !== null) return date;
	const kind = notPlainNumberKind(v);
	if (kind === undefined) return null;
	return errorValue(
		"MULTIPLIER_TAKES_NUMBER",
		`A multiplier is a plain number or a percentage, as in "0.5 as multiplier" or "50% as multiplier", not ${kind}.`,
	);
}
