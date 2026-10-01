/**
 * The work behind a `check` line (#506): compare two values, pass quietly with
 * a tick, or fail with an error that names both sides.
 *
 * Numbers and quantities are compared in a shared unit, reconciled the way the
 * engine's own comparisons reconcile them, so `check 1 km == 1000 m` passes.
 * An exact kind (a decimal, a fraction, money, a whole number past 2^53) is
 * compared exactly, as the operators compare it; a pair of plain doubles is
 * allowed the conversion's own rounding (a millionth of a millionth,
 * relatively), and `≈` or a `within` clause widens that to a tolerance: a
 * percentage is relative to the right-hand side, a number or a quantity is an
 * absolute margin. Text compares with `==` and `!=` only.
 */

import { Value, ValueType, stringValue, errorValue } from "@solve-js/vm/Value";
import { unifyUom, describeMeasureMismatch, compareBigIntOperands, compareRationalOperands } from "@solve-js/vm/VMConversion";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, type FormattingSettings } from "@solve-js/format/FormattingSettings";
import { decimalCompare } from "@solve-js/decimal";
import { convertRate } from "@solve-js/uom/UomConverter";
import { fixedDecimalText, shortestText } from "@solve-js/utilities/Number";
import { valuesEqual, valuesOrdered, hasExactSide, type Order } from "@solve-js/vm/Comparisons";
import { kindOfOperand } from "./NotFunctions";

/** The relative gap two values may differ by and still be equal: a conversion's rounding. */
const EQUAL_TOLERANCE = 1e-12;

/** The relative gap `≈` allows when no `within` names one: rounding noise, not a real difference. */
const APPROX_TOLERANCE = 1e-9;

/** The decimal places a result is shown to, where widening a failure's sides starts from. */
const SHOWN_PLACES = DEFAULT_FORMATTING_SETTINGS.floatResult.decimalPlaces;

/**
 * The most decimal places a failure's sides are widened to before they are
 * left as they read: past a double's seventeen digits, so an exact decimal
 * with a long tail can still be told from its neighbour.
 */
const MOST_PLACES = 20;

/** A value as the reader sees it, without the result marker. */
function shown(value: Value, settings?: FormattingSettings): string {
	return formatValue(value, settings).replace(/^=\s*/, "");
}

/** A value shown to a given number of decimal places, a plain number, a quantity and a percentage alike. */
function shownTo(value: Value, places: number): string {
	const base = DEFAULT_FORMATTING_SETTINGS;
	return shown(value, {
		...base,
		floatResult: { ...base.floatResult, decimalPlaces: places },
		// Every side to the same places, money included: a failure widened to
		// tell two amounts apart must not be cut back to the currency's minor unit.
		unitOfMeasurementResult: { decimalPlaces: places, currencyPlaces: "setting" },
		percentageResult: { decimalPlaces: places },
	});
}

/**
 * The exact order of two sides, decided the way the comparison operators
 * decide it, or null for a pair of plain doubles.
 *
 * A whole number past 2^53, an exact decimal, a fraction and an amount of money
 * in one currency each carry their value exactly, and `==`, `<` and the rest
 * compare them on it: `2^53 + 1 == 2^53` and `1.0000000000001 == 1` are both
 * false. Read as doubles within {@link EQUAL_TOLERANCE} they were equal, so a
 * check passed the second and failed `check 2^53 + 1 > 2^53` (#581). Only a
 * pair with none of these reaches the tolerance, which is there for a unit
 * conversion's rounding.
 */
function exactOrder(left: Value, right: Value): -1 | 0 | 1 | null {
	if (left.type === ValueType.Uom && right.type === ValueType.Uom) {
		// Money of one currency: the exact sidecar is only ever on money.
		if (left.unit === right.unit && left.exact !== undefined && right.exact !== undefined) {
			return decimalCompare(left.exact, right.exact);
		}
		return null;
	}
	if (hasExactSide(left, right)) {
		const order = compareRationalOperands(left, right);
		if (order !== null) return order;
	}
	if (left.type === ValueType.BigInt || right.type === ValueType.BigInt) return compareBigIntOperands(left, right);
	return null;
}

