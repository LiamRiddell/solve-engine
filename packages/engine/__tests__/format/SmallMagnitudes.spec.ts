/**
 * A value that is not zero never prints as one.
 *
 * Two decimal places is the right budget for almost everything the engine
 * answers, and wrong for the answers below it. `1 Hz in MHz` printed `0.00 MHz`
 * and `1 byte in GB` printed `0.00 GB`: both correct conversions with nothing
 * left of them, and nothing to tell either apart from a real zero.
 *
 * Such a magnitude is now shown to three significant digits, as a decimal while
 * the zeros are countable and in exponent form once they are not. What is
 * pinned here is mostly the narrowness: every value that already rendered
 * legibly renders exactly as it did, money keeps its `0.00` because a currency
 * zero is a real answer, and an explicit `to N dp` is given the places it asked
 * for.
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

describe("a conversion that lands below the decimal budget is still readable", () => {
	test("across several orders of magnitude", () => {
		expect(answer("1 Hz in MHz")).toBe("1e-6 MHz");
		expect(answer("1 byte in GB")).toBe("1e-9 GB");
		expect(answer("1 byte in TB")).toBe("1e-12 TB");
		expect(answer("1 g in tonnes")).toBe("1e-6 tonnes");
		expect(answer("1 mm in km")).toBe("1e-6 km");
	});

	test("with three significant digits where there are three to show", () => {
		expect(answer("1 second in years")).toBe("3.17e-8 years");
	});

	test("and the sign is kept", () => {
		expect(answer("-1 Hz in MHz")).toBe("-1e-6 MHz");
	});
});

describe("the decimal form is used while the zeros are countable", () => {
	test("a few places below the budget stays a decimal", () => {
		expect(answer("0.001 km")).toBe("0.001 km");
		expect(answer("0.004 kg")).toBe("0.004 kg");
	});

	test("a plain number is treated the same way as a quantity", () => {
		expect(answer("0.0000001")).toBe("1e-7");
		expect(answer("1/1000000")).toBe("1e-6");
		expect(answer("1e-9")).toBe("1e-9");
	});
});

describe("an explicit place count is obeyed on a quantity", () => {
	test("more places than the setting", () => {
		// The defect beside the display floor: a quantity's own place count was
		// never read, so `to 4 dp` was given the setting's two.
		expect(answer("1.23456 km to 4 dp")).toBe("1.2346 km");
	});

	test("fewer places than the setting", () => {
		expect(answer("5 km to 0 dp")).toBe("5 km");
	});

	test("and it beats the display floor, because the line asked", () => {
		expect(answer("1 second in years to 12 dp")).toBe("0.000000031710 years");
	});

	test("the same spelling on a plain number is unchanged", () => {
		expect(answer("1.23456 to 4 dp")).toBe("1.2346");
	});
});

describe("what this deliberately leaves alone", () => {
	test("money, because a currency zero is a real answer", () => {
		// A tenth of a penny is not a payable amount, so it rounds to nothing and
		// says so. Reading it as `1e-3` would be worse, not better.
		expect(answer("$0.001")).toBe("$0.00");
		expect(answer("£0.00")).toBe("£0.00");
	});

	test("a genuine zero", () => {
		expect(answer("0 kg")).toBe("0.00 kg");
	});

	test("every value that already rendered legibly", () => {
		expect(answer("1.5 km")).toBe("1.50 km");
		expect(answer("100 cm in m")).toBe("1.00 m");
		expect(answer("0.5 in mm")).toBe("0.50 mm");
		expect(answer("0.1 + 0.2")).toBe("0.30");
		expect(answer("2 + 2")).toBe("4");
	});

	test("and the explicit scientific converter, which said it first", () => {
		expect(answer("1 Hz in MHz as scientific")).toBe("1e-6");
	});
});
