import { Value, ValueType, stringValue } from "@solve-js/vm/Value";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/**
 * `as timespan` and `as laptime`, the two ways of writing a duration out.
 *
 *   5.5 minutes as timespan   5 min 30 s
 *   72 days as timespan       10 weeks 2 days
 *   5.5 minutes as laptime    00:05:30
 *   03:04:05 as timespan      3 hours 4 minutes 5 seconds
 *
 * The parity audit credited both of these to `packages/time`, where the only
 * occurrence of the word "timespan" was a doc comment. Nothing was registered
 * and both returned "Unknown converter".
 *
 * They are the inverse of a compound quantity: that rule collapses
 * `3 hours 5 minutes` into one number, and these expand one number back into
 * the parts a person would say.
 */

/** The time measure's kind in UNIT_TABLE. Its base unit is the second. */
const TIME_KIND = 14;

/** Descending units a timespan is broken into, with their length in seconds. */
const TIMESPAN_PARTS: readonly (readonly [singular: string, plural: string, seconds: number])[] = [
	["week", "weeks", 604800],
	["day", "days", 86400],
	["hour", "hours", 3600],
	["minute", "minutes", 60],
	["second", "seconds", 1],
];

/**
 * The value in seconds, or null when it is not a duration.
 *
 * A plain number is taken as seconds, which is what `5.5 as timespan` has to
 * mean if it means anything. A unit from another measure returns null so the
 * caller can report an honest error rather than inventing a duration.
 */
function durationSeconds(value: Value): number | null {
	if (value.type === ValueType.Number) return value.toNumber();
	if (value.type !== ValueType.Uom || value.unit === undefined) return null;
	const entry = UNIT_TABLE[value.unit.toLowerCase()] as readonly [number, number] | undefined;
	if (entry === undefined || entry[0] !== TIME_KIND) return null;
	return value.toNumber() * entry[1];
}

/**
 * `5 min 30 s`: the duration as the parts someone would say out loud.
 *
 * Parts that are zero are skipped, so an exact number of hours reads as
 * "2 hours" rather than "2 hours 0 minutes 0 seconds". Seconds keep a
 * fractional remainder rather than rounding it away, since dropping it would
 * make the conversion lossy in a way the caller cannot see.
 */
export function toTimespanString(value: Value): Value {
	const total = durationSeconds(value);
	if (total === null) {
		return stringValue(`"as timespan" needs a duration, got ${value.unit ?? "a non-duration"}`);
	}

	const negative = total < 0;
	let remaining = Math.abs(total);
	const parts: string[] = [];

	for (const [singular, plural, seconds] of TIMESPAN_PARTS) {
		if (seconds === 1) break;
		const count = Math.floor(remaining / seconds);
		if (count > 0) {
			parts.push(`${count} ${count === 1 ? singular : plural}`);
			remaining -= count * seconds;
		}
	}

	// Whatever is left is seconds, kept even when fractional. Rounded to
	// milliseconds so floating-point division does not print a tail of noise.
	const secondsLeft = Math.round(remaining * 1000) / 1000;
	if (secondsLeft > 0 || parts.length === 0) {
		parts.push(`${secondsLeft} ${secondsLeft === 1 ? "second" : "seconds"}`);
	}

	return stringValue((negative ? "-" : "") + parts.join(" "));
}

/**
 * `00:05:30`: the duration as a stopwatch reading.
 *
 * Always `HH:MM:SS`, with hours allowed to exceed 24 rather than wrapping,
 * because a lap time of twenty-six hours is a real thing to measure and
 * wrapping it to two would be silently wrong.
 */
export function toLaptimeString(value: Value): Value {
	const total = durationSeconds(value);
	if (total === null) {
		return stringValue(`"as laptime" needs a duration, got ${value.unit ?? "a non-duration"}`);
	}

	const negative = total < 0;
	const rounded = Math.round(Math.abs(total) * 1000) / 1000;
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const seconds = rounded % 60;

	const whole = Math.floor(seconds);
	const fraction = Math.round((seconds - whole) * 1000);
	const base = `${pad(hours)}:${pad(minutes)}:${pad(whole)}`;
	return stringValue((negative ? "-" : "") + (fraction > 0 ? `${base}.${String(fraction).padStart(3, "0")}` : base));
}

/** Two-digit zero padding. */
function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}
