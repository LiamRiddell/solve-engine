import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { buildDateToken, faultMatch, runText } from "./DateLiteralNormalizerRule";
import { lowerCased } from "@solve-js/normalizer/RuleIndex";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { DatetimeErrorCodes, describeUnrealDay } from "../DateReading";
import type { DateAmbiguity } from "@solve-js/constants/Configuration";

/** Month names and the common abbreviations, to their 1-based number. */
const MONTHS: Record<string, number> = {
	january: 1, jan: 1,
	february: 2, feb: 2,
	march: 3, mar: 3,
	april: 4, apr: 4,
	may: 5,
	june: 6, jun: 6,
	july: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	october: 10, oct: 10,
	november: 11, nov: 11,
	december: 12, dec: 12,
};

/**
 * The token types a month name can lex as. IDENT and UNIT: "may" and "march"
 * are ordinary words, but "sept" and friends can lex either way depending on
 * what else is registered. CONVERTER_NAME: "oct" and "dec" are also the names
 * of the octal and decimal conversions (`255 as dec`), so they lex as those,
 * and without this `1 Oct 2026` and `25 Dec` could never reach the month table.
 */
const MONTH_TOKEN_TYPES: ReadonlySet<string> = new Set(["IDENT", "UNIT", "CONVERTER_NAME"]);

/** The conversion keywords a converter name follows, where "dec" means decimal, not December. */
const CONVERSION_KEYWORDS: ReadonlySet<string> = new Set(["AS", "IN", "TO"]);

/**
 * The month number for a token, or 0 when it is not a month name.
 *
 * @param token - The token that may name a month.
 * @param before - The token before it, so a converter name after `as`, `in` or
 * `to` stays the conversion it names.
 */
export function monthOf(token: Token | undefined, before?: Token): number {
	if (token === undefined || !MONTH_TOKEN_TYPES.has(token.type)) return 0;
	if (token.type === "CONVERTER_NAME" && before !== undefined && CONVERSION_KEYWORDS.has(before.type)) return 0;
	// An own key only: a word that names an inherited property (`constructor`,
	// `__proto__`) is not a month, and read through the prototype it made
	// `5 constructor` "not a real date: undefined 2026 has NaN days".
	// Lowered only when it has a capital: a word in lower case is looked up as
	// it stands, rather than copied at every word of the line.
	const word = lowerCased(token.text ?? token.value ?? "");
	return MONTH_NUMBERS.get(word) ?? 0;
}

/**
 * {@link MONTHS} as a `Map`, built once, for {@link monthOf}.
 *
 * This rule has no leading shape, so it is tried at every token of every line,
 * prose included. A `Map` holds only its own keys, so `constructor` is not a
 * month, and a lookup reads no global: `Object.prototype.hasOwnProperty.call`
 * reads `Object` on each call, which inside a `vm` context (the Jest harness
 * the benchmarks run in) cost the normaliser suite a third of its speed.
 */
const MONTH_NUMBERS: ReadonlyMap<string, number> = new Map(Object.entries(MONTHS));

/** A pure digit string, so hex and scientific literals are never fused. */
const PLAIN_INTEGER = /^\d+$/;

/**
 * Whether a plain integer reads as a year rather than a day of the month.
 *
 * Four digits only. A two-digit year would need the same windowing the numeric
 * rule does, and `March 99` is not a real spelling of 1999 anyway; accepting it
 * would mean guessing where guessing is not warranted.
 */
function looksLikeYear(digits: string): boolean {
	return digits.length === 4;
}

/**
 * Builds the literal, or, where the month and day are in range but name a day
 * that month does not have, the refusal that says so.
 *
 * A spelled-out month is unmistakably a date attempt: `29 February 2026` has
 * no second reading and no order to try, so falling through was never
 * arithmetic anybody meant. It fell to implicit multiplication instead, and
 * the line answered 51,327,216,000,000, which is 29 times the epoch of 1
 * February 2026. `31 April 2026` answered 55,024,938,000,000 the same way.
 * Neither is a number a reader could have depended on.
 *
 * The refusal is scoped to a ROLLOVER, a real month with a day it does not
 * have. A group that is out of range for its role at all (`March 99`, where 99
 * is neither a year nor a day of any month) keeps today's behaviour and
 * declines, because that run is not clearly a date attempt: it may be an
 * ordinary product the reader wrote with a word the rule happens to know.
 *
 * @param day - Day of the month.
 * @param month - Month, from 1.
 * @param year - The full year.
 * @param sourceTokens - The run being replaced.
 * @param calendar - The backend the literal is built with.
 * @param onAmbiguous - The engine's refusal policy. `'arithmetic'` declines,
 * the same opt-out the numeric shapes have, and the run falls through to the
 * implicit multiplication it is spelled like. That multiplies a date, which is
 * refused by name, so the old 51,327,216,000,000 does not come back.
 * @returns The date match, the refusal, or null to leave the tokens alone.
 */
function dateOrFault(
	day: number,
	month: number,
	year: number,
	sourceTokens: Token[],
	calendar: CalendarBackend,
	onAmbiguous: DateAmbiguity,
): NormalizerMatch | null {
	const RULE = "datetime:month-name-date";
	const match = buildDateToken(day, month, year, sourceTokens, RULE, calendar);
	if (match !== null) return match;
	if (onAmbiguous === "arithmetic") return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return faultMatch(
		DatetimeErrorCodes.DATE_NOT_A_CALENDAR_DAY,
		`"${runText(sourceTokens)}" is not a real date: ${describeUnrealDay(day, month, year)}.`,
		sourceTokens,
		`${RULE}:unreadable`,
	);
}