/** Shown text with each number's trailing fractional zeros dropped, so `1.00` and `1` read as the one number they are. */
function bare(text: string): string {
	return text.replace(/\.(\d*?)0+(?!\d)/g, (_, kept: string) => (kept ? `.${kept}` : ""));
}

/**
 * Both sides of a failed comparison widened a decimal place at a time until
 * they read apart, or null when they already do.
 *
 * A failure means the two differ, yet `1.845` and `1.85` both read `1.85` at
 * two places, and "1.85 is not equal to 1.85" contradicts itself (#582). Sides
 * in one unit are apart when their numbers read differently, trailing zeros
 * aside. Sides in different units are told apart in the left side's unit
 * instead, since `1.00 km` and `1,000.00 m` read differently while meaning the
 * same thing.
 *
 * @param lv - The left side in the shared unit.
 * @param rv - The right side in the shared unit.
 * @param l - The left side as it would be shown.
 * @param r - The right side as it would be shown.
 */
function toldApart(left: Value, right: Value, lv: number, rv: number, l: string, r: string): [string, string] | null {
	const oneUnit = !(left.type === ValueType.Uom && right.type === ValueType.Uom && left.unit !== right.unit);
	const apart = (places: number, a: string, b: string): boolean =>
		oneUnit ? bare(a) !== bare(b) : lv.toFixed(places) !== rv.toFixed(places);
	if (apart(SHOWN_PLACES, l, r)) return null;
	for (let places = SHOWN_PLACES + 1; places <= MOST_PLACES; places++) {
		const a = shownTo(left, places);
		const b = shownTo(right, places);
		if (apart(places, a, b)) return [a, b];
	}
	return null;
}

/** A relative difference as a percentage, to two places. */
function percent(fraction: number): string {
	return `${fixedDecimalText(fraction * 100, 2).replace(/\.?0+$/, "")}%`;
}

/** The longest a piece of text is quoted at in a check's message. */
const MOST_QUOTED = 60;

/** A side's own magnitude, as written, or 0 when it is not finite. */
function finiteMagnitude(v: Value): number {
	const n = Math.abs(v.toNumber());
	return Number.isFinite(n) ? n : 0;
}

/** Whether a value has a number a check can compare: an `n` whole number and a number written in a base are, each compared on its digits by {@link exactOrder}. */
function numeric(v: Value): boolean {
	return v.type === ValueType.Number || v.type === ValueType.Uom || v.type === ValueType.Percentage || v.type === ValueType.Datetime || v.type === ValueType.BigInt || v.type === ValueType.Hex;
}

/**
 * The right side of a check in the left side's unit, when the two are rates (or
 * other compound units) that convert into each other; `null` otherwise.
 *
 * @param left - The left side of the check.
 * @param right - The right side.
 * @returns The right side's magnitude in the left's unit, or `null`.
 */
export function rateInLeftUnit(left: Value, right: Value): number | null {
	if (left.type !== ValueType.Uom || right.type !== ValueType.Uom || left.unit === undefined || right.unit === undefined) return null;
	return convertRate(right.toNumber(), right.unit, left.unit);
}

/**
 * How many decimal places a number is written with in its shortest form, the
 * form a reader types and the engine prints back: 2 for 96.56, 0 for 42, 7 for
 * 1e-7. Read from the double's own shortest decimal, so a figure the reader
 * typed as `96.56` counts two places however it was reached.
 *
 * @param n - Any number.
 * @returns The places after the point, 0 for a whole number or a value that is not finite.
 */
export function writtenDecimalPlaces(n: number): number {
	if (!Number.isFinite(n)) return 0;
	const match = /^-?\d+(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(n));
	if (match === null) return 0;
	const places = (match[1]?.length ?? 0) - Number(match[2] ?? 0);
	return Math.max(0, places);
}

