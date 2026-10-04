/**
 * A refusal names a measure the way a reader would (#571).
 *
 * The unit tables key every two-word measure as one camelCase token
 * (`fuelEconomy`, `dataRate`, `cssLength`), and the refusal sentences dropped the
 * key in as it was: `2 mpg * 3 m` answered "fuelEconomy and length cannot be
 * multiplied". Every measure now has a reader's name, and this pins that no
 * refusal, across every measure the engine has, contains a camelCase key.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import { describeMeasure } from "@solve-js/vm/VMConversion";
import { MEASURE_KIND_NAMES } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";

/** Every measure the engine knows, from both unit tables. */
const MEASURES: readonly string[] = [
	...new Set([...Object.values(MEASURE_KIND_NAMES), ...Object.values(EXTENDED_UNITS).map((unit) => unit.measure)]),
];

/** The measure keys written as one camelCase word, which no sentence may contain. */
const CAMEL_CASE_KEYS = MEASURES.filter((measure) => /[a-z][A-Z]/.test(measure));

/**
 * A unit a reader can type for each measure. A measure added later without an
 * entry here fails the coverage test below, so the pin cannot quietly go stale.
 */
const REPRESENTATIVE: Readonly<Record<string, string>> = {
	angle: "rad", area: "m2", data: "MB", energy: "kWh", force: "N", frequency: "Hz",
	illuminance: "lux", length: "m", luminance: "nit", luminousIntensity: "cd", mass: "kg",
	power: "kW", pressure: "Pa", temperature: "C", time: "s", volume: "L",
	speed: "mph", pace: "min_km", dataRate: "Mbps", cssLength: "px", voltage: "V", current: "A",
	apparentPower: "VA", reactivePower: "kvar", reactiveEnergy: "varh", volumeFlowRate: "lpm",
	fuelEconomy: "mpg", fuelConsumption: "l100km", partsPer: "ppm",
	// The measures #706 added.
	resistance: "ohm", charge: "Ah", amountOfSubstance: "mol",
};

/** The message a line refuses with, whether it throws or answers an error value. */
function refusal(source: string): string | undefined {
	try {
		const value = newTrackedEngine().evaluateLine(1, source);
		return value.type === ValueType.Error ? value.errorMessage : undefined;
	} catch (error) {
		return (error as Error).message;
	}
}

describe("every measure has a reader's name", () => {
	test("the camelCase keys exist, so this pin has something to hold", () => {
		expect(CAMEL_CASE_KEYS).toEqual(expect.arrayContaining(["fuelEconomy", "dataRate", "cssLength", "partsPer"]));
	});

	test("every measure has a representative unit here", () => {
		expect(MEASURES.filter((measure) => REPRESENTATIVE[measure] === undefined)).toEqual([]);
	});

	test.each(MEASURES)("%s is named in words", (measure) => {
		const name = describeMeasure(REPRESENTATIVE[measure]);
		expect(name).toBeDefined();
		expect(name).not.toMatch(/[a-z][A-Z]/);
	});

	test("the two-word measures read as their words", () => {
		expect(describeMeasure("mpg")).toBe("fuel economy");
		expect(describeMeasure("l100km")).toBe("fuel consumption");
		expect(describeMeasure("Mbps")).toBe("data rate");
		expect(describeMeasure("px")).toBe("CSS length");
		expect(describeMeasure("lpm")).toBe("volume flow rate");
		expect(describeMeasure("ppm")).toBe("proportion");
		expect(describeMeasure("VA")).toBe("apparent power");
		expect(describeMeasure("cd")).toBe("luminous intensity");
		expect(describeMeasure("s")).toBe("duration");
		expect(describeMeasure("mol")).toBe("amount of substance");
		expect(describeMeasure("mAh")).toBe("charge");
		expect(describeMeasure("\u03A9")).toBe("resistance");
	});
});

describe("no refusal contains a camelCase measure key", () => {
	const partners = ["m", "kg"];
	const cases: string[] = [];
	for (const measure of MEASURES) {
		const unit = REPRESENTATIVE[measure];
		cases.push(`2 ${unit} * 3 ${unit}`);
		for (const partner of partners) {
			cases.push(`2 ${unit} + 3 ${partner}`, `2 ${unit} * 3 ${partner}`, `2 ${unit} in ${partner}`, `2 ${partner} in ${unit}`);
		}
	}

	test("the sweep produces refusals to check", () => {
		const refused = cases.map(refusal).filter((message) => message !== undefined);
		expect(refused.length).toBeGreaterThan(cases.length / 2);
	});

	test.each(cases)("%s", (source) => {
		const message = refusal(source);
		if (message === undefined) return;
		for (const key of CAMEL_CASE_KEYS) expect(message).not.toContain(key);
	});

	test("the sentences read as English", () => {
		expect(refusal("2 mpg * 3 m")).toBe("fuel economy and length cannot be multiplied");
		expect(refusal("2 Mbps + 3 kg")).toBe("data rate and mass cannot be added");
		expect(refusal("2 px in m")).toBe("a CSS length cannot be converted to a length");
		expect(refusal("2 l100km in kg")).toBe("fuel consumption cannot be converted to a mass");
		expect(refusal("2 mpg * 3 mpg")).toMatch(/fuel economy times fuel economy is not a unit/);
	});
});
