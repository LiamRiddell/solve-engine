import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill, NUMERIC_EDGES, PROTOTYPE_WORDS } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, ValueType, errorValue, numberValue, stringValue, uomValue, matrixValue, pendingValue } from "@solve-js/vm/Value";
import { readDimensions, measureInUnit } from "@solve-js/packages/geometry/GeometryUnits";
import { asPowerOfLength } from "@solve-js/vm/QuantityPowers";

/**
 * Issue #638: a unit on a shape's dimension labelled the answer instead of
 * squaring it. The parselet read only the number of `radius 5 m`, so the `m`
 * applied to the whole area (78.54 m) and, in front of a comma, stopped the
 * line parsing. Each dimension is now read with its unit, the dimensions are
 * put in one length unit, and the answer takes the power its measure has: a
 * length, its square or its cube.
 *
 * The rule for a dimension with no unit beside one with a unit is the one the
 * aggregates follow (`total of 1 km, 500` is 501 km): it is read in the other
 * dimension's unit.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("a dimension with a unit gives the measure its power", () => {
	test.each([
		["area of circle radius 5 m", "= 78.54 m²"],
		["area of circle radius 5 m in cm²", "= 785,398.16 cm²"],
		["area of circle radius 5 m in ft²", "= 845.40 ft²"],
		["volume of sphere radius 2 m", "= 33.51 m³"],
		["perimeter of circle radius 5 m in cm", "= 3,141.59 cm"],
		["circumference of circle radius 5 km", "= 31.42 km"],
		["area of rectangle width 3 m, height 4 m", "= 12.00 m²"],
		["perimeter of rectangle width 3 m, height 4 m", "= 14.00 m"],
		["area of triangle base 3 cm, height 4 cm", "= 6.00 cm²"],
		["surface area of sphere radius 3 cm", "= 113.10 cm²"],
		["surface area of cube side 2 m", "= 24.00 m²"],
		["volume of cube side 2 ft", "= 8.00 ft³"],
		["volume of cylinder radius 2 m, height 5 m", "= 62.83 m³"],
		["volume of cone radius 2 ft, height 6 ft", "= 25.13 ft³"],
		["area of circle radius 5 miles", "= 78.54 mi²"],
		["area of circle radius 5 metres", "= 78.54 m²"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the same answer the formula written out by hand gives", () => {
		expect(shown("pi * (5 m)^2")).toBe(shown("area of circle radius 5 m"));
		expect(shown("4/3 * pi * (2 m)^3")).toBe(shown("volume of sphere radius 2 m"));
	});

	test("an area converted to a length is refused, not relabelled", () => {
		const value = newTrackedEngine().evaluateExpression("area of circle radius 5 m in cm");
		expect(value.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(formatValue(value)).toBe("an area cannot be converted to a length");
	});
});

describe("dimensions in different units are read in the first one's unit", () => {
	test.each([
		["area of rectangle width 3 m, height 400 cm", "= 12.00 m²"],
		["area of rectangle width 300 cm, height 4 m", "= 120,000.00 cm²"],
		["volume of cylinder radius 2 m, height 500 cm", "= 62.83 m³"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test.each([
		["area of rectangle width 3 m, height 4", "= 12.00 m²"],
		["area of rectangle width 3, height 4 m", "= 12.00 m²"],
	])("%s: a bare dimension is read in the other's unit", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a length with no square spelling of its own answers in square metres, as its power does", () => {
		expect(shown("area of square side 2 furlong")).toBe("= 161,874.26 m²");
		expect(shown("(5 furlong)^2")).toBe("= 1,011,714.11 m²");
	});
});

describe("a dimension that is not a length is refused by name", () => {
	test.each([
		["area of circle radius 5 kg", "a radius is a length, not a mass: give it in a unit of length, such as m or ft"],
		["area of circle radius 5 s", "a radius is a length, not a duration: give it in a unit of length, such as m or ft"],
		["area of rectangle width $3, height 4 m", "a width is a length, not money: give it in a unit of length, such as m or ft"],
		["area of circle radius 5 m^2", "a radius is a length, not an area: give it in a unit of length, such as m or ft"],
		["area of circle radius [1, 2]", "a radius is a length or a number, and a bracketed list is neither"],
	])("%s", (line, message) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.errorCode).toBe("GEOMETRY_ERROR");
		expect(formatValue(value)).toBe(message);
	});

	test("a speed is not a length either", () => {
		expect(code("area of circle radius 5 km/h")).toBe("GEOMETRY_ERROR");
	});
});

describe("the boundary: bare dimensions answer plain numbers, as before", () => {
	test.each([
		["area of circle radius 5", "= 78.54"],
		["area of rectangle width 3, height 4", "= 12"],
		["volume of sphere radius 3", "= 113.10"],
		["area of circle radius -5", "= 78.54"],
		["area of circle radius 0", "= 0"],
		["area of circle radius 2^2", "= 157.91"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a missing dimension is still refused", () => {
		expect(code("area of rectangle width 3 m")).toBe("GEOMETRY_ERROR");
	});
});

describe("adversarial", () => {
	test("a zero or negative dimension with a unit reads as its bare number does", () => {
		expect(shown("area of circle radius 0 m")).toBe("= 0.00 m²");
		expect(shown("area of circle radius -5 m")).toBe("= 78.54 m²");
		expect(shown("area of square side 0.1 m")).toBe("= 0.01 m²");
	});

	test("the answer takes part in arithmetic as an area", () => {
		expect(shown("area of circle radius 5 m + 1 m²")).toBe("= 79.54 m²");
	});

	test("every numeric edge as a radius in metres is answered honestly", () => {
		for (const line of fill("area of circle radius X m", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("a word naming an inherited property as a dimension changes nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`area of circle ${word} 5 m`);
		});
	});

	test("a quantity held in a variable or a line, through both document passes", () => {
		const { batch } = expectHonestDocument("r = 5 m\narea of circle radius r\n5 m\narea of circle radius line 3\narea of circle radius 5 m\nline 5 in cm²");
		expect(batch).toEqual(["= 5.00 m", "= 78.54 m²", "= 5.00 m", "= 78.54 m²", "= 78.54 m²", "= 785,398.16 cm²"]);
	});
});

describe("readDimensions", () => {
	const pairs = (...values: [string, Value][]): Value[] => values.flatMap(([name, value]) => [stringValue(name), value]);

	test("bare numbers are read as they are, with no unit", () => {
		expect(readDimensions(pairs(["width", numberValue(3)], ["height", numberValue(4)]))).toEqual({ dims: { width: 3, height: 4 }, unit: undefined });
	});

	test("lengths are converted into the first one's unit", () => {
		const read = readDimensions(pairs(["width", uomValue(3, "m")], ["height", uomValue(400, "cm")]));
		expect(read).toEqual({ dims: { width: 3, height: 4 }, unit: "m" });
	});

	test("a bare number beside a length is left as it is, in that length's unit", () => {
		expect(readDimensions(pairs(["width", numberValue(3)], ["height", uomValue(4, "ft")]))).toEqual({ dims: { width: 3, height: 4 }, unit: "ft" });
	});

	test("a quantity that is not a length is refused", () => {
		const read = readDimensions(pairs(["radius", uomValue(5, "kg")])) as Value;
		expect(read.errorCode).toBe("GEOMETRY_ERROR");
	});

	test("a value with no single amount is refused", () => {
		const read = readDimensions(pairs(["radius", matrixValue(1, 2, [1, 2])])) as Value;
		expect(read.errorCode).toBe("GEOMETRY_ERROR");
	});

	test("a fault is handed back as it is", () => {
		const fault = errorValue("SOME_FAULT", "it failed");
		expect(readDimensions(pairs(["radius", fault]))).toBe(fault);
		const pending = pendingValue("key");
		expect(readDimensions(pairs(["radius", pending]))).toBe(pending);
	});

	test("no dimensions at all read as none", () => {
		expect(readDimensions([])).toEqual({ dims: {}, unit: undefined });
	});
});

describe("asPowerOfLength", () => {
	test("labels a magnitude in a length's square or cube with the unit's own spelling", () => {
		expect(formatValue(asPowerOfLength(uomValue(12, "m"), "m", 2))).toBe("= 12.00 m²");
		expect(formatValue(asPowerOfLength(uomValue(8, "ft"), "ft", 3))).toBe("= 8.00 ft³");
	});

	test("measures a length with no square spelling in square metres", () => {
		const area = asPowerOfLength(uomValue(1, "furlong"), "furlong", 2);
		expect(area.unit).toBe("m²");
		expect(area.toNumber()).toBeCloseTo(201.168 ** 2, 6);
	});
});

describe("measureInUnit", () => {
	test("with no unit the measure is a plain number", () => {
		const v = measureInUnit(12, "area", undefined);
		expect(v.type).toBe(ValueType.Number);
		expect(v.toNumber()).toBe(12);
	});

	test("a perimeter is in the length, an area in its square, a volume in its cube", () => {
		expect(formatValue(measureInUnit(14, "perimeter", "m"))).toBe("= 14.00 m");
		expect(formatValue(measureInUnit(12, "area", "m"))).toBe("= 12.00 m²");
		expect(formatValue(measureInUnit(12, "surface", "cm"))).toBe("= 12.00 cm²");
		expect(formatValue(measureInUnit(8, "volume", "ft"))).toBe("= 8.00 ft³");
	});

	test("an unknown measure, or one named like an inherited property, is taken as a length", () => {
		expect(measureInUnit(3, "constructor", "m").unit).toBe("m");
		expect(measureInUnit(3, "nonsense", "m").unit).toBe("m");
	});
});
