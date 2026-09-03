import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
// The month lengths are zone-free Gregorian arithmetic; the current year and
// a fused literal's fields are read through the parser's calendar backend,
// the engine's own, so the literal reads back through the backend that built
// it.
import { daysInMonth } from "@solve-js/calendar/Gregorian";

/** VMBuiltins.ts index for labelling a count as days. */
const DAYS_COUNT_BUILTIN = 93;

/** Quarters, as their first and last zero-based month indices (January is 0). */
const QUARTERS: Record<string, readonly [number, number]> = {
	q1: [0, 2],
	q2: [3, 5],
	q3: [6, 8],
	q4: [9, 11],
};

/** Days in a whole year: 366 when February has its 29th. */
function daysInYear(year: number): number {
	return daysInMonth(year, 1) === 29 ? 366 : 365;
}

/** The current calendar year in the backend's zone, read when the line is parsed. */
function currentYear(calendar: CalendarBackend): number {
	return calendar.fields(calendar.now()).year;
}

/**
 * `days in <period>`: how long a named stretch of the calendar is.
 *
 *   days in February 2020   29 days
 *   days in Q3              92 days
 *   days in 2024            366 days
 *
 * Distinct from the unit conversion that looks identical. `days in 3 weeks`
 * converts a quantity and is handled by `ReversedConversionNormalizerRule`;
 * this asks how many days a real calendar period contains, which depends on
 * which period it is. February is 28 days or 29, and no conversion factor
 * expresses that.
 *
 * That is also why the reversed-conversion rule deliberately declines a date:
 * rewriting `days in February 2020` to `February 2020 in days` would answer a
 * different question with a plausible-looking number.
 *
 * The count is computed at parse time, because the period is written out
 * literally and there is nothing to defer.
 */
export class DaysInPeriodParselet implements PrefixParselet {
	readonly category = "Datetime";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		const total = this.readPeriodDays(parser);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(total);
		// Labelled, so the answer reads "92 days" rather than a bare 92 that
		// has lost what it was counting.
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(DAYS_COUNT_BUILTIN);
		builder.emitIndex(1);
	}

	/** The number of days in the period written after `days in`. */
	private readPeriodDays(parser: Parser): number {
		const calendar = parser.getCalendar();
		const next = parser.peek();
		const word = (next?.text ?? next?.value ?? "").toLowerCase();

		// `days in Q3`, optionally with a year: `days in Q3 2024`.
		const quarter = QUARTERS[word];
		if (quarter !== undefined) {
			parser.consume();
			const year = this.readOptionalYear(parser) ?? currentYear(calendar);
			let total = 0;
			for (let month = quarter[0]; month <= quarter[1]; month++) {
				total += daysInMonth(year, month);
			}
			return total;
		}

		// `days in February 2020`, which the month-name rule has already fused
		// into a date literal pointing at the first of that month.
		if (next?.type === "DATETIME_LITERAL") {
			parser.consume();
			const date = calendar.fields(Number(next.value));
			return daysInMonth(date.year, date.month0);
		}

		// `days in 2024`, a bare year.
		const year = this.readOptionalYear(parser);
		if (year !== null) return daysInYear(year);

		throw ErrorFactory.parsing(
			"DAYS_IN_EXPECTED_PERIOD",
			'Expected a month, quarter or year, as in "days in February 2020" or "days in Q3"',
		);
	}

    /** A four-digit year sitting at the cursor, consumed if present. */
	private readOptionalYear(parser: Parser): number | null {
		const token = parser.peek();
		if (token?.type !== "NUMBER") return null;
		const text = token.text ?? token.value ?? "";
		if (!/^\d{4}$/.test(text)) return null;
		parser.consume();
		return Number(text);
	}
}
