/**
 * A fixed offset from UTC as a reader writes one, `UTC-5`, `GMT+9`,
 * `UTC+5:45`: read from the tokens after `UTC` or `GMT`, checked against the
 * offsets clocks are actually kept at, and resolved to a zone reference.
 *
 * One reader for every form that takes an offset, so `<date> in UTC-5` and the
 * time package's `3pm London in UTC-5` accept the same spellings and refuse
 * the same impossible ones. It lives in `calendar/` because the first of those
 * is answered in the VM and parsed by the currency package's `in` parselet,
 * and neither may reach into the time package for it.
 *
 * @module UtcOffset
 */

import type { Token } from "@solve-js/lexer/Token";
import { encodeNamedOffset } from "./IntlZone";

/**
 * The furthest behind UTC any clock is kept, in minutes: UTC-12, the
 * uninhabited Baker and Howland islands.
 */
export const MIN_UTC_OFFSET_MINUTES = -12 * 60;

/** The furthest ahead of UTC any clock is kept, in minutes: UTC+14, Kiribati's Line Islands. */
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;

/**
 * The minutes a signed UTC offset names, or `null` when no clock keeps it.
 *
 * An offset is a sign, whole hours and optional minutes, `-5` or `+5:45`. The
 * minutes part is below sixty, as on a clock, and the whole lies between
 * UTC-12 and UTC+14, the offsets clocks are actually kept at. `UTC+25` is not
 * an offset but a mistake, and reading it as one would answer a question with
 * a clock that exists nowhere.
 *
 * @param negative - True for a minus sign.
 * @param hours - The whole hours, a non-negative integer.
 * @param minutes - The minutes past the hour, a non-negative integer.
 * @returns Minutes ahead of UTC (negative behind it), or null.
 */
export function utcOffsetMinutes(negative: boolean, hours: number, minutes: number): number | null {
	if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes >= 60) return null;
	const total = (negative ? -1 : 1) * (hours * 60 + minutes);
	if (total < MIN_UTC_OFFSET_MINUTES || total > MAX_UTC_OFFSET_MINUTES) return null;
	// `UTC-0` is UTC, and a negative zero would only print as `UTC+0` anyway.
	return total === 0 ? 0 : total;
}

/**
 * A signed offset written the way the engine labels one: `UTC-5`, `UTC+5:45`,
 * `UTC+0`. The one spelling the `in` target hands the VM for every way a
 * reader types the same offset (`utc-05:00`, `GMT -5`).
 *
 * @param offsetMinutes - Minutes ahead of UTC, negative behind it.
 * @returns The label.
 */
