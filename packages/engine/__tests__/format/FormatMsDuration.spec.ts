/**
 * A value in `ms` is shown as a clock only when it is the gap between two
 * datetimes.
 *
 * `ms` used to be un-typeable, so every `ms` value was a clock-time
 * subtraction and the formatter could render all of them as `H:MM`. It is
 * typeable now (`40ms`, `2 minutes in ms`), and a latency budget rendered as
 * `0:00` rather than 190 ms. So the gap between two datetimes is marked as one
 * on the value, and only a marked value gets the clock.
 *
 * The mark survives the arithmetic that keeps a span a span, which is what a
 * timesheet needs, and that is most of what is pinned here.
 */
import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { uomValue, Value } from "@solve-js/vm/Value";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { newTrackedEngine } from "@tools/trackedEngine";

/** A millisecond value marked the way the datetime subtraction marks one. */
const span = (ms: number): Value => {
	const value = uomValue(ms, "ms");
	value.datetimeSpan = true;
	return value;
};

/** Evaluate a single line and return its display. */
const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression));
	} finally {
		engine.clear();
	}
};

/** Evaluate a whole document and return the last line's display. */
const lastLine = (lines: string[]): string => {
	const engine = newTrackedEngine();
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: lines.length });
	try {
		return formatValue(doc.getLineAt(lines.length)!.result!);
	} finally {
		engine.clear();
	}
};

describe("FormatEngine — a marked span is shown as a clock", () => {
	test("whole hours format as H:MM", () => {
		expect(formatValue(span(3_600_000))).toBe("= 1:00");
	});

	test("hours + minutes format as H:MM", () => {
		expect(formatValue(span(25_500_000))).toBe("= 7:05");
	});

	test("a non-zero seconds component is shown as H:MM:SS", () => {
		expect(formatValue(span(3_665_000))).toBe("= 1:01:05");
	});

	test("negative durations keep the sign", () => {
		expect(formatValue(span(-3_600_000))).toBe("= -1:00");
	});

	test("zero is 0:00", () => {
		expect(formatValue(span(0))).toBe("= 0:00");
	});

	test("other time-span units (hours) are unaffected — still plain 'N unit'", () => {
		expect(formatValue(uomValue(2, "hours"))).toBe("= 2 hours");
	});
});

describe("FormatEngine — an unmarked millisecond value is a quantity", () => {
	test("the same number, written rather than measured between two times", () => {
		expect(formatValue(uomValue(3_600_000, "ms"))).toBe("= 3,600,000.00 ms");
	});

	test("zero is zero, not midnight", () => {
		expect(formatValue(uomValue(0, "ms"))).toBe("= 0.00 ms");
	});
});

describe("real engine — the gap between two times", () => {
	test("9:30 - 8:30 displays as '= 1:00'", () => {
		expect(answer("9:30 - 8:30")).toBe("= 1:00");
	});

	test("two datetimes subtract the same way", () => {
		expect(answer("2026-01-02T10:30 - 2026-01-02T08:00")).toBe("= 2:30");
	});

	test("a latency budget is a quantity of milliseconds", () => {
		// The defect this marking fixes: 190 ms used to display as 0:00.
		expect(answer("40ms + 120ms + 30ms")).toBe("= 190.00 ms");
	});

	test("a duration converted into milliseconds is a quantity too", () => {
		expect(answer("2 minutes in ms")).toBe("= 120,000.00 ms");
	});
});

describe("real engine — the mark survives the arithmetic that keeps a span a span", () => {
	test("two spans added are a span", () => {
		expect(answer("(9:30 - 8:30) + (12:00 - 11:00)")).toBe("= 2:00");
	});

	test("a span scaled by a plain number is a span", () => {
		expect(answer("(9:30 - 8:30) * 2")).toBe("= 2:00");
		expect(answer("(9:30 - 8:30) / 2")).toBe("= 0:30");
	});

	test("a timesheet: subtract each clock-in/out pair, then sum with 'total above'", () => {
		expect(lastLine(["9:30 - 8:30", "12:00 - 11:00", "18:00 - 12:55", "total above"])).toBe("= 7:05");
	});

	test("the same timesheet averaged is the average shift", () => {
		expect(lastLine(["9:30 - 8:30", "12:00 - 11:00", "18:00 - 12:55", "average above"])).toBe("= 2:21:40");
	});

	test("and gathered by a category tag rather than by position", () => {
		expect(
			lastLine(["9:30 - 8:30 #shift", "12:00 - 11:00 #shift", "a note", "total of #shift"]),
		).toBe("= 2:00");
	});
});

describe("what the mark deliberately does not survive", () => {
	test("a conversion, because the line asked for a unit", () => {
		expect(answer("(2026-01-02T10:30 - 2026-01-02T08:00) in minutes")).toBe("= 150 minutes");
		expect(answer("(2026-01-02T10:30 - 2026-01-02T08:00) in ms")).toBe("= 9,000,000.00 ms");
	});

	test("combining with a quantity somebody typed", () => {
		// A shift plus a latency budget is not a shift, and the honest answer
		// is the count rather than a clock that implies it is one.
		expect(answer("(9:30 - 8:30) + 40ms")).toBe("= 3,600,040.00 ms");
	});
});
