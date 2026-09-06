/**
 * `4:30/km`, the way a runner writes a pace.
 *
 * A two-part clock literal is a time of day everywhere else, and reading it as
 * one here produced the epoch: `4:30/km` answered `1,788,665,400,000.00 /km`
 * and `10 km at 4:30/km` answered seventeen trillion. The arithmetic was
 * already right in the other spelling, `4m30s/km`, so what was missing was the
 * reading and the display.
 *
 * What is pinned here is mostly the narrowness. The denominator is what claims
 * the shape, so a time over a distance is a pace and a time over anything else
 * is left exactly as it was, along with every clock time and every speed.
 */
import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a line and return its display without the result prefix. */
const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
};

describe("a pace reads as a pace", () => {
	test("with and without the space before the slash", () => {
		expect(answer("4:30/km")).toBe("4:30 /km");
		expect(answer("4:30 /km")).toBe("4:30 /km");
	});

	test("over any distance unit", () => {
		expect(answer("4:30/mile")).toBe("4:30 /mile");
		expect(answer("7:15/mi")).toBe("7:15 /mi");
	});

	test("and it is the same quantity the spelled-out form is", () => {
		expect(answer("4m30s/km")).toBe("4:30 /km");
	});
});

describe("what a pace is for", () => {
	test("a distance at a pace is a time", () => {
		expect(answer("10 km at 4:30/km as laptime")).toBe("00:45:00");
		expect(answer("5 km at 4:30/km as laptime")).toBe("00:22:30");
	});

	test("a marathon at four and a half minutes a kilometre", () => {
		expect(answer("42.2 km at 4:30/km as laptime")).toBe("03:09:54");
	});

	test("and converting it keeps it readable", () => {
		// `7.24 min/mi` is the same number in a spelling no runner uses.
		expect(answer("4:30/km in min/mi")).toBe("7:15 /mi");
	});
});

describe("the three-part literal keeps its meaning", () => {
	test("an hour and a half per kilometre", () => {
		// 5,400 seconds per kilometre, which it always was. The clock shows the
		// hours because there are hours to show.
		expect(answer("1:30:00/km")).toBe("1:30:00 /km");
	});
});

describe("what the shape deliberately does not claim", () => {
	test("a clock time on its own is still a time of day", () => {
		expect(answer("4:30")).toContain("4:30:00 AM");
		expect(answer("5:30pm")).toContain("5:30:00 PM");
	});

	test("clock-time arithmetic is untouched", () => {
		expect(answer("8:15 + 7:45")).toBe("960 minutes");
		expect(answer("9:00 to 17:30")).toBe("510 minutes");
	});

	test("a speed is a distance over a time, and reads as a number", () => {
		expect(answer("90 km/h")).toBe("90.00 km/h");
	});

	test("a time over a time is not a pace, so it is left as it was", () => {
		// `12:00/day` has no pace reading: hours per day is not a distance
		// covered. It keeps whatever it meant, which is not this rule's business.
		expect(answer("12:00/day")).not.toContain("/day 12:00");
	});

	test("a pace faster than a minute per unit keeps its digits", () => {
		// A clock shows whole seconds, and rounding `0.90 seconds/m` to `0:01 /m`
		// would be a different number. The swim spelling normalises its
		// denominator to one metre, which is why it lands here.
		expect(answer("1:30/100m")).toBe("0.90 seconds/m");
	});
});
