/**
 * `in` as the abbreviation for inches, where it cannot be the preposition.
 *
 * `in` is the conversion operator, so the unit table refuses to claim the
 * spelling and the word lexes as a keyword everywhere. That is right for
 * `12 in ft` and wrong for `12 in in cm`, which took the magnitude and
 * relabelled it: `12.00 cm`, where the full spelling gives `30.48 cm`.
 * `2 in + 3 in` lost the unit entirely and answered a bare `5`.
 *
 * The claim is narrow, and pinning the narrowness is most of what is here: the
 * word is the unit only directly after a number and only where there is plainly
 * nothing to convert into. Every conversion the engine already read must go on
 * reading the same way, which is the regression this guards.
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

describe("the abbreviation converts the way the full spelling does", () => {
	test("into a metric length", () => {
		expect(answer("12 in in cm")).toBe("30.48 cm");
		expect(answer("12 inches in cm")).toBe("30.48 cm");
	});

	test("and in the other spellings of the same conversion", () => {
		expect(answer("5 in in mm")).toBe("127.00 mm");
		expect(answer("12 in to cm")).toBe("30.48 cm");
		expect(answer("36 in in ft")).toBe("3.00 ft");
		expect(answer("24 in in feet")).toBe("2.00 feet");
	});
});

describe("the unit survives arithmetic instead of vanishing", () => {
	test("addition", () => {
		expect(answer("2 in + 3 in")).toBe("5.00 in");
	});

	test("scaling, either way round", () => {
		expect(answer("12 in * 2")).toBe("24.00 in");
		expect(answer("5 in / 2")).toBe("2.50 in");
	});

	test("on its own, at the end of a line", () => {
		expect(answer("12 in")).toBe("12.00 in");
	});

	test("and a parenthesised sum converts as one quantity", () => {
		expect(answer("(2 in + 3 in) in cm")).toBe("12.70 cm");
		expect(answer("12 in in mm + 3 in")).toBe("381.00 mm");
	});
});

describe("every conversion the engine already read still reads the same", () => {
	test("a bare number into a unit is untouched", () => {
		// `in` here is the preposition with a target after it, which is the most
		// common form in the engine. What that means for a unitless left side is
		// a separate question from whether `in` is a unit.
		expect(answer("12 in ft")).toBe("12.00 ft");
		expect(answer("12 in cm")).toBe("12.00 cm");
	});

	test("a quantity into another unit", () => {
		expect(answer("5 km in miles")).toBe("3.11 miles");
		expect(answer("100 in USD")).toBe("$100.00");
	});

	test("into inches, where the word follows a unit rather than a number", () => {
		expect(answer("3 ft in in")).toBe("36.00 in");
	});

	test("a year, which is a number and not a unit", () => {
		expect(answer("$500 in 1990 dollars")).toBe("$196.42");
	});

	test("a number base, whose name is neither unit nor identifier", () => {
		expect(answer("99 in binary")).toBe("0b1100011");
	});
});