/** The current calendar year in the backend's zone, for a date written without one. */
function currentYear(calendar: CalendarBackend): number {
	return calendar.fields(calendar.now()).year;
}

/**
 * Dates written with the month as a word: `March 9, 2024`, `3 March`,
 * `January 24, 1984`.
 *
 * `DateLiteralNormalizerRule` covers the all-numeric orderings and nothing
 * else, so every documented expression built on a spelled-out month failed,
 * and several failed in a way that looked unrelated to dates:
 *
 *   weekday on March 9, 2024        Unexpected token after expression: "9"
 *   days between 3 March and 30 May Expected AND_CONJ but got STAR
 *
 * The second is the interesting one. With no month-name rule, `3 March` fell
 * through to implicit multiplication, so the parser was genuinely looking at
 * `3 * March` and reporting exactly that. The parselets those expressions
 * needed were all present and working: `weekday on 2024-03-09` answered
 * Saturday the whole time. Only the literal was missing.
 *
 * A year of its own (`February 2020`) resolves to the first of that month, so
 * a caller asking about the month as a period has a date inside it to work
 * from. Ambiguity is resolved by width: a number after a month name is a year
 * when it has four digits, otherwise a day.
 *
 * ## A spelled month that names no real day
 * `29 February 2026` and `31 April 2026` used to fall through to implicit
 * multiplication and answer 51,327,216,000,000 and 55,024,938,000,000, which
 * are 29 and 31 times the epoch of the first of the month. A spelled-out month
 * is unmistakably a date attempt, with no second reading and no order to try,
 * so it now reports what is wrong instead. See {@link dateOrFault} for the
 * boundary: only a rollover refuses, never a group that is out of range for
 * its role at all.
 *
 * `getCalendar` supplies the calendar backend the literal is built with, read
 * per match so it follows the engine that registered the rule, exactly as the
 * numeric rule's does; the default is the built-in `Date` backend, for a rule
 * registered outside an engine. `getOnAmbiguous` supplies that engine's
 * refusal policy the same way.
 */
export function monthNameDateNormalizerRule(
	priority = 64,
	getCalendar: () => CalendarBackend = () => DATE_CALENDAR,
	getOnAmbiguous: () => DateAmbiguity = () => "refuse",
): NormalizerRule {
	return {
		name: "datetime:month-name-date",
		priority,
		// No second slot: five alternative orderings put a number, a month name
		// or a weekday first, so what follows the first token is a union wide
		// enough to filter nothing. The start types still narrow it.
		startTokenTypes: ["NUMBER", "IDENT", "UNIT", "CONVERTER_NAME"],
		match(tokens, pos): NormalizerMatch | null {
			const first = tokens[pos];
			const second = tokens[pos + 1];

			// Every ordering puts a number and a month name side by side, so the
			// token types settle most positions before a word is lower-cased or a
			// pattern runs: after a number, a month name is an identifier, a unit
			// or a converter name, and after a word, the day or year is a number.
			if (first?.type === "NUMBER") {
				if (second === undefined || !MONTH_TOKEN_TYPES.has(second.type)) return null;
				// A number that is not a plain integer is no day, and not a month.
				if (!PLAIN_INTEGER.test(first.text ?? "")) return null;

				// `9 March` and `9 March 2024`.
				const month = monthOf(second, first);
				if (month === 0) return null;
				const day = Number(first.text);
				if (day < 1 || day > 31) return null;
				// Read only once the line holds a date: the rule is tried at every
				// number and word, and nearly none of them is a month.
				const calendar = getCalendar();
				const onAmbiguous = getOnAmbiguous();

				const yearToken = tokens[pos + 2];
				if (
					yearToken?.type === "NUMBER" &&
					PLAIN_INTEGER.test(yearToken.text ?? "") &&
					looksLikeYear(yearToken.text ?? "")
				) {
					return dateOrFault(day, month, Number(yearToken.text), tokens.slice(pos, pos + 3), calendar, onAmbiguous);
				}
				// No year given: the current one, matching what the numeric rule
				// does for the same shape.
				return dateOrFault(day, month, currentYear(calendar), tokens.slice(pos, pos + 2), calendar, onAmbiguous);
			}

			if (second?.type !== "NUMBER") return null;
			const month = monthOf(first, tokens[pos - 1]);
			if (month === 0) return null;
			if (!PLAIN_INTEGER.test(second.text ?? "")) return null;
			const calendar = getCalendar();
			const onAmbiguous = getOnAmbiguous();

			// `February 2020`, a whole month rather than a day in one.
			if (looksLikeYear(second.text ?? "")) {
				return dateOrFault(1, month, Number(second.text), tokens.slice(pos, pos + 2), calendar, onAmbiguous);
			}

			const day = Number(second.text);

			// `March 9, 2024`. The comma is part of the literal, not a separator.
			const comma = tokens[pos + 2];
			const yearToken = tokens[pos + 3];
			if (
				comma?.type === "COMMA" &&
				yearToken?.type === "NUMBER" &&
				PLAIN_INTEGER.test(yearToken.text ?? "") &&
				looksLikeYear(yearToken.text ?? "")
			) {
				return dateOrFault(day, month, Number(yearToken.text), tokens.slice(pos, pos + 4), calendar, onAmbiguous);
			}

			// `March 9 2024`, the same without the comma.
			if (
				comma?.type === "NUMBER" &&
				PLAIN_INTEGER.test(comma.text ?? "") &&
				looksLikeYear(comma.text ?? "")
			) {
				return dateOrFault(day, month, Number(comma.text), tokens.slice(pos, pos + 3), calendar, onAmbiguous);
			}

			// `March 9`, no year.
			return dateOrFault(day, month, currentYear(calendar), tokens.slice(pos, pos + 2), calendar, onAmbiguous);
		},
	};
}
