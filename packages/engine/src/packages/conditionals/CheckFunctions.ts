/**
 * The work behind a `check` line (#506): compare two values, pass quietly with
 * a tick, or fail with an error that names both sides.
 *
 * Numbers and quantities are compared in a shared unit, reconciled the way the
 * engine's own comparisons reconcile them, so `check 1 km == 1000 m` passes.
 * Equality allows the conversion's own rounding (a millionth of a millionth,
 * relatively), and `≈` or a `within` clause widens that to a tolerance: a
 * percentage is relative to the right-hand side, a number or a quantity is an
 * absolute margin. Text compares with `==` and `!=` only.
 */

import { Value, ValueType, stringValue, errorValue } from "@solve-js/vm/Value";
import { unifyUom, describeMeasureMismatch } from "@solve-js/vm/VMConversion";
import { formatValue } from "@solve-js/format/FormatEngine";

/** The relative gap two values may differ by and still be equal: a conversion's rounding. */
const EQUAL_TOLERANCE = 1e-12;

/** The relative gap `≈` allows when no `within` names one: rounding noise, not a real difference. */
const APPROX_TOLERANCE = 1e-9;

/** A value as the reader sees it, without the result marker. */
function shown(value: Value): string {
	return formatValue(value).replace(/^=\s*/, "");
}

/** A relative difference as a percentage, to two places. */
function percent(fraction: number): string {
	return `${(fraction * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** Whether a value has a number a check can compare. */
function numeric(v: Value): boolean {
	return v.type === ValueType.Number || v.type === ValueType.Uom || v.type === ValueType.Percentage || v.type === ValueType.Datetime;
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
	const scale = Math.max(Math.abs(lv), Math.abs(rv));
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
	const equal = gap <= margin;

	let holds: boolean;
	switch (op) {
		case "==":
		case "≈": holds = equal; break;
		case "!=": holds = !equal; break;
		case "<": holds = lv < rv && !equal; break;
		case "<=": holds = lv <= rv || equal; break;
		case ">": holds = lv > rv && !equal; break;
		case ">=": holds = lv >= rv || equal; break;
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
	const l = precise(left, left.toNumber());
	const r = precise(right, right.toNumber());
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

/**
 * Whether a line's result is a check's: its tick, or its failure. A column
 * total (`total above`) steps over these, so a check written under a column of
 * numbers does not break the total beneath it.
 */
export function isCheckResult(value: Value | undefined): boolean {
	if (value === undefined) return false;
	if (value.type === ValueType.String) return String(value.value).startsWith("✓");
	return value.type === ValueType.Error && value.errorCode === "CHECK_FAILED";
}
