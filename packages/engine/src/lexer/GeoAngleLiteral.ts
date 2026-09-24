/**
 * An angle written the way a map or a GPS writes one: in degrees, minutes and
 * seconds (`51°30'27"`), or in degrees with a compass letter (`51.5074°N`).
 *
 * The lexer could not read either. A `"` opened a string, so `51°30'27"` ran to
 * the end of the line and failed as an unterminated string literal, and a digit
 * or a letter after `°` joined it into an identifier, so `51.5074°N` was an
 * undefined variable named `°N`. The shape is recognised here as one literal,
 * after a number and only when a `°` follows it with no space, and handed to the
 * parser as a single `GEO_ANGLE` token. The geo package gives that token its
 * meaning; this module only finds where it starts and ends, and splits it into
 * the parts the package reads.
 *
 * What it takes, all optional past the degrees except that one of the minutes or
 * the compass letter must be there:
 *
 *     51°30'27"N      degrees, minutes, seconds, compass letter
 *     51° 30' 27" N   the same, spaced as people often type it
 *     51°30.45'N      degrees and decimal minutes, the usual GPS display
 *     51.5074°N       decimal degrees with a compass letter
 *
 * The minute mark may be `'`, `′` or a typographic `’`, and the second mark `"`,
 * `″`, a typographic `”`, or two apostrophes, because text pasted from a word
 * processor or a web page arrives with whichever of those it happened to use.
 *
 * The boundary: a bare `51°` is not claimed, so it stays fifty-one degrees of
 * arc through the units package exactly as before, and neither is `20°C`, whose
 * letter is not a compass point. A compass letter only counts when
 * nothing word-like follows it, so `°Nm` or `°N2` is left alone. A string
 * literal is never affected: the `"` is taken only as the second mark of a
 * digit run that already has a `°` and a minute mark before it.
 *
 * @module GeoAngleLiteral
 */

/** A compass letter: north and east are positive, south and west negative. */
export type Hemisphere = "N" | "S" | "E" | "W";

/** A degrees-minutes-seconds or compass-lettered angle, split into the parts as written. */
export interface GeoAngleLiteral {
	/** Offset just past the literal in the text it was read from. */
	readonly end: number;
	/** The degrees, as written (`51` or `51.5074`). */
	readonly degrees: string;
	/** The minutes of arc, as written, when there are any. */
	readonly minutes?: string;
	/** The seconds of arc, as written, when there are any. */
	readonly seconds?: string;
	/** The compass letter, upper-cased, when there is one. */
	readonly hemisphere?: Hemisphere;
}

/** The degree sign, U+00B0. */
export const DEGREE_SIGN = 0xb0;

/** Whether `code` is an ASCII digit. */
function isDigit(code: number): boolean {
	return code >= 48 && code <= 57;
}

/** Offset of the first character at or after `pos` that is not a space or a tab. */
function skipSpaces(text: string, pos: number, limit: number): number {
	while (pos < limit) {
		const code = text.charCodeAt(pos);
		if (code !== 32 && code !== 9) break;
		pos++;
	}
	return pos;
}

/** End of a `123` or `123.45` run starting at `pos`, or -1 when none starts there. */
function readDecimal(text: string, pos: number, limit: number): number {
	if (pos >= limit || !isDigit(text.charCodeAt(pos))) return -1;
	while (pos < limit && isDigit(text.charCodeAt(pos))) pos++;
	if (pos + 1 < limit && text.charCodeAt(pos) === 46 && isDigit(text.charCodeAt(pos + 1))) {
		pos++;
		while (pos < limit && isDigit(text.charCodeAt(pos))) pos++;
	}
	return pos;
}

/** Whether `code` is a mark that closes the minutes: `'`, `′` or `’`. */
function isMinuteMark(code: number): boolean {
	return code === 0x27 || code === 0x2032 || code === 0x2019;
}

/** Length of the mark that closes the seconds at `pos` (`"`, `″`, `”` or `''`), or 0 when there is none. */
function secondMarkLength(text: string, pos: number, limit: number): number {
	if (pos >= limit) return 0;
	const code = text.charCodeAt(pos);
	if (code === 0x22 || code === 0x2033 || code === 0x201d) return 1;
	if (isMinuteMark(code) && pos + 1 < limit && isMinuteMark(text.charCodeAt(pos + 1))) return 2;
	return 0;
}