/**
 * The margin `≈` allows when no `within` names one and the right side is
 * written to a number of decimal places: half a unit in its last place,
 * converted into the left side's unit. `check 60 mph ≈ 96.56 km/h` asks
 * whether 60 mph is 96.56 km/h to the two places written, which it is
 * (96.56064). A whole number on the right gives no margin here, so `check 5.4
 * ≈ 5` is not passed by rounding, and a right side worked out to every digit
 * (`pi`, `1/3`) gives a margin far below any real difference.
 *
 * @param right - The right side of the check, in its own unit.
 * @param rightInLeftUnit - The same side read in the left side's unit.
 * @returns The margin in the left side's unit, 0 when the right is a whole number.
 */
export function writtenPrecisionMargin(right: Value, rightInLeftUnit: number): number {
	if (right.type !== ValueType.Number && right.type !== ValueType.Uom) return 0;
	const written = right.toNumber();
	const places = writtenDecimalPlaces(written);
	if (places === 0 || written === 0) return 0;
	const half = 0.5 * 10 ** -places;
	return Math.abs(half * (rightInLeftUnit / written));
}

/** The ordering operators a check reads, numbered as the comparison opcodes number them. */
const CHECK_ORDERS: ReadonlyMap<string, Order> = new Map<string, Order>([["<", 0], ["<=", 1], [">", 2], [">=", 3]]);

/** A failed ordering check's reason, by operator, with the two sides filled in. */
function orderFailure(op: string, l: string, r: string): string {
	switch (op) {
		case "<": return `${l} is not less than ${r}`;
		case "<=": return `${l} is more than ${r}`;
		case ">": return `${l} is not more than ${r}`;
		default: return `${l} is less than ${r}`;
	}
}

/**
 * A check between two colours or two IP values, decided the way `==`, `!=`
 * and the ordering operators decide it, or null for any other pair.
 *
 * A colour or an address is not a number, so the numeric check refused both
 * with "cannot be compared" while `#ff0000 == rgb(255, 0, 0)` and
 * `192.168.1.0/24 != 192.168.1.0/25` answered. Equality is the operators' own
 * (see valuesEqual()): two colours on their channels, two IP values on family,
 * address, prefix and zone. Ordering is the operators' too (see
 * valuesOrdered()): an IPv4 address orders by its 32 bits and an IPv6 address
 * by its 128, and two addresses of different families, which the operators
 * refuse, are refused here by name. A colour has no order, and a tolerance or
 * `≈` has no meaning between two values that are either the same or not, so
 * each is refused.
 *
 * @param left - The left side of the check.
 * @param right - The right side.
 * @param op - The comparison, as the check parselet passes it.
 * @param tolerance - The `within` clause, when one was written.
 * @returns A tick, a CHECK_FAILED naming both sides, a CHECK_INCOMPARABLE, or null.
 */
export function identityCheck(left: Value, right: Value, op: string, tolerance?: Value): Value | null {
	const colours = left.type === ValueType.Colour && right.type === ValueType.Colour;
	const addresses = left.type === ValueType.IpCidr && right.type === ValueType.IpCidr;
	if (!colours && !addresses) return null;
	const kind = colours ? "two colours" : "two IP addresses";
	if (op === "≈" || tolerance !== undefined) {
		const asked = tolerance !== undefined ? "a tolerance" : op;
		return errorValue("CHECK_INCOMPARABLE", `check: ${kind} are either the same or not, with no margin between them, so they are compared with == or !=, not with ${asked}`);
	}
	if (op === "==" || op === "!=") {
		const same = valuesEqual(left, right, false).value === true;
		if (same === (op === "==")) return stringValue("✓");
		return errorValue("CHECK_FAILED", `check failed: ${shown(left)} is ${same ? "equal" : "not equal"} to ${shown(right)}`);
	}
	const order = CHECK_ORDERS.get(op);
	if (order === undefined) return errorValue("CHECK_EXPECTED_COMPARISON", `check: unknown comparison ${op}`);
	if (colours) {
		return errorValue("CHECK_INCOMPARABLE", `check: a colour has no order, so two colours can only be compared with == or !=, not ${op}`);
	}
	const holds = valuesOrdered(left, right, order);
	if (holds.type !== ValueType.Boolean) {
		return errorValue("CHECK_INCOMPARABLE", `check: an IPv4 and an IPv6 address have no order between them, so they can only be compared with == or !=, not ${op}`);
	}
	if (holds.value === true) return stringValue("✓");
	return errorValue("CHECK_FAILED", `check failed: ${orderFailure(op, shown(left), shown(right))}`);
}

