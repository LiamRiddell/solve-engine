/**
 * Dates written with the month as a word.
 *
 * `DateLiteralNormalizerRule` covered the all-numeric orderings and nothing
 * else, so every documented expression built on a spelled-out month failed.
 * Several failed in a way that looked nothing like a date problem:
 * `days between 3 March and 30 May` reported "Expected AND_CONJ but got STAR",
 * because with no month-name rule `3 March` fell through to implicit
 * multiplication and the parser really was looking at `3 * March`.
 *
 * The parselets those expressions needed were present and correct the whole
 * time: `weekday on 2024-03-09` has always answered Saturday. Only the literal
 * was missing, which is why one rule closes three documented rows and gets two
 * more (`days in February 2020`, `week number on march 12, 2021`) as far as
 * their surrounding phrase, which is separate, still-open work.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const text = (source: string) => String(evaluate(source).value);
const num = (source: string) => evaluate(source).toNumber();

/** The date a literal resolves to, as a local Y-M-D triple. */
function ymd(source: string): [number, number, number] {
	const date = new Date(evaluate(source).toNumber());
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe("the orderings", () => {
	test("`March 9, 2024`", () => {
		expect(ymd("March 9, 2024")).toEqual([2024, 3, 9]);
	});

	test("`March 9 2024`, without the comma", () => {
		expect(ymd("March 9 2024")).toEqual([2024, 3, 9]);
	});

	test("`9 March 2024`, day first", () => {
		expect(ymd("9 March 2024")).toEqual([2024, 3, 9]);
	});

	test("`January 24, 1984`", () => {
		expect(ymd("January 24, 1984")).toEqual([1984, 1, 24]);
	});

	test("abbreviations", () => {
		expect(ymd("Mar 9, 2024")).toEqual([2024, 3, 9]);
		expect(ymd("Sept 1, 2024")).toEqual([2024, 9, 1]);
	});

	test("case does not matter", () => {
		expect(ymd("march 9, 2024")).toEqual([2024, 3, 9]);
		expect(ymd("MARCH 9, 2024")).toEqual([2024, 3, 9]);
	});

	test("a month with no year uses the current one", () => {
		const [year, month, day] = ymd("March 9");
		expect([month, day]).toEqual([3, 9]);
		expect(year).toBe(new Date().getFullYear());
	});

	test("`February 2020` is a month, resolving to its first day", () => {
		expect(ymd("February 2020")).toEqual([2020, 2, 1]);
	});
});

describe("day and year are told apart by width", () => {
	test("a four-digit number after a month is a year", () => {
		expect(ymd("March 2024")).toEqual([2024, 3, 1]);
	});

	test("a two-digit number is never a year", () => {
		// "March 99" is not a real spelling of March 1999, and windowing it
		// would be guessing. It is simply not a date.
		expect(() => evaluate("March 99")).toThrow();
	});

	test("a number that could be a day is a day", () => {
		const [, month, day] = ymd("March 9");
		expect([month, day]).toEqual([3, 9]);
	});
});

describe("the rows this unblocked", () => {
	test("`weekday on March 9, 2024` is Saturday", () => {
		expect(text("weekday on March 9, 2024")).toMatch(/saturday/i);
	});

	test("`day of the week on January 24, 1984` is Tuesday", () => {
		expect(text("day of the week on January 24, 1984")).toMatch(/tuesday/i);
	});

	test("`days between 3 March and 30 May` is 88 days", () => {
		// The one that reported a multiplication error.
		// Within an hour: the span crosses a daylight-saving boundary, which is
		// the existing between-unit behaviour rather than anything to do with
		// the literal.
		expect(num("days between 3 March and 30 May")).toBeCloseTo(88, 1);
	});

	test("the literal is available to grammars that do not exist yet", () => {
		// `days in February 2020` and `week number on march 12, 2021` still
		// fail, but no longer at the date: both now parse the literal and stop
		// at the surrounding phrase, which is separate, still-open work.
		expect(ymd("February 2020")).toEqual([2020, 2, 1]);
	});
});

describe("what must not be swallowed", () => {
	test("an invalid calendar date is not a date", () => {
		// February never has thirty days, so these tokens were never a literal
		// and must fall back rather than rolling over into March.
		expect(() => evaluate("February 30, 2020")).toThrow();
	});

	test("`may` as an ordinary word is untouched when no number follows", () => {
		const engine = newTrackedEngine("en");
		engine.evaluateExpression(":may = 5");
		expect(engine.evaluateExpression(":may + 1")[0].toNumber()).toBe(6);
	});

	test("all-numeric literals still belong to the numeric rule", () => {
		expect(ymd("2024-03-09")).toEqual([2024, 3, 9]);
	});

	test("date arithmetic works on a month-name literal", () => {
		expect(ymd("March 9, 2024 + 3 days")).toEqual([2024, 3, 12]);
	});

	test("the result is a datetime, not a number", () => {
		expect(evaluate("March 9, 2024").type).toBe(ValueType.Datetime);
	});
});