/**
 * Whether the character at `pos` ends a compass letter: the end of the text,
 * whitespace, or punctuation that cannot continue a word (`,`, `)`, `]`, `}`,
 * `;`, a `//` comment, `#` for a trailing tag or comment). A single `/` does
 * not, so `5°W/m` is left to be whatever it was rather than read as west.
 */
function endsWord(text: string, pos: number, limit: number): boolean {
	if (pos >= limit) return true;
	const code = text.charCodeAt(pos);
	if (code === 47) return pos + 1 < limit && text.charCodeAt(pos + 1) === 47;
	return (
		code === 32 || code === 9 || code === 10 || code === 13 || code === 0xa0 ||
		code === 44 || code === 41 || code === 93 || code === 125 || code === 59 ||
		code === 35
	);
}

/** The compass letter at `pos`, when one stands there on its own. */
function readHemisphere(text: string, pos: number, limit: number): Hemisphere | undefined {
	if (pos >= limit) return undefined;
	const letter = text.charAt(pos).toUpperCase();
	if (letter !== "N" && letter !== "S" && letter !== "E" && letter !== "W") return undefined;
	return endsWord(text, pos + 1, limit) ? letter : undefined;
}

/** Whether `text[start, end)` is plain digits with at most one decimal point, `51` or `51.5074`. */
function isPlainDecimal(text: string, start: number, end: number): boolean {
	return start < end && readDecimal(text, start, end) === end;
}

/**
 * Read an angle literal whose degrees run from `start` to the `°` at
 * `degreeSign`.
 *
 * The lexer calls this when a number is followed directly by `°`, and the geo
 * package calls it again on the token's own text to take the parts, so the two
 * cannot disagree about what the literal says.
 *
 * @param text - The text to read.
 * @param start - Where the degrees begin.
 * @param degreeSign - Offset of the `°` that ends the degrees.
 * @param limit - Offset past which nothing is read.
 * @returns The literal's parts and end, or null when this is not one (a bare
 *   `51°`, a `20°C`, a number with a thousands separator or an exponent).
 */
export function scanGeoAngle(text: string, start: number, degreeSign: number, limit: number): GeoAngleLiteral | null {
	if (degreeSign >= limit || text.charCodeAt(degreeSign) !== DEGREE_SIGN) return null;
	if (!isPlainDecimal(text, start, degreeSign)) return null;

	let end = degreeSign + 1;
	let minutes: string | undefined;
	let seconds: string | undefined;

	const minutesStart = skipSpaces(text, end, limit);
	const minutesEnd = readDecimal(text, minutesStart, limit);
	if (minutesEnd !== -1) {
		const minuteMark = skipSpaces(text, minutesEnd, limit);
		if (minuteMark < limit && isMinuteMark(text.charCodeAt(minuteMark))) {
			minutes = text.slice(minutesStart, minutesEnd);
			end = minuteMark + 1;

			const secondsStart = skipSpaces(text, end, limit);
			const secondsEnd = readDecimal(text, secondsStart, limit);
			if (secondsEnd !== -1) {
				const secondMark = skipSpaces(text, secondsEnd, limit);
				const markLength = secondMarkLength(text, secondMark, limit);
				if (markLength > 0) {
					seconds = text.slice(secondsStart, secondsEnd);
					end = secondMark + markLength;
				}
			}
		}
	}

	const letterAt = skipSpaces(text, end, limit);
	const hemisphere = readHemisphere(text, letterAt, limit);
	if (hemisphere !== undefined) end = letterAt + 1;

	if (minutes === undefined && hemisphere === undefined) return null;
	return { end, degrees: text.slice(start, degreeSign), minutes, seconds, hemisphere };
}

/**
 * Split a `GEO_ANGLE` token's own text back into its parts.
 *
 * @param text - The token's text, as the lexer cut it.
 * @returns The parts, or null for text that is not a whole literal.
 */
export function readGeoAngle(text: string): GeoAngleLiteral | null {
	const degreeSign = text.indexOf("°");
	if (degreeSign <= 0) return null;
	const literal = scanGeoAngle(text, 0, degreeSign, text.length);
	return literal !== null && literal.end === text.length ? literal : null;
}
