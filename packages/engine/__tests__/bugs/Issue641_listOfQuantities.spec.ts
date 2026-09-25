import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { cellUnitsDiffer, sameUnit } from "@solve-js/vm/VMConversion";

/**
 * Issue #641: a list literal stored each cell's magnitude and dropped its unit,
 * so quantities in two units could not both be read right: `[1 km, 500 m]` was
 * `[1, 500]`, as if 500 m were 500 km, and `[1 kg, 3 m]` put a mass beside a
 * length. A literal whose cells are in two different units is refused by name.
 * A list in one unit keeps today's bare magnitudes (nothing in it is misread),
 * and a bare number beside a quantity is read in its unit, as `total of 1 km,
 * 500` reads it.
 */

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a list whose cells are in two units is refused", () => {
	test.each([
		"[1 km, 500 m]",
		"[1 km, 500 m] * 2",
		"[1 kg, 3 m]",
		"[$1, 2 kg]",
		"[$1, €2]",
		"[0 °C, 32 °F]",
		"[1 km/h, 2 mph]",
		"[1 km; 500 m]",
		"[1 km, 2 km, 500 m]",
	])("%s", (line) => {
		expect(code(line)).toBe("MATRIX_CELL_UNITS_DIFFER");
	});

	test("the message names both units, and how to put them in one", () => {
		expect(shown("[1 km, 500 m]")).toBe(
			'A list cannot hold quantities in km and m side by side: each cell holds one number, so both would be read in one unit. Convert the cells to one unit first, writing "in km" after each cell in another unit.',
		);
		expect(shown("[1 kg, 3 m]")).toBe("A list cannot hold quantities in kg and m side by side: each cell holds one number, and mass and length are not one measure.");
	});

	test("the way the message suggests works", () => {
		expect(shown("[1 km, 500 m in km]")).toBe("= [1, 0.50]");
	});
});

describe("the boundary: one unit, or a bare number beside it, keeps its magnitudes", () => {
	test.each([
		["[1 km, 2 km]", "= [1, 2]"],
		["[$1, $2]", "= [1, 2]"],
		["[1 km, 2 kilometres]", "= [1, 2]"],
		["[0 °C, 0 C]", "= [0, 0]"],
		["[1 km, 500]", "= [1, 500]"],
		["[1, 2, 3]", "= [1, 2, 3]"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a unit written after a list is a different refusal (#640)", () => {
		expect(code("[1, 2] km")).toBe("CONVERT_NON_NUMERIC");
	});
});

describe("adversarial", () => {
	test("quantities from variables and from line references, through both passes", () => {
		const vars = expectHonestDocument("a = 1 km\nb = 500 m\n[a, b]\n[a, a]");
		expect(vars.batch[2]).toMatch(/^ERROR A list cannot hold quantities in km and m side by side/);
		expect(vars.batch[3]).toBe("= [1, 1]");
		const refs = expectHonestDocument("1 km\n500 m\n[line 1, line 2]");
		expect(refs.batch[2]).toMatch(/^ERROR A list cannot hold quantities in km and m side by side/);
	});

	test("a sweep over quantities still lists its answers", () => {
		const { batch } = expectHonestDocument("length = 2 m\nwidth = 3 m\nlength * width\nline 3 for length from 1 m to 3 m step 50 cm");
		expect(batch[3]).toBe("= [3, 4.50, 6, 7.50, 9]");
	});

	test("a long list (near the complexity limit) with one stray unit at the end is refused within budget", () => {
		const cells = Array.from({ length: 150 }, () => "1 km");
		expectHonestLine(`[${[...cells, "1 m"].join(", ")}]`);
		expect(code(`[${[...cells, "1 m"].join(", ")}]`)).toBe("MATRIX_CELL_UNITS_DIFFER");
	});
});

describe("sameUnit", () => {
	test("the same spelling, and two aliases of one unit, are one unit", () => {
		expect(sameUnit("km", "km")).toBe(true);
		expect(sameUnit("km", "kilometres")).toBe(true);
		expect(sameUnit("°C", "C")).toBe(true);
	});

	test("two different units, and case, are not", () => {
		expect(sameUnit("km", "m")).toBe(false);
		expect(sameUnit("°C", "°F")).toBe(false);
		expect(sameUnit("km", "KM")).toBe(false);
		expect(sameUnit("USD", "EUR")).toBe(false);
	});

	test("words naming inherited properties are not units, and change nothing", () => {
		expectPrototypeUntouched(() => {
			expect(sameUnit("constructor", "toString")).toBe(false);
			expect(sameUnit("__proto__", "km")).toBe(false);
		});
	});
});

describe("cellUnitsDiffer", () => {
	test("one unit is not refused", () => {
		expect(cellUnitsDiffer("km", "kilometres")).toBeNull();
	});

	test("two units of one measure point at a conversion", () => {
		const refused = cellUnitsDiffer("km", "m");
		expect(refused?.errorCode).toBe("MATRIX_CELL_UNITS_DIFFER");
		expect(formatValue(refused!)).toContain('writing "in km"');
	});

	test("two measures say so", () => {
		expect(formatValue(cellUnitsDiffer("USD", "kg")!)).toContain("money and mass are not one measure");
	});
});
