import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { buildDateToken } from "./DateLiteralNormalizerRule";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

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

/** The month number for a token, or 0 when it is not a month name. */
function monthOf(token: Token | undefined): number {
	if (token === undefined) return 0;
	// UNIT as well as IDENT: "may" and "march" are ordinary words, but "sept"
	// and friends can lex either way depending on what else is registered.
	if (token.type !== "IDENT" && token.type !== "UNIT") return 0;
	return MONTHS[(token.text ?? token.value ?? "").toLowerCase()] ?? 0;
}

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
 * `getCalendar` supplies the calendar backend the literal is built with, read
 * per match so it follows the engine that registered the rule, exactly as the
 * numeric rule's does; the default is the built-in `Date` backend, for a rule
 * registered outside an engine.
 */
export function monthNameDateNormalizerRule(
	priority = 64,
	getCalendar: () => CalendarBackend = () => DATE_CALENDAR,
): NormalizerRule {
	return {
		name: "datetime:month-name-date",
		priority,
		// No second slot: five alternative orderings put a number, a month name
		// or a weekday first, so what follows the first token is a union wide
		// enough to filter nothing. The start types still narrow it.
		startTokenTypes: ["NUMBER", "IDENT", "UNIT"],
		match(tokens, pos): NormalizerMatch | null {
			const RULE = "datetime:month-name-date";
			const calendar = getCalendar();
			const first = tokens[pos];

			// `9 March` and `9 March 2024`.
			if (first?.type === "NUMBER" && PLAIN_INTEGER.test(first.text ?? "")) {
				const month = monthOf(tokens[pos + 1]);
				if (month === 0) return null;
				const day = Number(first.text);
				if (day < 1 || day > 31) return null;

				const yearToken = tokens[pos + 2];
				if (
					yearToken?.type === "NUMBER" &&
					PLAIN_INTEGER.test(yearToken.text ?? "") &&
					looksLikeYear(yearToken.text ?? "")
				) {
					return buildDateToken(day, month, Number(yearToken.text), tokens.slice(pos, pos + 3), RULE, calendar);
				}
				// No year given: the current one, matching what the numeric rule
				// does for the same shape.
				return buildDateToken(day, month, currentYear(calendar), tokens.slice(pos, pos + 2), RULE, calendar);
			}

			const month = monthOf(first);
			if (month === 0) return null;

			const second = tokens[pos + 1];
			if (second?.type !== "NUMBER" || !PLAIN_INTEGER.test(second.text ?? "")) return null;

			// `February 2020`, a whole month rather than a day in one.
			if (looksLikeYear(second.text ?? "")) {
				return buildDateToken(1, month, Number(second.text), tokens.slice(pos, pos + 2), RULE, calendar);
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
				return buildDateToken(day, month, Number(yearToken.text), tokens.slice(pos, pos + 4), RULE, calendar);
			}

			// `March 9 2024`, the same without the comma.
			if (
				comma?.type === "NUMBER" &&
				PLAIN_INTEGER.test(comma.text ?? "") &&
				looksLikeYear(comma.text ?? "")
			) {
				return buildDateToken(day, month, Number(comma.text), tokens.slice(pos, pos + 3), RULE, calendar);
			}

			// `March 9`, no year.
			return buildDateToken(day, month, currentYear(calendar), tokens.slice(pos, pos + 2), RULE, calendar);
		},
	};
}
