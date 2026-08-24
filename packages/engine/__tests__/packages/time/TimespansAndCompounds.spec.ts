/**
 * Compound duration quantities, and writing a duration back out.
 *
 * Two halves of the same idea. `3 hours 5 minutes 10 seconds` is how a
 * duration is written and it did not parse: the parts sat next to each other
 * as separate quantities and the parser reported an unexpected number, which
 * is why the timespan, clock and several unit examples all failed at the same
 * place. `as timespan` and `as laptime` are the inverse, expanding one number
 * back into the parts a person would say, and the parity audit credited both
 * to this package where the only occurrence of "timespan" was a doc comment.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();
const text = (source: string) => String(evaluate(source).value);

describe("compound quantities", () => {
	test("`3 hours 5 minutes 10 seconds in seconds` is 11,110", () => {
		expect(num("3 hours 5 minutes 10 seconds in seconds")).toBeCloseTo(11110, 6);
	});

	test("the abbreviated spelling means the same", () => {
		expect(num("3h 5m 10s in seconds")).toBeCloseTo(11110, 6);
	});

	test("`5 hours 30 minutes to seconds` is 19,800", () => {
		expect(num("5 hours 30 minutes to seconds")).toBeCloseTo(19800, 6);
	});

	test("two parts", () => {
		expect(num("1 hour 30 minutes in minutes")).toBeCloseTo(90, 6);
	});

	test("it behaves as one quantity in arithmetic", () => {
		// Parenthesised because `in` binds to the term on its left, not the sum.
		expect(num("(1 hour 30 minutes + 30 minutes) in hours")).toBeCloseTo(2, 6);
	});

	test("a sequence ending on the ambiguous `m` is labelled minutes", () => {
		// `m` is the metre, reinterpreted as minutes inside a duration run. The
		// first version of that fix kept the original spelling, so `3h 5m` came
		// out as "185 m": the right number under the wrong unit, which is worse
		// than not parsing at all.
		const value = evaluate("3h 5m");
		expect(value.toNumber()).toBeCloseTo(185, 6);
		expect(value.unit).toBe("minutes");
	});

	test("and it still converts from there", () => {
		expect(num("3h 5m in seconds")).toBeCloseTo(11100, 6);
	});

	test("a bare `5m` is still five metres", () => {
		expect(num("5m in cm")).toBeCloseTo(500, 6);
	});

	test("non-time measures compound too", () => {
		expect(num("1 kilometre 500 metres in metres")).toBeCloseTo(1500, 6);
	});
});

describe("what a compound quantity must not swallow", () => {
	test("units must strictly decrease", () => {
		// "5 minutes 3 hours" is not how anyone writes a duration, and reading
		// it as one would silently reinterpret a multiplication.
		expect(() => evaluate("5 minutes 3 hours in minutes")).toThrow();
	});

	test("the parts must share a measure", () => {
		expect(() => evaluate("3 hours 5 metres in metres")).toThrow();
	});

	test("a single quantity is untouched", () => {
		expect(num("90 minutes in hours")).toBeCloseTo(1.5, 6);
	});

	test("a signed second part stays a subtraction", () => {
		// Two and a half hours, not three hours thirty. The minus makes this
		// arithmetic rather than a compound quantity, which is the point.
		expect(num("(3 hours - 30 minutes) in minutes")).toBeCloseTo(150, 6);
	});
});

describe("as timespan", () => {
	test("`5.5 minutes as timespan` is 5 minutes 30 seconds", () => {
		expect(text("5.5 minutes as timespan")).toBe("5 minutes 30 seconds");
	});

	test("`72 days as timespan` is 10 weeks 2 days", () => {
		expect(text("72 days as timespan")).toBe("10 weeks 2 days");
	});

	test("`4.54 hours as timespan`", () => {
		expect(text("4.54 hours as timespan")).toBe("4 hours 32 minutes 24 seconds");
	});

	test("zero parts are skipped", () => {
		expect(text("2 hours as timespan")).toBe("2 hours");
	});

	test("singular and plural", () => {
		expect(text("1 hour 1 minute as timespan")).toBe("1 hour 1 minute");
	});

	test("a fractional remainder is kept rather than rounded away", () => {
		expect(text("90.5 seconds as timespan")).toBe("1 minute 30.5 seconds");
	});

	test("zero is still a duration", () => {
		expect(text("0 seconds as timespan")).toBe("0 seconds");
	});

	test("a non-duration says so instead of inventing one", () => {
		expect(text("5 metres as timespan")).toMatch(/needs a duration/i);
	});
});

describe("as laptime", () => {
	test("`5.5 minutes as laptime` is 00:05:30", () => {
		expect(text("5.5 minutes as laptime")).toBe("00:05:30");
	});

	test("hours are not wrapped at 24", () => {
		// A twenty-six hour lap is a real measurement; wrapping it to two
		// would be silently wrong.
		expect(text("26 hours as laptime")).toBe("26:00:00");
	});

	test("a fractional second is kept", () => {
		expect(text("90.25 seconds as laptime")).toBe("00:01:30.250");
	});

	test("a non-duration says so", () => {
		expect(text("5 metres as laptime")).toMatch(/needs a duration/i);
	});
});

describe("the two are inverses", () => {
	test("a compound quantity round-trips through as timespan", () => {
		expect(text("3 hours 5 minutes 10 seconds as timespan")).toBe("3 hours 5 minutes 10 seconds");
	});
});
