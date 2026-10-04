import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { poweredRateUnit } from "@solve-js/uom/UnitPowers";

/**
 * Found bug: `in kg/m^3` and `in mm^2` as conversion targets lost the power, so
 * the answer was read in kg/m or mm. Already fixed on the current engine by
 * #834, which reads a power on a conversion target as the target's own
 * (`parser/UnitPower.ts`) and a power after a slash as the unit after it
 * (`uom/UnitPowers.ts`). Rechecked here, with the forms #834's own spec does
 * not cover, so a regression in either reader shows under this name.
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
		["1000 kg/m^3 in kg/m^3", "1,000.00 kg/m³"],
		["1 g/cm^3 in kg/m^3", "1,000.00 kg/m³"],
		["1 m^2 in mm^2", "1,000,000.00 mm²"],
		["5 m2 in mm^2", "5,000,000.00 mm²"],
		["2 ft^3 in m^3", "0.06 m³"],
		["1 km^2 in m^2", "1,000,000.00 m²"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("a power the target cannot take is refused by name", () => {
		expect(shown("1 m^2 in mm^4")).toMatch(/^THROWS "mm\^4" is not a unit/);
		expect(shown("1 m^2 in kg^2")).toMatch(/^THROWS "kg\^2" is not a unit/);
	});
});

describe("poweredRateUnit, the part that reads the power after a slash", () => {
	test("ordinary, boundary and hostile arguments", () => {
		expect(poweredRateUnit("kg/m", 3)).toBe("kg/m³");
		expect(poweredRateUnit("ft/s", 2)).toBe("ft/s²");
		expect(poweredRateUnit("kg/s", 2)).toBeUndefined();
		expect(poweredRateUnit("kg/m", 4)).toBeUndefined();
		expect(poweredRateUnit("kg/m", 0)).toBeUndefined();
		expect(poweredRateUnit("kg/m", Number.NaN)).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) expect(poweredRateUnit(`kg/${word}`, 3)).toBeUndefined();
	});
});

describe("adversarial", () => {
	test("security: prototype words as the target, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`1 m^2 in ${word}^2`);
				expectHonestLine(`1 kg/m^3 in kg/${word}^3`);
			}
		});
	});

	test("security: a huge power and markup-shaped text after the target", () => {
		expectHonestLine("1 m^2 in mm^(10^9)");
		for (const line of fill("1 m^2 in mm^2 X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: the quantity from the line above, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("area = 12 m^2\narea in mm^2\narea in ft^2");
		expect(batch[1]).toBe("= 12,000,000.00 mm²");
		expect(incremental).toEqual(batch);
	});

	test("edge: numeric edges as the amount", () => {
		for (const line of fill("X m^2 in mm^2", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
