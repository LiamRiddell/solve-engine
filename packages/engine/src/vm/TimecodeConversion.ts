import { Value, ValueType, errorValue, isTimecodeUnit, timecodeFps, uomValue } from "@solve-js/vm/Value";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";

/**
 * A timecode converted with `in` or `to`: into frames, or into a unit of time.
 *
 * A timecode is held as its frame count under the unit `timecode@<fps>` (see
 * the timecode section of `vm/Value.ts`). That unit is in no measure table, so
 * the ordinary conversion found no measure for it and answered `Cannot convert
 * timecode@30 to seconds`, an internal name in front of the reader, for the
 * one conversion a timecode most obviously has (#759).
 *
 * - `in frames` is the count itself.
 * - A unit of time is the count over the rate in seconds, then converted:
 *   `00:00:01:15 at 30 fps in seconds` is 1.5 seconds. At a fractional rate
 *   (29.97 fps) that is the real time the frames take, which is what a length
 *   in seconds means.
 * - Anything else is refused by name: a timecode is a length of time, and a
 *   mass or a currency is not one.
 *
 * @param value - The timecode.
 * @param toUnit - The unit asked for, as written.
 * @returns The converted quantity, an `INCOMPATIBLE_UNITS` error Value, or
 * null when `value` is not a timecode (the caller's ordinary conversion runs).
 */
export function timecodeConverted(value: Value, toUnit: string): Value | null {
	if (value.type !== ValueType.Uom || !isTimecodeUnit(value.unit)) return null;
	const frames = value.toNumber();
	if (toUnit === "frames") return uomValue(frames, "frames");
	if (getMeasure(toUnit) === "time") {
		const seconds = frames / timecodeFps(value.unit);
		return uomValue(convertUnit(seconds, "s", toUnit), toUnit);
	}
	return errorValue(
		"INCOMPATIBLE_UNITS",
		`A timecode converts to frames or to a unit of time, such as seconds or minutes, and ${toUnit} is neither.`,
	);
}

/**
 * The refusal for a product or a quotient a timecode has no answer to, or null
 * when the pair is one it has.
 *
 * A timecode scales by a plain number (`* 2`, `/ 2`, a count of frames twice
 * or half as long), and two timecodes at one rate divide into the plain ratio
 * of their lengths. Everything else had no meaning and still produced a
 * value: `01:02:03:04 at 30 fps / 1 second` built the rate unit
 * `timecode@30/second` and answered as though it were the timecode itself,
 * and the refusals around it named the internal unit (#759).
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param op - Which of the two it is.
 */
export function timecodeOperandRefused(l: Value, r: Value, op: "mul" | "div"): Value | null {
	const lTimecode = l.type === ValueType.Uom && isTimecodeUnit(l.unit);
	const rTimecode = r.type === ValueType.Uom && isTimecodeUnit(r.unit);
	if (!lTimecode && !rTimecode) return null;
	const scale = (v: Value): boolean => v.type === ValueType.Number;
	if (op === "mul" && (scale(l) || scale(r))) return null;
	if (op === "div" && lTimecode && scale(r)) return null;
	if (op === "div" && lTimecode && rTimecode && l.unit === r.unit) return null;
	const named = (v: Value): string => timecodeUnitPhrase(v.unit) ?? (v.type === ValueType.Uom && v.unit !== undefined ? `a quantity in ${v.unit}` : "a value");
	const sentence = op === "mul"
		? `${named(l)} times ${named(r)} has no meaning`
		: `${named(l)} divided by ${named(r)} has no meaning`;
	return errorValue(
		"INCOMPATIBLE_UNITS",
		`${sentence[0].toUpperCase()}${sentence.slice(1)}: a timecode is multiplied or divided by a plain number, as in "* 2", and one timecode divides by another at the same rate.`,
	);
}

/**
 * How a timecode unit reads in a sentence, `a timecode at 30 fps`, or null
 * for any other unit. For the messages that would otherwise print the internal
 * `timecode@30` (#759).
 *
 * @param unit - Any unit string.
 */
export function timecodeUnitPhrase(unit: string | undefined): string | null {
	return isTimecodeUnit(unit) ? `a timecode at ${String(timecodeFps(unit))} fps` : null;
}
