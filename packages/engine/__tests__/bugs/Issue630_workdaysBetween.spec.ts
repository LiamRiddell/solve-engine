import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #630: `workdays between` fell to the generic `<unit> between` and its
 * 7/5 rate shim, which knows no weekends: 21.43 workdays for January 2024,
 * where `working days between` counts 23. The unit's own spelling now counts
 * the calendar, and `workdays until` and `since`, whose only reading was the
 * same ratio, are refused with a pointer to the count.
 */

function show(line: string, holidays?: string[]): string {
	try {
		const engine = holidays ? newTrackedEngine({ config: { date: { holidays } } }) : newTrackedEngine();
		return formatValue(engine.evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

describe("every spelling of the count walks the calendar", () => {
	test.each([
		"workdays between 01/01/2024 and 31/01/2024",
		"working days between 01/01/2024 and 31/01/2024",
		"business days between 01/01/2024 and 31/01/2024",
		"how many workdays between 01/01/2024 and 31/01/2024",
		"how many working days between 01/01/2024 and 31/01/2024",
		"How Many Workdays Between 01/01/2024 and 31/01/2024",
		"Workdays between 01/01/2024 and 31/01/2024",
	])("%s", (line) => {
		expect(show(line)).toBe("= 23");
	});

	test("a host holiday calendar is honoured, as the ratio never could", () => {
		expect(show("workdays between 01/01/2024 and 31/01/2024", ["2024-01-01"])).toBe("= 22");
	});
});

describe("adversarial: the edges of a window", () => {
	test.each([
		["workday between 06/01/2024 and 07/01/2024", "= 0"], // a weekend
		["workdays between 31/01/2024 and 01/01/2024", "= 23"], // reversed
		["workdays between 29/02/2024 and 29/02/2024", "= 1"], // one leap day
		["workdays between 29/12/2023 and 02/01/2024", "= 3"], // across a year
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});

describe("until and since are refused, not answered with the ratio", () => {
	test.each(["workdays until 25 December 2026", "workdays since 1 January 2026"])("%s", (line) => {
		expect(show(line)).toMatch(/is not counted on the calendar\. Write "workdays between today and <date>"/);
	});

	test("the boundary: workdays in a span keeps its documented answer", () => {
		expect(show("workdays in 3 weeks")).toBe("= 15");
	});
});
