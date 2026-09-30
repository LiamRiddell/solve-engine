import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { convertRaw } from "@solve-js/uom/UnitConversion";

/**
 * Found bug: the unit table's `point` was 0.3528 mm, upstream's figure cut to
 * four places, where a typographic point is exactly a 72nd of an inch,
 * 0.3527777... mm. The pica beside it had the same cut (4.2333 mm for a sixth
 * of an inch), so a pica came to 11.999 points. Both are now exact, the value
 * the two-word `typographic point` already had.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
}

describe("the table's values", () => {
	test("the point is a 72nd of an inch and the pica a sixth, exactly", () => {
		expect(UNIT_TABLE.point[1]).toBe(0.0254 / 72);
		expect(UNIT_TABLE.points[1]).toBe(0.0254 / 72);
		expect(UNIT_TABLE.pica[1]).toBe(0.0254 / 6);
		expect(UNIT_TABLE.picas[1]).toBe(0.0254 / 6);
	});

	test("the table's point agrees with the typographic point read after a number", () => {
		expect(UNIT_TABLE.point[1]).toBe(EXTENDED_UNITS["typographic point"].toBase);
	});

	test("the relations that define them hold", () => {
		expect(convertRaw(1, "pica", "point")).toBeCloseTo(12, 12);
		expect(convertRaw(72, "point", "in")).toBeCloseTo(1, 12);
		expect(convertRaw(6, "pica", "in")).toBeCloseTo(1, 12);
		expect(convertRaw(1, "point", "mm")).toBeCloseTo(0.35277777777777775, 15);
	});
});

describe("what a reader sees", () => {
	test.each([
		["1 pica in points", "12.00 points"],
		["1 inch in points", "72.00 points"],
		["1 mm in points", "2.83 points"],
		["10 cm in picas", "23.62 picas"],
		["12 typographic points in points", "12.00 points"],
		["1 inch in picas", "6.00 picas"],
		["(1 inch in points) to 10 dp", "72.0000000000 points"],
		["(1 pica in points) to 10 dp", "12.0000000000 points"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the target unit are refused honestly", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("1 inch in X", PROTOTYPE_WORDS)) expectHonestLine(line);
		});
	});

	test("realistic: a unit that does not fit is refused, and a value from above converts", () => {
		expect(newTrackedEngine().evaluateExpression("1 kg in points").isError()).toBe(true);
		const engine = newTrackedEngine();
		engine.evaluateExpression("margin = 2 cm");
		expect(formatValue(engine.evaluateExpression("margin in points"))).toBe("= 56.69 points");
	});

	test("edges: zero, negatives and the largest double", () => {
		expect(shown("0 inch in points")).toBe("0.00 points");
		expect(shown("-1 inch in points")).toBe("-72.00 points");
		expectHonestLine("1e308 inch in points");
	});
});
