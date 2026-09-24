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
		unitOfMeasurementResult: { decimalPlaces: places },
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
	if (left.rational !== undefined || right.rational !== undefined || left.exact !== undefined || right.exact !== undefined) {
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
	return `${(fraction * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** A side's own magnitude, as written, or 0 when it is not finite. */
function finiteMagnitude(v: Value): number {
	const n = Math.abs(v.toNumber());
	return Number.isFinite(n) ? n : 0;
}

/** Whether a value has a number a check can compare: an `n` whole number is one, compared on its digits by {@link exactOrder}. */
function numeric(v: Value): boolean {
	return v.type === ValueType.Number || v.type === ValueType.Uom || v.type === ValueType.Percentage || v.type === ValueType.Datetime || v.type === ValueType.BigInt;
}

/**
 * `checkComparison(left, right, op, tolerance?)`: "✓" when the comparison
 * holds, a CHECK_FAILED error naming both sides when it does not.
 */
export function checkComparison(args: Value[]): Value {
	const [left, right, opValue, tolerance] = args;
	const op = String(opValue?.value ?? "==");

	if (left.type === ValueType.String || right.type === ValueType.String) {
		if (op !== "==" && op !== "!=") {
			return errorValue("CHECK_INCOMPARABLE", `check: text can only be compared with == or !=, not ${op}`);
		}
		const same = left.type === right.type && left.value === right.value;
		if (same === (op === "==")) return stringValue("✓");
		return errorValue("CHECK_FAILED", `check failed: ${shown(left)} is ${same ? "equal" : "not equal"} to ${shown(right)}`);
	}
	if (!numeric(left) || !numeric(right)) {
		return errorValue("CHECK_INCOMPARABLE", `check: ${shown(left)} and ${shown(right)} cannot be compared`);
	}

	const { lv, rv, sameMeasure } = unifyUom(left, right);
	if (!sameMeasure) {
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
		margin = APPROX_TOLERANCE * scale;
	}
	// An exact side is compared exactly, unless the check asked for a margin.
	const order = approximate ? null : exactOrder(left, right);
	const equal = order === null ? gap <= margin : order === 0;
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
		: `${Number(gap.toPrecision(3))}${unit}`;
	if (holds) return stringValue(approximate && gap > 0 ? `✓ (differs by ${difference})` : "✓");

	// An approximate failure is a small difference by definition, which the
	// usual two decimal places would round away ("3.14 differs from 3.14"), so
	// its sides are shown to six significant figures.
	const precise = (v: Value, n: number): string =>
		approximate && v.type !== ValueType.Datetime ? `${Number(n.toPrecision(6))}${v.type === ValueType.Uom && v.unit !== undefined ? ` ${v.unit}` : ""}` : shown(v);
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
