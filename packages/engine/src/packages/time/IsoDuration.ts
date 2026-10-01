/**
 * ISO 8601 durations: `PT1H30M` is an hour and a half, `P1D` a day,
 * `P1Y2M10DT2H30M` a year, two months, ten days, two hours and thirty minutes.
 *
 * APIs, logs and calendar files write a length of time this way. The grammar is
 * `P[n]Y[n]M[n]W[n]DT[n]H[n]M[n]S`: a `P` (period), then the date parts, then a
 * `T` (time) and the time parts, each a number and a letter, largest first and
 * each at most once. `M` is months before the `T` and minutes after it, which
 * is why the `T` is there. Only the last part written may carry a decimal
 * fraction, with a point or a comma (`PT0.5S`, `PT0,5S`).
 *
 * This module is the two pure halves the engine uses (#760): reading the text
 * into its parts ({@link readIsoDuration}, for the normaliser rule that makes
 * `PT1H30M` a duration) and writing a duration back ({@link writeIsoDuration},
 * for `90 minutes as iso8601`). Neither knows about tokens or values.
 *
 * The boundary, deliberately narrow: upper-case designators only, as the
 * standard writes them, and the whole identifier must match. `pt1h30m` is left
 * a name, and so are `P`, `PT` and `P1`, which spell no part at all. A spelling
 * that is shaped like a duration (a `P`, then digits and designator letters
 * only) but breaks the grammar is refused by name rather than read as a name
 * nobody defined: `P1H` puts a time part before the `T`.
 */

import { CALENDAR_MONTHS_PER_UNIT } from "@solve-js/vm/CalendarShift";
import { convertUnit, getMeasure, isWorkdayUnit } from "@solve-js/uom/UomConverter";

/** A unit a duration part is read in: the engine's own spelling of it. */
export type IsoDurationUnit = "year" | "month" | "week" | "day" | "hour" | "minute" | "second";

/** One part of a duration, as written: `30` and `minute` for the `30M` of `PT1H30M`. */
export interface IsoDurationPart {
	/** The amount as a plain decimal with a point, never a comma: `"0.5"`, `"30"`. */
	readonly amount: string;
	/** The unit it counts. */
	readonly unit: IsoDurationUnit;
}

/** What a piece of text is, read as an ISO 8601 duration. */
export type IsoDurationReading =
	| { readonly kind: "duration"; readonly parts: readonly IsoDurationPart[] }
	| { readonly kind: "malformed"; readonly reason: string };

/** The date designators, in the order they must appear, and what each counts. */
const DATE_PARTS: Readonly<Record<string, readonly [rank: number, unit: IsoDurationUnit]>> = {
	Y: [0, "year"],
	M: [1, "month"],
	W: [2, "week"],
	D: [3, "day"],
};

/** The time designators, after the `T`, in their order. */
const TIME_PARTS: Readonly<Record<string, readonly [rank: number, unit: IsoDurationUnit]>> = {
	H: [0, "hour"],
	M: [1, "minute"],
	S: [2, "second"],
};

/**
 * Text that is shaped like a duration: a `P`, then only ASCII digits, the
 * designator letters and decimal marks, with at least one digit followed by a
 * designator. `PT`, `P` and `P1` fail the last test, so they stay names.
 */
const DURATION_SHAPE = /^P[0-9YMWDTHS.,]*$/;
const SPELLS_A_PART = /[0-9][YMWDHS]/;

/** A part's number: digits, optionally a point or a comma and more digits. */
const AMOUNT = /^[0-9]+(?:[.,][0-9]+)?/;

/**
 * Whether `text` is shaped like an ISO 8601 duration at all, valid or not: the
 * test that decides between reading it (or refusing it by name) and leaving it
 * alone as a name.
 *
 * @param text - An identifier as the reader typed it.
 */
export function isIsoDurationShaped(text: string): boolean {
	return DURATION_SHAPE.test(text) && SPELLS_A_PART.test(text);
}

