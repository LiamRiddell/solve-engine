import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dimensionOf, tryDimensionalCompose } from "@solve-js/uom/Dimensions";
import { accelerationSize, convertRate, unitForMessage } from "@solve-js/uom/UomConverter";
import { describeMeasure, unifyUom } from "@solve-js/vm/VMConversion";
import { ValueType, uomValue, numberValue } from "@solve-js/vm/Value";

/**
 * Issue #737: the unit algebra knew force, energy, power, pressure and voltage,
 * but not speed, acceleration or frequency, so `9.81 m/s^2 * 3 s` was refused,
 * `100 km/h / 10 s` was called a rate of a rate, `10 Hz * 2 s` was refused and
 * `100 W / 20 V` stayed `W/V` instead of becoming amperes.
 *
 * Speed, frequency and every unit written with a slash now have a dimension
 * (`uom/Dimensions.ts`), the ampere is a named result, and a product or quotient
 * with a speed, an acceleration or a frequency on one side is named as the
 * speed, acceleration, time, mass or plain count it comes to. An acceleration
 * can be written in any length over a squared time (`ft/s^2`), and accelerations
 * convert and add among themselves.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("the identities the issue names, in both orders", () => {
	test.each([
		["9.81 m/s^2 * 3 s", "= 29.43 m/s"],
		["3 s * 9.81 m/s^2", "= 29.43 m/s"],
		["100 km/h / 10 s", "= 2.78 m/s²"],
		["10 Hz * 2 s", "= 20"],
		["2 s * 10 Hz", "= 20"],
		["100 W / 20 V", "= 5.00 A"],
		["2 A * 12 V", "= 24.00 W"],
		["12 V * 2 A", "= 24.00 W"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the other quotients of the same triangle", () => {
		expect(shown("29.43 m/s / 9.81 m/s^2")).toBe("= 3.00 s");
		expect(shown("20 N / 2 m/s^2")).toBe("= 10.00 kg");
		expect(shown("10 m/s * 5 N")).toBe("= 50.00 W");
		expect(shown("10 Hz * 5 m")).toBe("= 50.00 m/s");
		expect(shown("9.81 m/s^2 * 3 s * 2 s")).toBe("= 58.86 m");
	});

	test("a speed from an acceleration in feet keeps the feet", () => {
		expect(shown("3 ft/s^2 * 2 s")).toBe("= 6.00 ft/s");
		expect(shown("2 s * 3 ft/s^2")).toBe("= 6.00 ft/s");
		expect(shown("2 kg * 3 ft/s^2")).toBe("= 1.83 N");
	});
});

describe("the results convert", () => {
	test.each([
		["9.81 m/s^2 * 3 s in mph", "= 65.83 mph"],
		["3 ft/s^2 * 2 s in m/s", "= 1.83 m/s"],
		["100 km/h / 10 s in ft/s^2", "= 9.11 ft/s²"],
		["(100 km/h / 10 s) in ft/s^2", "= 9.11 ft/s²"],
		["100 km/h / 10 s in km/h^2", "= 36,000.00 km/h²"],
		["9.81 m/s^2 in ft/s^2", "= 32.19 ft/s²"],
		["9.81 m/s^2 in ft/s²", "= 32.19 ft/s²"],
		["9.81 m/s^2 in ft/s^2 in m/s^2", "= 9.81 m/s²"],
		["100 W / 20 V in mA", "= 5,000.00 mA"],
		["10 Hz in /s", "= 10.00 /s"],
		["10 Hz in /min", "= 600.00 /min"],
		["600 /min in Hz", "= 10.00 Hz"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("accelerations in two units add and compare", () => {
		expect(shown("9.81 m/s^2 + 1 ft/s^2")).toBe("= 10.11 m/s²");
		expect(shown("9.81 m/s^2 - 1 ft/s^2")).toBe("= 9.51 m/s²");
		expect(shown("9.81 m/s^2 / 3.2 ft/s^2")).toBe("= 10.06");
	});
});

describe("what stays as it was", () => {
	test("money over time is still a rate", () => {
		expect(shown("$20/hour * 8 hours")).toBe("= $160.00");
		expect(code("$100/h / 2 h")).toBe("UNIT_QUOTIENT_UNSUPPORTED");
	});

	test("two plain quantities keep the reader's units", () => {
		expect(shown("10 m / 2 s")).toBe("= 5.00 m/s");
		expect(shown("120 mi / 60 mph")).toBe("= 2.00 h");
		expect(shown("(60 km/h) / 2 km")).toBe("= 30.00 /h");
		expect(shown("20 N / 2 kg")).toBe("= 10.00 N/kg");
		expect(shown("60 km/h * 2 h")).toBe("= 120.00 km");
	});

	test("a product with no name is still refused", () => {
		expect(code("100 kg * 10 m/s")).toBe("RATE_MUL_MEASURE_MISMATCH");
		expect(code("9.81 m/s^2 * 3 m")).toBe("INCOMPATIBLE_UNITS");
		expect(code("9.81 m/s^2 / 2 s")).toBe("UNIT_QUOTIENT_UNSUPPORTED");
	});
});

describe("the explanation names each product", () => {
	test.each([
		["9.81 m/s^2 * 3 s", "9.81 m/s^2 times 3 s", "m/s"],
		["100 km/h / 10 s", "100 km/h divided by 10 s", "mps2"],
		["10 Hz * 2 s", "10 Hz times 2 s", undefined],
		["100 W / 20 V", "100 W divided by 20 V", "A"],
	])("%s", (line, description, unit) => {
		const explanation = newTrackedEngine().explainLine(line);
		expect(explanation.steps.map((s) => s.description)).toEqual([description]);
		expect(explanation.result?.unit).toBe(unit);
	});
});

describe("dimensionOf", () => {
	test("a single unit is read by its measure", () => {
		expect(dimensionOf("mph")?.dim).toEqual([0, 1, -1, 0]);
		expect(dimensionOf("kHz")).toEqual({ dim: [0, 0, -1, 0], si: 1000 });
		expect(dimensionOf("mA")).toEqual({ dim: [0, 0, 0, 1], si: 0.001 });
		expect(dimensionOf("mps2")).toEqual({ dim: [0, 1, -2, 0], si: 1 });
	});

	test("a unit with a slash has the dimension of its halves", () => {
		expect(dimensionOf("km/h")?.dim).toEqual([0, 1, -1, 0]);
		expect(dimensionOf("km/h")?.si).toBeCloseTo(1000 / 3600, 12);
		expect(dimensionOf("ft/s²")).toEqual({ dim: [0, 1, -2, 0], si: 0.3048 });
		expect(dimensionOf("/s")).toEqual({ dim: [0, 0, -1, 0], si: 1 });
		expect(dimensionOf("kg/m³")?.dim).toEqual([1, -3, 0, 0]);
	});

	test("what takes no part is null", () => {
		for (const unit of ["USD/h", "bottles/week", "", "/", "a/b/c", "km/h/s", "cd/m2", "kg/", "s²", "m/s⁴"]) {
			expect({ unit, dim: dimensionOf(unit) }).toEqual({ unit, dim: null });
		}
	});

	test("a word naming an inherited property is not found", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const unit of [word, `${word}/s`, `m/${word}`, `m/${word}²`, `/${word}`]) {
					expect({ unit, dim: dimensionOf(unit) }).toEqual({ unit, dim: null });
				}
			}
		});
	});
});

describe("tryDimensionalCompose", () => {
	test("a kinematic side names a speed, an acceleration, a time, a mass or a count", () => {
		expect(tryDimensionalCompose(uomValue(2, "mps2"), uomValue(3, "s"), true)).toMatchObject({ type: ValueType.Uom, value: 6, unit: "m/s" });
		expect(tryDimensionalCompose(uomValue(20, "m/s"), uomValue(10, "s"), false)).toMatchObject({ value: 2, unit: "mps2" });
		expect(tryDimensionalCompose(uomValue(6, "m/s"), uomValue(2, "mps2"), false)).toMatchObject({ value: 3, unit: "s" });
		expect(tryDimensionalCompose(uomValue(20, "N"), uomValue(2, "mps2"), false)).toMatchObject({ value: 10, unit: "kg" });
		expect(tryDimensionalCompose(uomValue(10, "Hz"), uomValue(2, "s"), true)).toMatchObject({ type: ValueType.Number, value: 20 });
	});

	test("the ampere is named from any power over any voltage", () => {
		expect(tryDimensionalCompose(uomValue(1, "kW"), uomValue(10, "V"), false)).toMatchObject({ value: 100, unit: "A" });
	});

	test("two plain quantities do not become a speed, a time or a mass", () => {
		expect(tryDimensionalCompose(uomValue(10, "m"), uomValue(2, "s"), false)).toBeNull();
		expect(tryDimensionalCompose(uomValue(120, "mi"), uomValue(60, "mph"), false)).toBeNull();
		expect(tryDimensionalCompose(uomValue(20, "N"), uomValue(2, "kg"), false)).toBeNull();
		expect(tryDimensionalCompose(uomValue(10, "kg"), uomValue(2, "m"), true)).toBeNull();
	});

	test("an operand that is not a quantity, or has no dimension, gives null", () => {
		expect(tryDimensionalCompose(numberValue(3), uomValue(2, "s"), true)).toBeNull();
		expect(tryDimensionalCompose(uomValue(3, "USD/h"), uomValue(2, "s"), true)).toBeNull();
		expect(tryDimensionalCompose(uomValue(3, "constructor"), uomValue(2, "s"), true)).toBeNull();
	});

	test("the quotients with no finite answer follow the rest of the engine", () => {
		// `100 J / 0 s` has long been Infinity W, and `0 m / 0 s` NaN.
		expect(tryDimensionalCompose(uomValue(100, "km/h"), uomValue(0, "s"), false)?.toNumber()).toBe(Infinity);
		expect(tryDimensionalCompose(uomValue(0, "km/h"), uomValue(0, "s"), false)?.toNumber()).toBeNaN();
	});
});

describe("accelerationSize", () => {
	test("a length over a squared time is an acceleration", () => {
		expect(accelerationSize("mps2")).toBe(1);
		expect(accelerationSize("ft/s²")).toBeCloseTo(0.3048, 12);
		expect(accelerationSize("km/h²")).toBeCloseTo(1000 / 3600 ** 2, 15);
	});

	test("anything else is not", () => {
		for (const unit of ["m/s", "m/s^2", "ft/s³", "kg/s²", "s²", "/s²", "m/s²/s", "", "m/s2", "m²/s²"]) {
			expect({ unit, size: accelerationSize(unit) }).toEqual({ unit, size: undefined });
		}
		for (const word of PROTOTYPE_WORDS) expect(accelerationSize(`${word}/s²`)).toBeUndefined();
	});
});

describe("convertRate reads a frequency and an acceleration", () => {
	test("a frequency is a count per second", () => {
		expect(convertRate(10, "Hz", "/s")).toBe(10);
		expect(convertRate(10, "Hz", "/min")).toBeCloseTo(600, 9);
		expect(convertRate(600, "/min", "Hz")).toBeCloseTo(10, 9);
		expect(convertRate(1, "kHz", "/s")).toBe(1000);
	});

	test("two accelerations convert, and an acceleration and a speed do not", () => {
		expect(convertRate(9.81, "mps2", "ft/s²")).toBeCloseTo(9.81 / 0.3048, 9);
		expect(convertRate(1, "ft/s²", "mps2")).toBeCloseTo(0.3048, 12);
		expect(convertRate(9.81, "mps2", "m/s")).toBeNull();
		expect(convertRate(9.81, "m/s", "mps2")).toBeNull();
		expect(convertRate(10, "Hz", "km/h")).toBeNull();
	});
});

describe("an acceleration is named in words", () => {
	test("describeMeasure and unitForMessage", () => {
		expect(describeMeasure("ft/s²")).toBe("acceleration");
		expect(describeMeasure("mps2")).toBe("acceleration");
		expect(unitForMessage("mps2")).toBe("m/s²");
		expect(unitForMessage("kg/mps2")).toBe("kg/m/s²");
		expect(unitForMessage("km/h")).toBe("km/h");
		expect(unitForMessage("")).toBe("");
	});

	test("unifyUom lines up two accelerations", () => {
		const { rv, sameMeasure, unit } = unifyUom(uomValue(1, "mps2"), uomValue(1, "ft/s²"));
		expect(sameMeasure).toBe(true);
		expect(unit).toBe("mps2");
		expect(rv).toBeCloseTo(0.3048, 12);
	});

	test.each([
		"9.81 m/s^2 in km/h",
		"5 kg / 2 m/s^2",
		"$5 / 2 m/s^2",
		"2 / (9.81 m/s^2)",
		"(9.81 m/s^2)^2",
		"sqrt(9.81 m/s^2)",
		"9.81 m/s^2 / 2 kg",
	])("no refusal names mps2: %s", (line) => {
		const outcome = expectHonestLine(line);
		expect(outcome.kind).toBe("error");
	});
});

describe("adversarial: security", () => {
	test.each(fill("5 X/s^2", PROTOTYPE_WORDS).concat(fill("5 m/X^2", PROTOTYPE_WORDS), fill("10 Hz in /X", PROTOTYPE_WORDS), fill("9.81 m/s^2 * 3 X", PROTOTYPE_WORDS)))(
		"%s",
		(line) => {
			expectPrototypeUntouched(() => {
				expectHonestLine(line);
			});
		},
	);

	test("a long chain of accelerations and times stays within its budget", () => {
		const chain = Array.from({ length: 500 }, () => "1 s").join(" * ");
		expectHonestLine(`9.81 m/s^2 * ${chain}`, { budgetMs: 2_000 });
		expectHonestLine(`${RESOURCE_PROBES.longSum(200)} m/s^2 * 3 s`);
	});

	test("look-alike and markup-shaped text is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`9.81 m/s^2 * 3 s ${edge}`);
		expectHonestLine("9.81 m/s^2 * 3 s <script>");
		expectHonestLine("9.81 m​/s^2 * 3 s");
		expectHonestLine("١٠ Hz * 2 s");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check over it, and both document passes", () => {
		const { batch } = expectHonestDocument("g = 9.81 m/s^2\nt = 3 s\nv = g * t\nv in mph\ncheck v == 29.43 m/s\np = 100 W\np / 20 V");
		expect(batch).toEqual(["= 9.81 m/s²", "= 3.00 s", "= 29.43 m/s", "= 65.83 mph", "= ✓", "= 100.00 W", "= 5.00 A"]);
	});

	test("a unit that does not fit is refused by name", () => {
		expect(code("9.81 m/s^2 * 3 s in kg")).toBe("INCOMPATIBLE_UNITS");
		expect(code("100 W / 20 V in V")).toBe("INCOMPATIBLE_UNITS");
		expect(code("9.81 m/s^2 in ft/s")).toBe("INCOMPATIBLE_UNITS");
	});

	test("a typo in the unit is still a misspelling", () => {
		expect(code("9.81 m/s^2 * 3 s in mhp")).toBe("UNKNOWN_UNIT");
	});
});

describe("adversarial: edge cases", () => {
	test.each([...fill("X m/s^2 * 3 s", NUMERIC_EDGES), ...fill("100 km/h / X s", NUMERIC_EDGES), ...fill("X Hz * 2 s", NUMERIC_EDGES), ...fill("X W / 20 V", NUMERIC_EDGES)])(
		"%s",
		(line) => {
			expectHonestLine(line, { allowNaN: line.includes("0/0") || /\/ \(?-?0(\.0)?\)? s$/.test(line) });
		},
	);

	test("zero, a negative and a divide by zero", () => {
		expect(shown("0 m/s^2 * 3 s")).toBe("= 0.00 m/s");
		expect(shown("-9.81 m/s^2 * 3 s")).toBe("= -29.43 m/s");
		expect(shown("100 km/h / 0 s")).toBe(shown("100 J / 0 s").replace("W", "m/s²"));
	});
});
