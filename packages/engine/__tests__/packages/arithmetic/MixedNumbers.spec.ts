/**
 * `1 1/2 cups`, and the vulgar fractions, as the single quantity each one is.
 *
 * A recipe is written in mixed numbers and the engine ships a cooking package
 * aimed squarely at that reader, but `1 1/2 cups in ml` was a parse error and
 * `½ tsp` was an undefined variable.
 *
 * The spelling with the word in it was worse than either, because it answered:
 * `1 and 1/2 cups in ml` computed `1 + (1/2 cups)` and said `119.29 ml`, where
 * the quantity a person meant is `354.88 ml`. That silent wrong number is the
 * reason this is more than a convenience, and it is what the agreement tests
 * below pin.
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

describe("a mixed number carries a unit", () => {
	test("the spelling a recipe uses", () => {
		expect(answer("1 1/2 cups in ml")).toBe("354.88 ml");
		expect(answer("2 1/4 kg in lb")).toBe("4.96 lb");
	});

	test("and it agrees with the decimal it stands for", () => {
		expect(answer("1 1/2 cups in ml")).toBe(answer("1.5 cups in ml"));
		expect(answer("2 1/4 kg in lb")).toBe(answer("2.25 kg in lb"));
	});

	test("without a unit it is just the number", () => {
		expect(answer("1 1/2")).toBe("1.50");
		expect(answer("1 1/2 + 1")).toBe("2.50");
	});
});

describe("the vulgar fractions read", () => {
	test("on their own", () => {
		expect(answer("\u00bd")).toBe("0.50");
		expect(answer("\u00bc")).toBe("0.25");
		expect(answer("\u00be")).toBe("0.75");
		expect(answer("\u2153")).toBe("0.33");
		expect(answer("\u2154")).toBe("0.67");
		expect(answer("\u215b")).toBe("0.13");
	});

	test("with a unit", () => {
		expect(answer("\u00bd tsp in ml")).toBe("2.46 ml");
	});

	test("and after a whole number, which is the same mixed number written shorter", () => {
		expect(answer("2 \u00bd cups in ml")).toBe("591.47 ml");
		expect(answer("2 \u00bd cups in ml")).toBe(answer("2.5 cups in ml"));
	});

	test("a bare one keeps the exactness typing the division has", () => {
		// Emitted as a numerator over a denominator rather than as a decimal, so
		// it behaves exactly as `1/2` does everywhere that reads a fraction.
		expect(answer("\u00bd as fraction")).toBe(answer("1/2 as fraction"));
	});
});

describe("the word spelling, which used to answer wrongly", () => {
	test("`1 and 1/2 cups` is a cup and a half", () => {
		// Was 119.29 ml: one, plus half a cup converted.
		expect(answer("1 and 1/2 cups in ml")).toBe("354.88 ml");
		expect(answer("1 and 1/2 cups in ml")).toBe(answer("1.5 cups in ml"));
	});
});

describe("what this deliberately leaves alone", () => {
	test("a sum written as a sum", () => {
		// `+` is not `and`. Claiming this shape would change what an ordinary
		// sum answers, which is not a spelling question.
		expect(answer("1 + 1/2 cups in ml")).toBe("119.29 ml");
	});

	test("the hyphen, which is ambiguous against subtraction", () => {
		expect(answer("1-1/2")).toBe("0.50");
	});

	test("an improper fraction, which is not a mixed number", () => {
		expect(answer("1/2 + 1/3")).toBe("0.83");
		expect(answer("3/2")).toBe("1.50");
	});

	test("and how a fraction prints", () => {
		expect(answer("1.5 as fraction")).toBe("3/2");
		expect(answer("0.75 as fraction")).toBe("3/4");
	});
});
