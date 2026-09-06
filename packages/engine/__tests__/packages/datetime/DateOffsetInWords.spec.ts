/**
 * `30 days from 3 March 2026`, a date offset written the way a person says it.
 *
 * The harder, rarer sibling already shipped: `30 working days from 3 March 2026`
 * has always answered, because that is a fixed three-word phrase. The ordinary
 * one did not, which is an asymmetry anyone with a deadline, a renewal or an
 * invoice term meets in a week.
 *
 * The arithmetic was never the gap: `3 March 2026 + 30 days` has always been
 * right, month clamping included. So what is pinned here is that the new
 * spelling agrees with the old one exactly, and that the three connector words
 * are claimed only where a duration is in front of them.
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

describe("the three connectors read", () => {
	test("from and after count forward", () => {
		expect(answer("30 days from 3 March 2026")).toBe("Thursday, April 2, 2026");
		expect(answer("30 days after 3 March 2026")).toBe("Thursday, April 2, 2026");
	});

	test("before counts back", () => {
		expect(answer("30 days before 3 March 2026")).toBe("Sunday, February 1, 2026");
	});

	test("in whichever unit the reader wrote", () => {
		expect(answer("2 weeks after 3 March 2026")).toBe("Tuesday, March 17, 2026");
		expect(answer("3 months from 3 March 2026")).toBe("Wednesday, June 3, 2026");
		expect(answer("1 month before 3 March 2026")).toBe("Tuesday, February 3, 2026");
		expect(answer("1 year from 3 March 2026")).toBe("Wednesday, March 3, 2027");
	});
});

describe("it is the arithmetic the engine already had", () => {
	test("the new spelling and the operator agree, forwards", () => {
		expect(answer("30 days from 3 March 2026")).toBe(answer("3 March 2026 + 30 days"));
		expect(answer("3 months from 3 March 2026")).toBe(answer("3 March 2026 + 3 months"));
	});

	test("and backwards", () => {
		expect(answer("30 days before 3 March 2026")).toBe(answer("3 March 2026 - 30 days"));
	});

	test("including the month clamping", () => {
		// 31 January plus a month lands on the last day February has.
		expect(answer("1 month from 31 January 2026")).toBe(answer("31 January 2026 + 1 month"));
	});
});

describe("what the connectors still mean elsewhere", () => {
	test("after is still the finance package's own, where money is in front of it", () => {
		expect(answer("$1,000 after 3 years at 7%")).toContain("1,225.04");
		expect(answer("interest on $1,000 after 3 years at 7%")).toContain("225.04");
	});

	test("the working-day spelling is untouched, and differs", () => {
		// Thirty working days is a longer stretch of calendar than thirty days.
		expect(answer("30 working days from 3 March 2026")).toBe("Tuesday, April 14, 2026");
	});

	test("and `to` is not claimed", () => {
		// `2 April 2026 to 6 September 2026` already means something. Whatever it
		// means, quietly turning it into an offset would take that away.
		expect(answer("2 April 2026 to 6 September 2026")).not.toContain("September 6, 2026");
	});
});

describe("the anchor can be any date the engine reads", () => {
	test("a relative one", () => {
		expect(answer("3 days from today")).toContain(", 20");
	});
});
