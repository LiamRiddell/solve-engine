import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { writtenDecimalPlaces, writtenPrecisionMargin } from "@solve-js/packages/conditionals/CheckFunctions";
import { numberValue, percentageValue, stringValue, uomValue } from "@solve-js/vm/Value";

/**
 * Found bug: `check 60 mph ≈ 96.56 km/h` failed. Sixty miles an hour is
 * 96.56064 km/h, which is 96.56 to the two places written, but `≈` with no
 * `within` allowed only rounding noise (a billionth of the size), so the
 * figure a reader copies off a road sign or a converter never passed.
 *
 * With no `within`, `≈` now also allows half a unit in the last decimal place
 * the right side is written to (`writtenPrecisionMargin`), converted into the
 * left side's unit: the check asks whether the left is the right to the places
 * given. A whole number on the right gives no such margin, so `check 5.4 ≈ 5`
 * still fails, and a figure worked out to every digit (`pi`, `1/3`) is held to
 * rounding noise as before.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["check 60 mph ≈ 96.56 km/h", "✓ (differs by 0.000398 mph)"],
		["check 1/3 ≈ 0.333", "✓ (differs by 0.000333)"],
		["check 1/3 ≈ 0.33", "✓ (differs by 0.00333)"],
		["check 0.1 + 0.2 ≈ 0.3", "✓"],
		["check 1 mile ≈ 1.609 km", "✓ (differs by 0.000214 mile)"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test.each([
		["check 60 mph ≈ 96.5 km/h", "check failed: 60 mph is not equal to 96.5 km/h"],
		["check 60 mph ≈ 96 km/h", "check failed: 60 mph is not equal to 96 km/h"],
		["check 5.4 ≈ 5", "check failed: 5.4 is not equal to 5"],
		["check 22/7 ≈ pi", "check failed: 3.14286 is not equal to 3.14159"],
		["check 1/3 ≈ 0.334", "check failed: 0.333333 is not equal to 0.334"],
	])("%s fails: %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("== and a stated within are unchanged", () => {
		expect(shown("check 60 mph == 96.56 km/h")).toBe("check failed: 60.0000 mph is not equal to 96.5600 km/h");
		expect(shown("check 22/7 ≈ pi within 0.1%")).toBe("✓ (differs by 0.04%)");
		expect(shown("check 5 m ≈ 5.01 m within 1 cm")).toBe("✓ (differs by 0.01 m)");
	});
});

describe("the parts", () => {
	test("writtenDecimalPlaces: ordinary numbers", () => {
		expect(writtenDecimalPlaces(96.56)).toBe(2);
		expect(writtenDecimalPlaces(42)).toBe(0);
		expect(writtenDecimalPlaces(-0.5)).toBe(1);
		expect(writtenDecimalPlaces(1 / 3)).toBe(16);
	});

	test("writtenDecimalPlaces: exponent forms and the edges", () => {
		expect(writtenDecimalPlaces(1e-7)).toBe(7);
		expect(writtenDecimalPlaces(1.5e-7)).toBe(8);
		expect(writtenDecimalPlaces(1e21)).toBe(0);
		expect(writtenDecimalPlaces(0)).toBe(0);
		expect(writtenDecimalPlaces(-0)).toBe(0);
		expect(writtenDecimalPlaces(Number.MIN_VALUE)).toBe(324);
		expect(writtenDecimalPlaces(Number.MAX_VALUE)).toBe(0);
		expect(writtenDecimalPlaces(Infinity)).toBe(0);
		expect(writtenDecimalPlaces(Number.NaN)).toBe(0);
	});

	test("writtenPrecisionMargin: half the last place, in the left side's unit", () => {
		expect(writtenPrecisionMargin(numberValue(0.33), 0.33)).toBeCloseTo(0.005, 15);
		expect(writtenPrecisionMargin(uomValue(96.56, "km/h"), 60 * 0.99999337)).toBeCloseTo(0.005 * (60 * 0.99999337) / 96.56, 12);
		expect(writtenPrecisionMargin(numberValue(5), 5)).toBe(0);
		expect(writtenPrecisionMargin(numberValue(0), 0)).toBe(0);
		expect(writtenPrecisionMargin(numberValue(-2.5), -2.5)).toBeCloseTo(0.05, 15);
	});

	test("writtenPrecisionMargin: kinds with no written figure give none", () => {
		expect(writtenPrecisionMargin(percentageValue(0.125), 0.125)).toBe(0);
		expect(writtenPrecisionMargin(stringValue("1.5"), 1.5)).toBe(0);
		expect(writtenPrecisionMargin(numberValue(Infinity), Infinity)).toBe(0);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the unit, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`check 60 mph ≈ 96.56 ${word}`);
				expectHonestLine(`check 60 ${word} ≈ 96.56 km/h`);
			}
		});
	});

	test("security: look-alike and markup-shaped text after the check", () => {
		for (const line of fill("check 60 mph ≈ 96.56 km/h X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(`check 1 ≈ 1.${"0".repeat(400)}1`);
	});

	test("realistic: the figure from the line above, counted, through both passes", () => {
		const text = "speed = 60 mph\nroad = 96.56 km/h\ncheck speed ≈ road\ncheck speed ≈ 96.5 km/h";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[2]).toBe("= ✓ (differs by 0.000398 mph)");
		expect(batch[3]).toMatch(/^ERROR check failed/);
		expect(incremental).toEqual(batch);
		const checks = newTrackedEngine().parseDocument(text).checks;
		expect(checks).toEqual(expect.objectContaining({ passed: 1, failed: 1 }));
	});

	test("edge: every numeric edge on each side", () => {
		for (const line of fill("check X ≈ 0.5", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("check 0.5 ≈ X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
