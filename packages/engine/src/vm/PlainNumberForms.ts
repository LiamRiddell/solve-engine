import { Value, ValueType, numberValue, errorValue } from "@solve-js/vm/Value";
import { describeQuantity, nonNumericKind, datetimeConversionRefused } from "@solve-js/vm/VMConversion";
import { exactIntegerValue } from "@solve-js/vm/ExactIntegers";

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
 * `int("...")`: the whole number a piece of text spells, its fraction cut off
 * toward zero as `int` cuts a number's (`int("2.7")` is 2, `int("-2.7")` is
 * -2). Text that does not spell a number whole is refused with
 * `TEXT_NOT_A_NUMBER`, where `toNumber()` read it through `parseFloat`: `int("abc")`
 * answered 0 and `int("12abc")` answered 12.
 *
 * @param text - The text to read.
 * @returns The whole number, or the refusal as an error Value.
 */
export function intOfText(text: string): Value {
	const trimmed = text.trim();
	if (NUMBER_TEXT.test(trimmed)) return numberValue(Math.trunc(Number(trimmed.replace(/,/g, ""))));
	const quoted = text.length > QUOTED_TEXT_LIMIT ? `${text.slice(0, QUOTED_TEXT_LIMIT)}...` : text;
	return errorValue("TEXT_NOT_A_NUMBER", `"${quoted}" is not a number: int reads text that is a number and nothing else.`);
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

/** A base a typed number can name with a prefix: what a refusal calls it, the digits it has and the bits one digit carries. */
interface PrefixedBase {
	/** The base's name with its article: "a hexadecimal", "an octal". */
	readonly name: string;
	readonly digits: RegExp;
	readonly allowed: string;
	readonly bits: number;
}

const HEX_TEXT: PrefixedBase = { name: "a hexadecimal", digits: /^[0-9a-f]+$/i, allowed: "the digits 0 to 9 and the letters A to F", bits: 4 };
const BINARY_TEXT: PrefixedBase = { name: "a binary", digits: /^[01]+$/, allowed: "the digits 0 and 1", bits: 1 };
const OCTAL_TEXT: PrefixedBase = { name: "an octal", digits: /^[0-7]+$/, allowed: "the digits 0 to 7", bits: 3 };

/** A sign, then `0` and a base letter, as a typed number writes them: `0x`, `0X`, `0b`, `0B`, `0o`, `0O`. */
const BASE_PREFIX = /^([+-]?)0([xXbBoO])/;

/** The bits of the largest double (about 1.8e308); a whole number with more is past it, so its digits need not be read. */
const MOST_BASE_TEXT_BITS = 1024;

/**
 * The number a piece of text writes with a base prefix (`"0xFF"`, `"0b101"`,
 * `"0o17"`), the prefixes a typed number reads, or null when the text has no
 * such prefix and is left to the decimal reading.
 *
 * `as number` read decimal digits only, so `"0xFF" as number` was refused
 * though `0xFF` typed as a number is 255. The prefix is read as a typed
 * number reads it, in either case, after an optional sign. The digits are
 * read exactly, so `"0x20000000000001" as number` is 2^53 + 1 and not the
 * double beside it; a number past about 1.8e308 is the infinity a double
 * holds there, as `"1e400" as number` is. A prefix with no digits after it,
 * or with a digit its base does not have (`"0xZZ"`, `"0b102"`, `"0o19"`), is
 * refused by name, saying which digits the base allows.
 *
 * @param trimmed - The text, spaces at either end already removed.
 * @param written - The text as the reader wrote it, for the refusal.
 * @returns The number, the refusal, or null for text with no base prefix.
 */
export function numberFromBaseText(trimmed: string, written: string): Value | null {
	const match = BASE_PREFIX.exec(trimmed);
	if (match === null) return null;
	const letter = match[2].toLowerCase();
	const base = letter === "x" ? HEX_TEXT : letter === "b" ? BINARY_TEXT : OCTAL_TEXT;
	const prefix = `0${letter}`;
	const digits = trimmed.slice(match[0].length);
	const quoted = written.length > QUOTED_TEXT_LIMIT ? `${written.slice(0, QUOTED_TEXT_LIMIT)}...` : written;
	if (digits === "") {
		return errorValue("TEXT_NOT_A_NUMBER", `"${quoted}" is not a number: ${prefix} starts ${base.name} number, and no digits follow it.`);
	}
	if (!base.digits.test(digits)) {
		return errorValue("TEXT_NOT_A_NUMBER", `"${quoted}" is not a number: after ${prefix}, ${base.name} number has only ${base.allowed}.`);
	}
	const negative = match[1] === "-";
	// Leading zeros add no size, so they are left out of the size test.
	const significant = digits.replace(/^0+/, "");
	if (significant === "") return numberValue(0);
	if ((significant.length - 1) * base.bits >= MOST_BASE_TEXT_BITS) {
		return numberValue(negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
	}
	const magnitude = BigInt(`${prefix}${significant}`);
	return exactIntegerValue(negative ? -magnitude : magnitude);
}