/**
 * What kind of value a side of a check is, in the reader's words: "a number",
 * "text", "a true or false answer", "a colour".
 *
 * @param value - Either side of a check.
 * @returns A short noun phrase, never an internal type name.
 */
export function kindOfSide(value: Value): string {
	switch (value.type) {
		case ValueType.Boolean: return "a true or false answer";
		case ValueType.Colour: return "a colour";
		case ValueType.IpCidr: return "an IP address";
		default: return kindOfOperand(value);
	}
}

/**
 * A piece of text as a check's message quotes it, in double quotes, so a
 * trailing space or the text `0xFF` cannot read as the number or the shorter
 * text beside it. Cut short past {@link MOST_QUOTED} characters.
 *
 * @param text - The text itself.
 */
export function quotedText(text: string): string {
	const cut = [...text];
	return `"${cut.length > MOST_QUOTED ? `${cut.slice(0, MOST_QUOTED).join("")}...` : text}"`;
}

/**
 * Text that `as number` reads: decimal digits with an optional sign, thousands
 * commas, point and exponent, or a whole number after a base prefix
 * (`"0xFF"`, `"0b101"`, `"0o17"`). Text outside it is not offered the
 * conversion, so a check does not suggest one that would be refused.
 */
const NUMBER_AS_TEXT = /^\s*[-+]?(?:\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\s*$/i;

/**
 * A check with text on either side: equal or not between two pieces of text,
 * and refused by name between text and anything else.
 *
 * Text and a number that read alike are two kinds of thing, and the check used
 * to fail them as unequal with both sides shown alike: `check 255 == "255"`
 * said "255 is not equal to 255", and `check (255 in hex) == "0xFF"` "0xFF is
 * not equal to 0xFF". It now says which side is text, and how to read the text
 * as a number, the way a colour or an address beside a number is refused
 * rather than failed. Text is quoted in every message, so `check "a " == "a"`
 * no longer reads "a  is not equal to a".
 *
 * @param left - The left side.
 * @param right - The right side; one of the two is text.
 * @param op - The comparison.
 * @returns A tick, a CHECK_FAILED naming both texts, or a CHECK_INCOMPARABLE.
 */
export function textCheck(left: Value, right: Value, op: string): Value {
	if (left.type !== ValueType.String || right.type !== ValueType.String) {
		const [text, other] = left.type === ValueType.String ? [left, right] : [right, left];
		const textSide = left.type === ValueType.String ? "left" : "right";
		const written = String(text.value);
		const numeric = other.type === ValueType.Number || other.type === ValueType.Hex || other.type === ValueType.BigInt;
		const asNumber = numeric && NUMBER_AS_TEXT.test(written) ? `. To read the text as a number, write ${quotedText(written)} as number` : "";
		return errorValue(
			"CHECK_INCOMPARABLE",
			`check: ${quotedText(written)} on the ${textSide} is text and ${shown(other)} is ${kindOfSide(other)}, so they cannot be compared${asNumber}`,
		);
	}
	if (op !== "==" && op !== "!=") {
		return errorValue("CHECK_INCOMPARABLE", `check: text can only be compared with == or !=, not ${op}`);
	}
	const same = left.value === right.value;
	if (same === (op === "==")) return stringValue("✓");
	return errorValue("CHECK_FAILED", `check failed: ${quotedText(String(left.value))} is ${same ? "equal" : "not equal"} to ${quotedText(String(right.value))}`);
}

/**
 * `checkLink(left, right, op)`: one link of a chained check, `a < b` in `check
 * a < b < c`. Hands on its right side when the link holds, so the next link
 * compares it without working it out again, and its failure otherwise, which
 * carries itself through the rest of the chain as any failed value does.
 *
 * @param args - The two sides and the comparison, as {@link checkComparison} takes them.
 * @returns The right side, or the error the link answered.
 */
export function checkLink(args: Value[]): Value {
	const result = checkComparison(args.slice(0, 3));
	if (result.type === ValueType.Error) return result;
	return args[1] ?? errorValue("CHECK_EXPECTED_COMPARISON", "a check compares two things, as in \"check :spent <= :budget\"");
}

/** The note a passing approximate check carries, "differs by 0.04%", or undefined for a plain tick. */
function passNote(value: Value): string | undefined {
	return /^✓ \(differs by ([^)]*)\)$/.exec(String(value.value))?.[1];
}

