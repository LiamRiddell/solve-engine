/**
 * A duration written without spaces, the way a stopwatch prints one.
 *
 * `2h 30m` already read as 150 minutes. The same duration typed `2h30m` did
 * not, because the lexer leaves `h30m` as a single identifier and the line
 * became two hours times a variable nobody declared.
 *
 * The claim has to stay narrow, and that is most of what is pinned here. `m`
 * is metres on its own and minutes only inside a duration, so the rule reads it
 * as minutes only beside a larger time unit and writes the unit back out
 * unambiguously. Everything that is not a duration keeps meaning what it did.
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

describe("the compact spelling reads as the spaced one", () => {
	test("hours and minutes, either way round", () => {
		expect(answer("2h30m")).toBe("150 minutes");
		expect(answer("2h 30m")).toBe("150 minutes");
	});

	test("minutes and seconds, where `m` has to mean minutes", () => {
		// 45 minutes is 2,700 seconds, plus 30.
		expect(answer("45m30s")).toBe("2,730 seconds");
	});

	test("days and hours", () => {
		expect(answer("1d6h")).toBe("30 hours");
	});

	test("three parts", () => {
		// 1h30m15s is 5,415 seconds.
		expect(answer("1h30m15s")).toBe("5,415 seconds");
	});

	test("and it converts like any other duration", () => {
		expect(answer("1h30m in minutes")).toBe("90 minutes");
	});
});

describe("what it deliberately leaves alone", () => {
	test("`m` on its own is still metres", () => {
		// The boundary: `m` is metres in SI, and reads as minutes only beside a
		// larger time unit, which is the only place this rule looks at it.
		expect(answer("90m")).toBe("90.00 m");
		expect(answer("90m in hours")).toContain("cannot be converted");
	});

	test("a letter that is not a duration unit is still a variable", () => {
		expect(answer("2x3")).toContain("x3");
		expect(answer("100m50cm")).toContain("m50cm");
	});

	test("units that do not run from larger to smaller are not a duration", () => {
		// A compact duration always descends. These are not one, so they stay
		// whatever they were, which is an undefined variable.
		expect(answer("2m30h")).toContain("m30h");
		expect(answer("1m2m")).toContain("m2m");
	});

	test("a single unit is untouched", () => {
		expect(answer("3h")).toBe("3.00 h");
	});

	test("and the clock-time forms are unaffected", () => {
		expect(answer("8:15 + 7:45")).toBe("960 minutes");
		expect(answer("9:00 to 17:30")).toBe("510 minutes");
	});
});