export function utcOffsetName(offsetMinutes: number): string {
	const sign = offsetMinutes < 0 ? "-" : "+";
	const abs = Math.abs(offsetMinutes);
	const hours = Math.floor(abs / 60);
	const minutes = abs % 60;
	return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

/** `utc-5`, `gmt+05:30`, `UTC - 5`: a base name, a sign, and hours with optional minutes. */
const SIGNED_OFFSET_TEXT = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/i;

/**
 * Resolve a signed offset's name, as {@link utcOffsetName} writes it, to a
 * named-offset zone reference (see `encodeNamedOffset`), or `null` when the
 * name is not an offset or names one no clock keeps.
 *
 * The companion to `resolveZoneName` in `ZoneNames.ts`, which resolves every
 * other name a zone is called by. A named offset is shown in, as a named zone
 * is, which is what makes `2026-04-03T15:00 in UTC-5` three in the afternoon
 * on that clock.
 *
 * @param name - The name as handed over.
 * @returns A `"UTCNAMED:<minutes>"` reference, or null.
 */
export function resolveUtcOffsetName(name: string): string | null {
	const signed = SIGNED_OFFSET_TEXT.exec(name.trim());
	if (signed === null) return null;
	const offset = utcOffsetMinutes(signed[1] === "-", parseInt(signed[2], 10), signed[3] === undefined ? 0 : parseInt(signed[3], 10));
	return offset === null ? null : encodeNamedOffset(offset);
}

/**
 * The minimal cursor {@link tryReadUtcOffset} reads tokens through, which the
 * parser satisfies. Named here so this module does not depend on the parser.
 */
export interface OffsetTokenCursor {
	/** The next token, without consuming it. */
	peek(): Token | undefined;
	/** The token `offset` places ahead, without consuming anything. */
	peekAt(offset: number): Token | undefined;
	/** Consume and return the next token. */
	consume(): Token;
}

/** An offset read from the tokens after `UTC` or `GMT`. */
export interface UtcOffsetReading {
	/**
	 * Minutes ahead of UTC, negative behind it, or `null` when the offset is one
	 * no clock keeps (`UTC+25`, `UTC-5:60`, `UTC+5.5`).
	 */
	minutes: number | null;
	/**
	 * The offset as the engine labels it, `UTC-5` (see {@link utcOffsetName}),
	 * or, for one no clock keeps, as it was written, for the refusal to quote.
	 */
	name: string;
}

/**
 * Whether a fused clock-time token was written as hours and minutes, `5:30`
 * or `05:00`, rather than as a time of day such as `11am`.
 *
 * The normaliser fuses both into one token carrying minutes past midnight, so
 * the spelling is recovered from how much source text the token covers: `H:MM`
 * is the digits of the hour and three more characters, `HH:MM` five. Without
 * this `UTC+11am` would read as the offset `+11:00`.
 *
 * @param token - A `CLOCK_TIME` token.
 * @returns True when the token was written `H:MM` or `HH:MM`.
 */
export function clockTokenIsHoursMinutes(token: Token): boolean {
	const totalMinutes = parseInt(token.value, 10);
	if (token.sourceEnd === undefined || !Number.isFinite(totalMinutes)) return false;
	const length = token.sourceEnd - token.offset;
	const hourDigits = String(Math.floor(totalMinutes / 60)).length;
	return length === hourDigits + 3 || length === 5;
}

/**
 * Read a signed offset after a `UTC` or `GMT` token, `UTC-5`, `GMT+9`,
 * `UTC+5:45`, `UTC-05:00`, consuming the base name and the offset.
 *
 * The cursor must be AT the `UTC`/`GMT` token; the caller has checked it is
 * one. Returns `null`, having consumed nothing, when no sign and number or
 * clock time follow, and when the number is followed by a unit: `UTC - 5
 * hours` is the time in UTC less five hours, arithmetic the reader wrote.
 *
 * An offset in the offset's shape that no clock keeps (`UTC+25`, `UTC-5:60`,
 * a time of day such as `UTC+11am`) is consumed and returned with
 * `minutes: null`, so each caller refuses it in its own way (see
 * {@link offsetRefusal}) rather than leaving the pieces to be read as
 * something else.
 *
 * @param cursor - The parser, positioned at the base name.
 * @returns The offset read, or null.
 */
export function tryReadUtcOffset(cursor: OffsetTokenCursor): UtcOffsetReading | null {
	const base = cursor.peek();
	const sign = cursor.peekAt(1);
	if (base === undefined || (sign?.type !== "PLUS" && sign?.type !== "MINUS")) return null;
	const negative = sign.type === "MINUS";
	const amount = cursor.peekAt(2);
	const written = `${base.value.toUpperCase()}${sign.value}`;

	let hours: number;
	let minutes = 0;
	let tokens = 3;
	let shown: string;
	let wellFormed = true;
	if (amount?.type === "CLOCK_TIME") {
		// A time of day (`11am`) or a clock spelt short (`5:5`) is not an offset,
		// and its spelling is gone, so the refusal quotes the sign alone.
		if (!clockTokenIsHoursMinutes(amount)) {
			for (let i = 0; i < tokens; i++) cursor.consume();
			return { minutes: null, name: written };
		}
		const total = parseInt(amount.value, 10);
		hours = Math.floor(total / 60);
		minutes = total % 60;
		shown = `${written}${hours}:${String(minutes).padStart(2, "0")}`;
	} else if (amount?.type === "NUMBER") {
		if (cursor.peekAt(3)?.type === "UNIT") return null;
		shown = `${written}${amount.value}`;
		wellFormed = /^\d{1,2}$/.test(amount.value);
		hours = parseInt(amount.value, 10);
		const minuteToken = cursor.peekAt(3)?.type === "COLON" ? cursor.peekAt(4) : undefined;
		if (minuteToken?.type === "NUMBER") {
			shown = `${shown}:${minuteToken.value}`;
			wellFormed = wellFormed && /^\d{2}$/.test(minuteToken.value);
			minutes = parseInt(minuteToken.value, 10);
			tokens = 5;
		}
	} else {
		return null;
	}

	for (let i = 0; i < tokens; i++) cursor.consume();
	const offset = wellFormed ? utcOffsetMinutes(negative, hours, minutes) : null;
	return offset === null ? { minutes: null, name: shown } : { minutes: offset, name: utcOffsetName(offset) };
}

/** A written offset's shape, `UTC` or `GMT` then a sign. See {@link offsetRefusal}. */
const OFFSET_SHAPE = /^(?:utc|gmt)\s*[+-]/i;

/**
 * The refusal for a signed offset no clock keeps, `UTC+25`, or `null` when the
 * name is not in an offset's shape at all (and so is some other mistake).
 *
 * @param written - The offset as written, as {@link UtcOffsetReading.name} holds it.
 * @returns The message, naming what was written and the range clocks keep, or null.
 */
export function offsetRefusal(written: string): string | null {
	if (!OFFSET_SHAPE.test(written)) return null;
	if (/[+-]$/.test(written)) {
		return `"${written}" takes an offset in hours and minutes, as in "UTC-5" or "UTC+5:45", not a time of day`;
	}
	return `"${written}" is not an offset a clock keeps: write whole hours and minutes from UTC-12 to UTC+14, as in "UTC-5" or "UTC+5:45"`;
}
