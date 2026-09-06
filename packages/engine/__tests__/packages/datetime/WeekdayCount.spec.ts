/**
 * `fridays between A and B`, counting a weekday across a range.
 *
 * Planning against a weekday is an ordinary thing to want and there was no form
 * for it. The nearest approximation, `weeks between`, ignores which weekday the
 * range starts and ends on, so it is wrong at both ends: the range below is 13
 * weeks and holds 13 Fridays but 14 Mondays, because it opens and closes on a
 * Monday.
 *
 * Both endpoints are included, which is what is pinned hardest here: a range
 * written to a Friday was written to include it, and the count is what tells
 * the two conventions apart.
 */
import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a line and return its display without the result prefix. */
const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} catch (error) {
		return (error as Error).message;
	} finally {
		engine.clear();
	}
};

describe("counting a weekday between two dates", () => {
	// 1 June 2026 and 31 August 2026 are both Mondays.
	test("the plural spelling somebody counting writes", () => {
		expect(answer("fridays between 01/06/2026 and 31/08/2026")).toBe("13");
	});

	test("with a leading how many", () => {
		expect(answer("how many fridays between 01/06/2026 and 31/08/2026")).toBe("13");
	});

	test("and the singular, which is the lexer's own keyword", () => {
		expect(answer("friday between 01/06/2026 and 31/08/2026")).toBe("13");
	});

	test("every weekday counts, and they differ", () => {
		// The range opens and closes on a Monday, so it holds one more of those
		// than of any other weekday. This is exactly what `weeks between` cannot
		// tell you: it answers 13 whichever weekday you meant.
		expect(answer("mondays between 01/06/2026 and 31/08/2026")).toBe("14");
		expect(answer("tuesdays between 01/06/2026 and 31/08/2026")).toBe("13");
		expect(answer("saturdays between 01/06/2026 and 31/08/2026")).toBe("13");
		expect(answer("sundays between 01/06/2026 and 31/08/2026")).toBe("13");
		expect(answer("weeks between 01/06/2026 and 31/08/2026")).toBe("13 weeks");
	});

	test("order does not matter, since a range has no direction", () => {
		expect(answer("mondays between 31/08/2026 and 01/06/2026")).toBe("14");
	});
});

describe("both endpoints are included", () => {
	test("a single day that is the weekday counts as one", () => {
		expect(answer("mondays between 01/06/2026 and 01/06/2026")).toBe("1");
	});

	test("and a single day that is not counts as none", () => {
		expect(answer("sundays between 01/06/2026 and 01/06/2026")).toBe("0");
	});
});

describe("the until and since spellings measure against now", () => {
	test("they answer a whole number of occurrences", () => {
		// Relative to today, so the count itself is not a fixed string: what is
		// pinned is that it is a count rather than the fractional span the unit
		// forms answer.
		expect(answer("mondays until 25/12/2026")).toMatch(/^\d+$/);
		expect(answer("how many mondays until 25/12/2026")).toMatch(/^\d+$/);
		expect(answer("sundays since 01/01/2026")).toMatch(/^\d+$/);
	});
});

describe("what this deliberately leaves alone", () => {
	test("the unit forms of the same connectors", () => {
		expect(answer("working days between 01/06/2026 and 31/08/2026")).toBe("66");
		expect(answer("days between 01/06/2026 and 31/08/2026")).toBe("91 days");
	});

	test("a weekday used as a date, which is what the keyword is for", () => {
		expect(answer("next friday")).toContain("Friday");
		expect(answer("last monday")).toContain("Monday");
	});

	test("and holidays, which are not this form's business", () => {
		// A Friday that is a public holiday is still a Friday. `working days
		// between` is the form that skips them, and it already exists.
		expect(answer("fridays between 01/12/2025 and 31/12/2025")).toBe("4");
	});
});
