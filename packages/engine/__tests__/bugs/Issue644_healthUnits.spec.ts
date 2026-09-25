import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, numberValue, uomValue, stringValue, errorValue } from "@solve-js/vm/Value";
import { readHealthInput, WEIGHT, HEIGHT, DISTANCE, DURATION } from "@solve-js/packages/health/HealthUnits";

/**
 * Issue #644: `bmi`, `pace` and `speed` read a quantity's bare magnitude in the
 * unit each function assumes, so 175 cm was read as 175 metres and one hour as
 * one minute: `bmi(70 kg, 175 cm)` was 0.00229 and `speed(10 km, 1 h)` 600
 * km/h. A quantity is converted into the function's unit now, and one that
 * measures something else is refused by name. A negative figure, which no
 * weight, height, distance or time can be, is refused too.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a quantity is converted into the function's unit", () => {
	test.each([
		["bmi(70 kg, 175 cm)", "= 22.86"],
		["bmi(154 lb, 69 in)", "= 22.74"],
		["bmi(70 kg, 1.75 m)", "= 22.86"],
		["bmi(70 kg, 5.74 ft)", "= 22.87"],
		["speed(10 km, 1 h)", "= 10.00 km/h"],
		["speed(10 mi, 1 h)", "= 16.09 km/h"],
		["speed(10 km, 3600 s)", "= 10.00 km/h"],
		["pace(10 mi, 80 min)", "= 4:58 /km"],
		["pace(10 km, 50 min)", "= 5:00 /km"],
		["pace(5 km, 0.5 h)", "= 6:00 /km"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("with units and without, the documented example agrees", () => {
		expect(shown("bmi(70 kg, 175 cm)")).toBe(shown("bmi(70, 1.75)"));
	});
});

describe("a quantity of the wrong measure is refused by name", () => {
	test.each([
		["bmi(175 cm, 70 kg)", "bmi: the weight is a mass, not a length. Give it with a unit (70 kg or 154 lb) or as a plain number of kilograms."],
		["bmi($70, 1.75)", "bmi: the weight is a mass, not money. Give it with a unit (70 kg or 154 lb) or as a plain number of kilograms."],
		["bmi(70 kg, 20 °C)", "bmi: the height is a length, not a temperature. Give it with a unit (175 cm or 69 in) or as a plain number of metres."],
		["speed(10 kg, 1 h)", "speed: the distance is a length, not a mass. Give it with a unit (10 km or 6.2 mi) or as a plain number of kilometres."],
		["pace(10 km, 5 kg)", "pace: the time is a duration, not a mass. Give it with a unit (50 min or 1 h) or as a plain number of minutes."],
	])("%s", (line, message) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.errorCode).toBe("HEALTH_BAD_INPUT");
		expect(formatValue(value)).toBe(message);
	});
});

describe("the boundary: a bare number keeps the documented unit", () => {
	test.each([
		["bmi(70, 1.75)", "= 22.86"],
		["speed(10, 60)", "= 10.00 km/h"],
		["speed(10, 1)", "= 600.00 km/h"],
		["pace(10, 50)", "= 5:00 /km"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a pace from miles still answers per kilometre", () => {
		expect(shown("pace(10 mi, 80 min)")).toMatch(/\/km$/);
	});
});

describe("adversarial", () => {
	test("a zero is refused where it divides, as before, with or without a unit", () => {
		expect(shown("bmi(70 kg, 0 m)")).toBe("bmi(weight in kg, height in m), e.g. bmi(70, 1.75)");
		expect(shown("speed(10 km, 0 h)")).toBe("speed(distance in km, time in min), e.g. speed(10, 50)");
	});

	test("a negative figure is refused, with or without a unit", () => {
		expect(shown("bmi(70 kg, -175 cm)")).toBe("bmi: the height cannot be negative.");
		expect(shown("bmi(70, -1.75)")).toBe("bmi: the height cannot be negative.");
		expect(shown("pace(-10 km, 50 min)")).toBe("pace: the distance cannot be negative.");
	});

	test("every numeric edge as a height is answered honestly", () => {
		for (const line of fill("bmi(70 kg, X m)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("speed(X km, 1 h)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("quantities held in variables, through both passes", () => {
		const { batch } = expectHonestDocument("w = 70 kg\nh = 175 cm\nbmi(w, h)\nd = 10 mi\nt = 1 h\nspeed(d, t)");
		expect(batch).toEqual(["= 70.00 kg", "= 175.00 cm", "= 22.86", "= 10.00 mi", "= 1.00 h", "= 16.09 km/h"]);
	});
});

describe("readHealthInput", () => {
	test("a plain number is taken as it is", () => {
		expect(readHealthInput("bmi", numberValue(70), WEIGHT)).toBe(70);
	});

	test("a quantity of the right measure is converted into the function's unit", () => {
		expect(readHealthInput("bmi", uomValue(175, "cm"), HEIGHT)).toBeCloseTo(1.75, 12);
		expect(readHealthInput("speed", uomValue(1, "h"), DURATION)).toBe(60);
		expect(readHealthInput("speed", uomValue(1000, "m"), DISTANCE)).toBe(1);
	});

	test("a quantity of another measure and a negative figure are refused", () => {
		expect((readHealthInput("bmi", uomValue(70, "m"), WEIGHT) as Value).errorCode).toBe("HEALTH_BAD_INPUT");
		expect((readHealthInput("bmi", numberValue(-1), HEIGHT) as Value).errorCode).toBe("HEALTH_BAD_INPUT");
	});

	test("anything else is null, for the caller's usage message", () => {
		expect(readHealthInput("bmi", undefined, WEIGHT)).toBeNull();
		expect(readHealthInput("bmi", stringValue("70"), WEIGHT)).toBeNull();
		expect(readHealthInput("bmi", errorValue("X", "y"), WEIGHT)).toBeNull();
	});
});