/**
 * `checkBoth(first, second)`: two checks joined with `and`, one tick when both
 * pass. A failure on either side carries itself through the call, the first
 * one written winning, as any failed value does; each side that passed by a
 * margin keeps its note, `✓ (differs by 0.04% and by 0.01 m)`.
 *
 * @param args - The two answers, each a tick or what the check answered.
 * @returns A tick, or a CHECK_EXPECTED_COMPARISON for anything but two ticks.
 */
export function checkBoth(args: Value[]): Value {
	const [first, second] = args;
	const passed = (v: Value | undefined): v is Value => v !== undefined && v.type === ValueType.String && CHECK_PASS.test(String(v.value));
	if (!passed(first) || !passed(second)) {
		return errorValue("CHECK_EXPECTED_COMPARISON", "a check joins comparisons with \"and\", as in \"check :a > 0 and :b > 0\"");
	}
	const notes = [passNote(first), passNote(second)].filter((n): n is string => n !== undefined);
	if (notes.length === 0) return stringValue("✓");
	return stringValue(`✓ (differs by ${notes.join(" and by ")})`);
}

/**
 * `checkComparison(left, right, op, tolerance?)`: "✓" when the comparison
 * holds, a CHECK_FAILED error naming both sides when it does not.
 */
export function checkComparison(args: Value[]): Value {
	const [left, right, opValue, tolerance] = args;
	const op = String(opValue?.value ?? "==");
	if (left === undefined || right === undefined) {
		return errorValue("CHECK_EXPECTED_COMPARISON", `a check compares two things, as in "check :spent <= :budget"`);
	}

	if (left.type === ValueType.String || right.type === ValueType.String) return textCheck(left, right, op);
	// Two answers to a yes-or-no question compare as equal or not, as text
	// does: `check !(1 > 2) == true` said "true and true cannot be compared".
	// A boolean has no order, so only == and != mean anything between them.
	if (left.type === ValueType.Boolean && right.type === ValueType.Boolean) {
		if (op !== "==" && op !== "!=" && op !== "≈") {
			return errorValue("CHECK_INCOMPARABLE", `check: true and false can only be compared with == or !=, not ${op}`);
		}
		const same = left.value === right.value;
		if (same === (op !== "!=")) return stringValue("✓");
		return errorValue("CHECK_FAILED", `check failed: ${shown(left)} is ${same ? "equal" : "not equal"} to ${shown(right)}`);
	}
	// A list compared with a value answers once per cell (see
	// vm/ListComparison.ts), and a check gives one verdict, so a list is
	// refused with the form that does work rather than "cannot be compared".
	if (left.type === ValueType.Matrix || right.type === ValueType.Matrix) {
		const list = shown(left.type === ValueType.Matrix ? left : right);
		const quoted = list.length > MOST_QUOTED ? `${list.slice(0, MOST_QUOTED)}...` : list;
		return errorValue("CHECK_INCOMPARABLE", `check: ${quoted} is a list, and a check gives one verdict, so it compares one value at a time: check one cell, as in check v[0] ${op} 5`);
	}
	const identity = identityCheck(left, right, op, tolerance);
	if (identity !== null) return identity;
	if (!numeric(left) || !numeric(right)) {
		return errorValue("CHECK_INCOMPARABLE", `check: ${shown(left)} and ${shown(right)} cannot be compared`);
	}

	const unified = unifyUom(left, right);
	const { lv, sameMeasure } = unified;
	// Two rates, densities or accelerations have no single measure, but a check
	// compares them whenever one converts into the other (#834): `check 1 g/mL
	// == 1 g/cm^3` is the conversion `1 g/cm^3 in g/mL` asked as a question.
	const asRate = sameMeasure ? null : rateInLeftUnit(left, right);
	const rv = asRate ?? unified.rv;
	if (!sameMeasure && asRate === null) {
		const lUnit = left.type === ValueType.Uom ? left.unit : undefined;
		const rUnit = right.type === ValueType.Uom ? right.unit : undefined;
		return errorValue("CHECK_INCOMPARABLE", `check: ${describeMeasureMismatch(lUnit, rUnit, "compared") ?? `${lUnit} and ${rUnit} cannot be compared`}`);
	}

	const gap = Math.abs(lv - rv);
	// Scaled by the sides as written as well as converted, as compareUom scales
	// `==`: 32 F in Celsius is 5.7e-14 rather than 0, and a margin taken from the
	// two converted values alone, both near zero, failed `check 0 C == 32 F`
	// where `0 C == 32 F` is true (#595).
	const scale = Math.max(Math.abs(lv), Math.abs(rv), finiteMagnitude(left), finiteMagnitude(right));
	const approximate = op === "≈" || tolerance !== undefined;

	// The margin the two sides may differ by, and how to say it.
	let margin = EQUAL_TOLERANCE * scale;
	let marginText: string | undefined;
	if (tolerance !== undefined) {
		if (tolerance.type === ValueType.Percentage) {
			margin = Math.abs(tolerance.toNumber()) * Math.abs(rv);
			marginText = percent(Math.abs(tolerance.toNumber()));
		} else if (tolerance.type === ValueType.Uom || tolerance.type === ValueType.Number) {
			const inLeftUnit = unifyUom(left, tolerance);
			if (!inLeftUnit.sameMeasure) {
				return errorValue("CHECK_INCOMPARABLE", `check: a tolerance of ${shown(tolerance)} cannot be read against ${shown(left)}`);
			}
			margin = Math.abs(inLeftUnit.rv);
			marginText = shown(tolerance);
		} else {
			return errorValue("CHECK_INCOMPARABLE", `check: "within" needs a number, a quantity or a percentage, not ${shown(tolerance)}`);
		}
	} else if (op === "≈") {
		margin = Math.max(APPROX_TOLERANCE * scale, writtenPrecisionMargin(right, rv));
	}
	// An exact side is compared exactly, unless the check asked for a margin.
	const order = approximate ? null : exactOrder(left, right);
	// An infinity has no margin around it: scaled by it, the margin was itself
	// infinite and made every pair equal, so `check 0 < 1/0` failed with "0 is
	// not less than ∞" and `check 1/0 == 1/0` with "∞ is not equal to ∞". A side
	// with no finite value is ordered as the comparison operators order it. An
	// exact order comes first, since a whole number past 1.8e308 reads as an
	// infinity here while its digits still tell it from its neighbour.
	const unbounded = !Number.isFinite(lv) || !Number.isFinite(rv);
	const equal = order !== null ? order === 0 : unbounded ? lv === rv : gap <= margin;
	const less = order === null ? lv < rv : order < 0;
	const more = order === null ? lv > rv : order > 0;

	let holds: boolean;
	switch (op) {
		case "==":
		case "≈": holds = equal; break;
		case "!=": holds = !equal; break;
		case "<": holds = less && !equal; break;
		case "<=": holds = less || equal; break;
		case ">": holds = more && !equal; break;
		case ">=": holds = more || equal; break;
		default: return errorValue("CHECK_EXPECTED_COMPARISON", `check: unknown comparison ${op}`);
	}

	// How far apart the sides are, shown for an approximate check, in the left
	// side's unit when it has one.
	const unit = left.type === ValueType.Uom && left.unit !== undefined ? ` ${left.unit}` : "";
	const difference = tolerance?.type === ValueType.Percentage && rv !== 0
		? percent(gap / Math.abs(rv))
		: `${shortestText(Number(gap.toPrecision(3)))}${unit}`;
	if (holds) return stringValue(approximate && gap > 0 ? `✓ (differs by ${difference})` : "✓");

	// An approximate failure is a small difference by definition, which the
	// usual two decimal places would round away ("3.14 differs from 3.14"), so
	// its sides are shown to six significant figures.
	const precise = (v: Value, n: number): string =>
		approximate && v.type !== ValueType.Datetime ? `${shortestText(Number(n.toPrecision(6)))}${v.type === ValueType.Uom && v.unit !== undefined ? ` ${v.unit}` : ""}` : shown(v);
	let l = precise(left, left.toNumber());
	let r = precise(right, right.toNumber());
	// A side that is equal to the other already reads the same, as it should
	// ("1.85 is equal to 1.85"); every other failure has sides that differ.
	if (!equal && left.type !== ValueType.Datetime && right.type !== ValueType.Datetime) {
		const widened = toldApart(left, right, lv, rv, l, r);
		if (widened) [l, r] = widened;
	}
	let reason: string;
	switch (op) {
		case "==":
		case "≈":
			reason = approximate && marginText !== undefined
				? `${l} differs from ${r} by ${difference}, more than ${marginText}`
				: `${l} is not equal to ${r}`;
			break;
		case "!=": reason = `${l} is equal to ${r}`; break;
		case "<": reason = `${l} is not less than ${r}`; break;
		case "<=": reason = `${l} is more than ${r}`; break;
		case ">": reason = `${l} is not more than ${r}`; break;
		default: reason = `${l} is less than ${r}`; break;
	}
	return errorValue("CHECK_FAILED", `check failed: ${reason}`);
}