/**
 * Read `text` as an ISO 8601 duration.
 *
 * @param text - The whole identifier, as typed, such as `PT1H30M`.
 * @returns null when the text is not shaped like a duration (see
 * {@link isIsoDurationShaped}), so it stays a name; otherwise its parts, or the
 * reason it is malformed, in the reader's words.
 */
export function readIsoDuration(text: string): IsoDurationReading | null {
	if (!isIsoDurationShaped(text)) return null;
	const malformed = (reason: string): IsoDurationReading => ({ kind: "malformed", reason: `${text} is not an ISO 8601 duration: ${reason}` });

	const parts: IsoDurationPart[] = [];
	let inTime = false;
	let timeParts = 0;
	let lastRank = -1;
	let lastHadFraction = false;
	let i = 1;
	while (i < text.length) {
		if (text[i] === "T") {
			if (inTime) return malformed("it has a second T, and the T that starts the time parts comes once.");
			inTime = true;
			lastRank = -1;
			i++;
			continue;
		}
		const number = AMOUNT.exec(text.slice(i));
		if (number === null) {
			return malformed(`each part is a number and then a letter, and "${text[i]}" has no number before it.`);
		}
		i += number[0].length;
		const designator = text[i];
		if (designator === undefined) {
			return malformed(`it ends in ${number[0]} with no letter after it to say what the number counts.`);
		}
		const table = inTime ? TIME_PARTS : DATE_PARTS;
		const entry = Object.prototype.hasOwnProperty.call(table, designator) ? table[designator] : undefined;
		if (entry === undefined) {
			if (!inTime && (designator === "H" || designator === "S")) {
				return malformed(`${designator} is a time part, and time parts come after a T, as in PT${number[0]}${designator}.`);
			}
			if (inTime && (designator === "Y" || designator === "W" || designator === "D")) {
				return malformed(`${designator} is a date part, and date parts come before the T.`);
			}
			return malformed(`"${designator}" is not one of the letters a duration uses after a number.`);
		}
		if (lastHadFraction) {
			return malformed("only the last part can have a decimal fraction.");
		}
		if (entry[0] <= lastRank) {
			return malformed(`${number[0]}${designator} is out of place: the parts run from the largest to the smallest, each once.`);
		}
		const amount = number[0].replace(",", ".");
		if (!Number.isFinite(Number(amount))) {
			return malformed(`${number[0]}${designator} is too large to be a number.`);
		}
		parts.push({ amount, unit: entry[1] });
		lastRank = entry[0];
		lastHadFraction = amount.includes(".");
		if (inTime) timeParts++;
		i++;
	}
	if (inTime && timeParts === 0) return malformed("it has a T with no time part after it.");
	if (parts.length === 0) return malformed("it has no part.");
	return { kind: "duration", parts };
}

/** Seconds in each fixed-length part a duration is written back in, largest first. */
const WRITE_TIME_PARTS: readonly (readonly [letter: string, seconds: number])[] = [
	["H", 3600],
	["M", 60],
];

/** The number written for a part: plain digits, never an exponent, and at most nine decimal places. */
function amountText(n: number): string {
	const rounded = Math.round(n * 1e9) / 1e9;
	return String(rounded);
}

/**
 * Whether a number can be written as a part: finite and small enough that its
 * digits are exact, since `String(1e300)` is `1e+300`, which is not a number
 * the grammar allows.
 */
function writable(n: number): boolean {
	return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER;
}

/**
 * The time portion of a duration in seconds: `T1H30M`, or the empty string
 * when it is zero. The hours and minutes are whole, and any fraction is left
 * on the seconds, which is the last part and so the one allowed to carry it.
 */
