import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { unifyUom } from "@solve-js/vm/VMConversion";
import { numberValue, uomValue } from "@solve-js/vm/Value";

/**
 * Found bug: `10 m/s + 36 km/h` was refused as "incompatible units", though
 * `36 km/h in m/s` converts. A speed, like a density or a price per kilogram,
 * has no single measure in the unit tables, and adding, comparing and totalling
 * read two quantities together only when their units shared one (or were two
 * accelerations or two currencies).
 *
 * `unifyUom`, the reader behind all three, now also reads the right side in the
 * left's unit whenever the rate conversion `in` uses converts it, so the sum,
 * the difference, a comparison and a total agree with the conversion. Two rates
 * that do not convert (a speed and a mass flow) are refused as before.
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
		["10 m/s + 36 km/h", "20.00 m/s"],
		["10 km/h + 5 mph", "18.05 km/h"],
		["10 m/s - 36 km/h", "0.00 m/s"],
		["10 m/s > 30 km/h", "true"],
		["10 m/s == 36 km/h", "true"],
		["total of 10 m/s, 36 km/h", "20.00 m/s"],
		["1 g/cm^3 + 1000 kg/m^3", "2.00 g/cm³"],
		["60 mph + 96.56064 km/h", "120.00 mph"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("two rates that do not convert stay apart", () => {
		expect(shown("10 m/s + 5 kg/s")).toBe("Cannot combine incompatible units: m/s and kg/s");
		expect(shown("10 m/s + 3 m")).toBe("Cannot combine incompatible units: m/s and m");
		expect(shown("5 m + 3 kg")).toBe("length and mass cannot be added");
	});

	test("two prices in two currencies are not converted here at a rate", () => {
		expect(shown("$5/h + €3/h")).toBe("Cannot combine incompatible units: USD/h and EUR/h");
	});
});

describe("unifyUom, the part that refused the pair", () => {
	test("two speeds are one quantity in the left's unit", () => {
		const out = unifyUom(uomValue(10, "m/s"), uomValue(36, "km/h"));
		expect(out.sameMeasure).toBe(true);
		expect(out.unit).toBe("m/s");
		expect(out.rv).toBeCloseTo(10, 12);
	});

	test("the ordinary pairs are unchanged", () => {
		expect(unifyUom(uomValue(1, "km"), uomValue(500, "m"))).toEqual({ lv: 1, rv: 0.5, unit: "km", sameMeasure: true });
		expect(unifyUom(uomValue(1, "km"), numberValue(3)).sameMeasure).toBe(true);
		expect(unifyUom(uomValue(1, "kg"), uomValue(1, "m")).sameMeasure).toBe(false);
	});

	test("boundary and hostile units", () => {
		expect(unifyUom(uomValue(0, "m/s"), uomValue(-0, "km/h")).rv).toBe(-0);
		expect(unifyUom(uomValue(1, "m/s"), uomValue(Infinity, "km/h")).rv).toBe(Infinity);
		for (const word of PROTOTYPE_WORDS) {
			expect(unifyUom(uomValue(1, "m/s"), uomValue(1, `${word}/h`)).sameMeasure).toBe(false);
			expect(unifyUom(uomValue(1, word), uomValue(1, "km/h")).sameMeasure).toBe(false);
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words as a rate's halves, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`10 m/s + 36 ${word}/h`);
				expectHonestLine(`10 ${word}/s + 36 km/h`);
			}
		});
	});

	test("security: a long sum of speeds stays within its budget, and markup is text", () => {
		expectHonestLine(Array.from({ length: 2_000 }, (_, i) => `${i} km/h`).join(" + "), { budgetMs: 5_000 });
		for (const line of fill("10 m/s + 36 km/h X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: speeds from lines above, a total and a check, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("walk = 5 km/h\nrun = 3 m/s\nwalk + run\ntotal above\ncheck run > walk");
		expect(batch[2]).toBe("= 15.80 km/h");
		expect(batch[4]).toBe("= ✓");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as the second speed", () => {
		for (const line of fill("10 m/s + X km/h", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
