import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { sameUnit } from "@solve-js/vm/VMConversion";

/**
 * Issue #641: a list literal stored each cell's magnitude and dropped its unit,
 * so quantities in two units could not both be read right: `[1 km, 500 m]` was
 * `[1, 500]`, as if 500 m were 500 km, and `[1 kg, 3 m]` put a mass beside a
 * length. A literal whose cells are in two different measures is refused by
 * name, and a bare number beside a quantity is read in its unit, as `total of 1
 * km, 500` reads it.
 *
 * Since #745 a list carries a unit, so two units of one measure no longer need
 * refusing: `[1 km, 500 m]` is `[1.00 km, 0.50 km]`, each cell read in the
 * first cell's unit. The refusals below are the ones that remain, and the
 * cases that used to be refused are pinned to their new answers.
 */

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a list whose cells are in two measures is refused", () => {
	test.each([
		"[1 kg, 3 m]",
		"[$1, 2 kg]",
		"[$1, €2]",
		// Two rates of different measures: a speed and a mass flow.
		"[1 km/h, 2 kg/s]",
	])("%s", (line) => {
		expect(code(line)).toBe("MATRIX_CELL_UNITS_DIFFER");
	});

	test("the message names both units and both measures", () => {
		expect(shown("[1 kg, 3 m]")).toBe("A list holds one unit, and a cell in m has no reading in kg: mass and length are not one measure.");
	});
});

describe("two units of one measure are read in the first (#745)", () => {
	test.each([
		["[1 km, 500 m]", "= [1.00 km, 0.50 km]"],
		["[1 km, 500 m] * 2", "= [2.00 km, 1.00 km]"],
		["[0 °C, 32 °F]", "= [0.00 °C, 0.00 °C]"],
		["[1 km; 500 m]", "= [1.00 km; 0.50 km]"],
		["[1 km, 2 km, 500 m]", "= [1.00 km, 2.00 km, 0.50 km]"],
		["[1 km, 500 m in km]", "= [1.00 km, 0.50 km]"],
		// Two speeds are one measure since two rates of one kind convert (the
		// found-bugs batch that made `10 m/s + 36 km/h` add), so a list of them
		// is read in the first cell's unit rather than refused.
		["[1 km/h, 2 mph]", "= [1.00 km/h, 3.22 km/h]"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("one unit, or a bare number beside it, is a list in that unit", () => {
	test.each([
		["[1 km, 2 km]", "= [1.00 km, 2.00 km]"],
		["[$1, $2]", "= [$1.00, $2.00]"],
		["[1 km, 2 kilometres]", "= [1.00 km, 2.00 km]"],
		["[0 °C, 0 C]", "= [0.00 °C, 0.00 °C]"],
		["[1 km, 500]", "= [1.00 km, 500.00 km]"],
		["[1, 2, 3]", "= [1, 2, 3]"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a unit written after a list gives it that unit (#745, where #640 refused it)", () => {
		expect(shown("[1, 2] km")).toBe("= [1.00 km, 2.00 km]");
	});
});

describe("adversarial", () => {
	test("quantities from variables and from line references, through both passes", () => {
		const vars = expectHonestDocument("a = 1 km\nb = 500 m\n[a, b]\n[a, a]");
		expect(vars.batch[2]).toBe("= [1.00 km, 0.50 km]");
		expect(vars.batch[3]).toBe("= [1.00 km, 1.00 km]");
		const refs = expectHonestDocument("1 km\n500 m\n[line 1, line 2]");
		expect(refs.batch[2]).toBe("= [1.00 km, 0.50 km]");
		const measures = expectHonestDocument("a = 1 km\nb = 2 kg\n[a, b]");
		expect(measures.batch[2]).toMatch(/^ERROR A list holds one unit, and a cell in kg has no reading in km/);
	});

	test("a sweep over quantities still lists its answers", () => {
		const { batch } = expectHonestDocument("length = 2 m\nwidth = 3 m\nlength * width\nline 3 for length from 1 m to 3 m step 50 cm");
		expect(batch[3]).toBe("= [3.00 m², 4.50 m², 6.00 m², 7.50 m², 9.00 m²]");
	});

	test("a long list (near the complexity limit) with one stray measure at the end is refused within budget", () => {
		const cells = Array.from({ length: 150 }, () => "1 km");
		expectHonestLine(`[${[...cells, "1 kg"].join(", ")}]`);
		expect(code(`[${[...cells, "1 kg"].join(", ")}]`)).toBe("MATRIX_CELL_UNITS_DIFFER");
		expect(code(`[${[...cells, "1 m"].join(", ")}]`)).toBeUndefined();
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
