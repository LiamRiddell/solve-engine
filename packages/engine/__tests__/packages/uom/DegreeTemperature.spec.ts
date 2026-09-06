/**
 * `20°C`, the temperature as a phone keyboard writes it.
 *
 * `°C` and `°F` are in the unit table and could never reach it: the lexer reads
 * a unit as one run of `[A-Za-z0-9_]`, so a non-ASCII character cannot become a
 * UNIT token, and the line arrived as a number and an identifier nobody had
 * defined. Every other spelling of the same question already answered, so this
 * was a refusal with the answer one retyped character away.
 *
 * What is pinned here is that the symbol spellings now reach every place the
 * word spellings do, and that the bare `°` of an angle is untouched, since the
 * two rules claim the same character and only one of them may have it.
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

describe("the symbol converts wherever the word does", () => {
	test("between the two scales", () => {
		expect(answer("20°C in F")).toBe("68.00 F");
		expect(answer("100°F in C")).toBe("37.78 C");
	});

	test("and it is the same answer the spaced and spelled forms give", () => {
		expect(answer("20 C in F")).toBe("68.00 F");
		expect(answer("20 degrees C in F")).toBe("68.00 F");
		expect(answer("20° C in F")).toBe("68.00 F");
	});

	test("into gas mark, which is a temperature question too", () => {
		expect(answer("180°C in gas mark")).toBe("gas 4");
	});

	test("the precomposed characters some keyboards emit", () => {
		expect(answer("20℃ in F")).toBe("68.00 F");
		expect(answer("68℉ in C")).toBe("20.00 C");
	});

	test("and kelvin, which has no degree sign of its own", () => {
		expect(answer("0°K in C")).toBe("-273.15 C");
	});
});

describe("a bare quantity keeps its symbol", () => {
	test("so the line reads back the way it was typed", () => {
		expect(answer("37°C")).toBe("37.00 °C");
	});
});

describe("the angle is untouched", () => {
	test("the bare symbol is still degrees of arc", () => {
		expect(answer("90°")).toBe("90.00 degrees");
		expect(answer("sin(90°)")).toBe("1");
	});
});