/** A check's pass, as {@link checkComparison} writes it: a tick, and for an approximate check how close it came. */
const CHECK_PASS = /^✓( \(differs by [^)]*\))?$/;

/**
 * A line written as a check: the `check` keyword opening it, after a label if
 * it has one, and not a variable of that name being assigned (`check = $80`).
 */
const CHECK_LINE = /^\s*(?:[^:"]*:\s*)?check\s+(?![-+*/]?=[^=])/i;

/** Whether a line's text is written as a check, whatever it answered; see {@link isCheckLine}. */
export function isWrittenAsCheck(text: string): boolean {
	return CHECK_LINE.test(text);
}

/**
 * Whether a line is a check: written with the `check` keyword, and answered
 * with a check's tick or its failure.
 *
 * Both halves are needed. The answer alone is not enough, since a piece of text
 * that happens to begin with a tick (`"✓ shipped"`) was counted as a passed
 * check (#594), and the text alone is not enough, since `check` is also an
 * ordinary name. A column total (`total above`) steps over a check line, so a
 * check written under a column of numbers does not break the total beneath it,
 * and the host's pass and fail count reads the same test.
 *
 * @param text - The line as written.
 * @param value - Its answer, or null when it has none.
 */
export function isCheckLine(text: string, value: Value | null | undefined): boolean {
	if (value == null || !isWrittenAsCheck(text)) return false;
	if (value.type === ValueType.String) return CHECK_PASS.test(String(value.value));
	return value.type === ValueType.Error && value.errorCode === "CHECK_FAILED";
}