function timeText(seconds: number): string {
	// Rounded to the nanosecond first, so `0.1 + 0.2` seconds is `0.3S` and a
	// count a hair under a minute does not come out as `59.999999999S`.
	let rest = Math.round(seconds * 1e9) / 1e9;
	let out = "";
	for (const [letter, size] of WRITE_TIME_PARTS) {
		const whole = Math.floor(rest / size + 1e-9);
		if (whole > 0) out += `${whole}${letter}`;
		rest -= whole * size;
	}
	const leftover = Math.round(rest * 1e9) / 1e9;
	if (leftover > 0) out += `${amountText(leftover)}S`;
	return out === "" ? "" : `T${out}`;
}

/**
 * A quantity written as an ISO 8601 duration, by the unit it is held in: the
 * entry point `as iso8601` uses for a length of time (#760).
 *
 * @param amount - How many of `unit`.
 * @param unit - The unit, as the value carries it.
 * @returns The text; null when a part is too large to write exactly; undefined
 * when `unit` is not a length of time at all, so the caller keeps its own
 * reading of the value.
 */
export function writeDurationInUnit(amount: number, unit: string): string | null | undefined {
	const monthsPerUnit = Object.prototype.hasOwnProperty.call(CALENDAR_MONTHS_PER_UNIT, unit) ? CALENDAR_MONTHS_PER_UNIT[unit] : undefined;
	// A year family stays in years and a month in months: the unit table makes a
	// year 365 days and a month 30, so twelve months is not a year to it, and
	// `P1Y2M` would read back five days longer than `14 months`.
	if (monthsPerUnit !== undefined) return monthsPerUnit === 1 ? writeIsoDuration(amount, "months") : writeIsoDuration(amount * (monthsPerUnit / 12), "years");
	// A workday is not a fixed length (it skips weekends), so it has no duration to write.
	if (getMeasure(unit) !== "time" || isWorkdayUnit(unit)) return undefined;
	let daysPerUnit = 0;
	try { daysPerUnit = convertUnit(1, unit, "day"); } catch { /* Not a day multiple. */ }
	if (Number.isInteger(daysPerUnit) && daysPerUnit >= 1) {
		return writeIsoDuration(amount * daysPerUnit, "days", daysPerUnit === 7);
	}
	return writeIsoDuration(convertUnit(amount, unit, "s"), "time");
}

/** What a duration to be written is measured in, which decides the parts it is written in. */
export type IsoDurationScale = "years" | "months" | "days" | "time";

/**
 * Write a length of time as an ISO 8601 duration.
 *
 * The parts follow what the value is held in, because that is what it means
 * and what reads back as the same value: a value in years is years (`2 decades`
 * is `P20Y`) and one in months is months (`14 months` is `P14M`), a value in
 * days or weeks is a count of days (`1.5 days` is `P1DT12H`, `2 weeks` is
 * `P2W`), and anything shorter is elapsed time in hours, minutes and seconds
 * (`90 minutes` is `PT1H30M`, `26 hours` is `PT26H`, not `P1DT2H`, since a
 * calendar day is not always 24 hours). A negative length is written with a
 * leading minus, `-PT1H`, the common extension the engine also reads.
 *
 * @param amount - The length, in `scale`'s unit: years, months, days or seconds.
 * @param scale - Which of the four it is held in.
 * @param weeks - For `days`, that the value was written in weeks, so a whole
 * number of them is written as `W`.
 * @returns The text, or null when a part would be too large to write exactly.
 */
export function writeIsoDuration(amount: number, scale: IsoDurationScale, weeks = false): string | null {
	if (!writable(amount)) return null;
	const sign = amount < 0 ? "-" : "";
	const size = Math.abs(amount);
	if (scale === "years") return `${sign}P${amountText(size)}Y`;
	if (scale === "months") return `${sign}P${amountText(size)}M`;
	if (scale === "days") {
		if (weeks && Number.isInteger(size / 7)) return `${sign}P${size / 7}W`;
		const days = Math.floor(size + 1e-9);
		const time = timeText((size - days) * 86400);
		if (days === 0 && time === "") return `${sign}P0D`;
		return `${sign}P${days > 0 ? `${days}D` : ""}${time}`;
	}
	const time = timeText(size);
	return `${sign}P${time === "" ? "T0S" : time}`;
}
