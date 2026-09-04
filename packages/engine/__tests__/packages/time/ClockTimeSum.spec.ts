/**
 * Adding clock times: the timesheet column.
 *
 * `8:15 + 7:45 + 8:30` used to be refused, and read strictly it deserved to
 * be: there is no such thing as half past eight plus quarter to eight. But a
 * timesheet writes each day as hours and minutes and adds the column up, and
 * the only reading that means anything is the one it intends, so a chain of
 * bare clock times joined by `+` is the duration it stands for.
 *
 * What is pinned here is as much what the rule does NOT claim as what it does:
 * a lone `8:15` is still a time of day, `8:15 + 30 minutes` is still quarter to
 * nine that morning, `9am + 5pm` is still refused because a time written with a
 * meridiem is a time of day and nothing else, and `-` between two clock times
 * is left alone because it is genuinely ambiguous.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a line, returning the display or the message a refusal carries. */
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

describe("a column of worked hours", () => {
	test("two days, and three", () => {
		// 495 + 465 minutes, then + 510.
		expect(answer("8:15 + 7:45")).toBe("960 minutes");
		expect(answer("8:15 + 7:45 + 8:30")).toBe("1,470 minutes");
	});

	test("the total is a duration, so it converts and it prices", () => {
		expect(answer("8:15 + 7:45 + 8:30 in hours")).toBe("24.50 hours");
		// 16 hours at £15.
		expect(answer("8:15 + 7:45 at £15/hour")).toBe("£240.00");
	});

	test("and it goes on adding ordinary durations", () => {
		expect(answer("8:15 + 7:45 + 30 minutes")).toBe("990 minutes");
	});
});

describe("what a clock time still means on its own", () => {
	test("a lone time is a time of day", () => {
		expect(answer("8:15")).toContain("8:15:00 AM");
	});

	test("and a time plus a duration is still a later time of day", () => {
		expect(answer("8:15 + 30 minutes")).toContain("8:45:00 AM");
	});
});

describe("what the rule deliberately refuses", () => {
	test("a time written with am or pm is a time of day, not a stretch", () => {
		expect(answer("9am + 5:30pm")).toContain("Cannot add two datetimes");
		expect(answer("8:15am + 7:45am")).toContain("Cannot add two datetimes");
	});

	test("`-` between two clock times is left as it was, being ambiguous", () => {
		// `5pm - 7pm` reads as a range and `5pm - 2pm` as a subtraction, so the
		// engine does not guess; the interval rule makes the same choice.
		expect(answer("5pm - 2pm")).toBe("3:00");
	});
});

describe("the spans and rates this sits beside, which are unchanged", () => {
	test("a span between two times", () => {
		expect(answer("9:00 to 17:30")).toBe("510 minutes");
		expect(answer("9am to 5:30pm")).toBe("510 minutes");
	});

	test("a span crossing midnight is the stretch, not a negative", () => {
		expect(answer("9pm to 5am")).toBe("480 minutes");
	});

	test("a span, and a duration, priced at an hourly rate", () => {
		expect(answer("9:00 to 17:30 at £15/hour")).toBe("£127.50");
		expect(answer("40 hours at £15/hour")).toBe("£600.00");
	});
});
