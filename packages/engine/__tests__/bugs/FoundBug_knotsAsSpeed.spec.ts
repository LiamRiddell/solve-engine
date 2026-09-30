import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { rateForm } from "@solve-js/uom/RateForms";
import { getMeasure } from "@solve-js/uom/UomConverter";

/**
 * Found bug: `5 mph + 3 knots` was not read as two speeds. The unit table knew
 * the knot only by its code, `kn`, so the word a sailor or a pilot writes was no
 * unit at all. `knot` and `knots` are now speeds in the unit table's ordinary
 * path, one nautical mile (1852 m) per hour, beside `kn`, with the rate form
 * `nmi/h` that `kn` has, so they convert, add, and cancel against a time as
 * every other speed does. `kt` is left out on purpose: the table already reads
 * it as a kilotonne, and a mass that silently became a speed would be worse
 * than the spelling left out.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["5 mph + 3 knots", "8.45 mph"],
		["3 knots in km/h", "5.56 km/h"],
		["1 knot in m/s", "0.51 m/s"],
		["1 knot in kn", "1.00 kn"],
		["20 knots in mph", "23.02 mph"],
		["10 knots * 2 hours", "20.00 nmi"],
		["1 knot == 1 kn", "true"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("kt stays the kilotonne it was", () => {
		expect(shown("1 kt in kg")).toBe("1,000,000.00 kg");
	});
});

describe("the table entries", () => {
	test("a knot is one nautical mile an hour, exactly as kn is", () => {
		expect(EXTENDED_UNITS.knot).toEqual({ measure: "speed", toBase: 1852 / 3600 });
		expect(EXTENDED_UNITS.knots).toEqual(EXTENDED_UNITS.kn);
		expect(rateForm("knot")).toEqual(rateForm("kn"));
		expect(rateForm("knots")).toEqual({ numerator: "nmi", denominator: "h", scale: 1 });
	});

	test("the measure is speed, and a spelling only near it is no unit", () => {
		expect(getMeasure("knot")).toBe("speed");
		expect(getMeasure("knots")).toBe("speed");
		expect(getMeasure("Knots")).toBeUndefined();
		expect(getMeasure("knotss")).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) expect(getMeasure(word)).toBeUndefined();
	});

	test("a knot is a speed and not a length, and zero and negative knots convert", () => {
		expect(shown("1 knot in m")).toMatch(/^(ERROR|THROWS) /);
		expect(shown("0 knots in mph")).toBe("0.00 mph");
		expect(shown("-2 knots in kn")).toBe("-2.00 kn");
	});
});

describe("adversarial", () => {
	test("security: prototype words beside a knot, markup after one, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`5 knots in ${word}`);
				expectHonestLine(`5 ${word} + 3 knots`);
			}
		});
		for (const line of fill("3 knots X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(Array.from({ length: 1_000 }, (_, i) => `${i} knots`).join(" + "), { budgetMs: 5_000 });
	});

	test("realistic: a speed from the line above, a check, a total, and a unit that does not fit", () => {
		const { batch, incremental } = expectHonestDocument("wind = 12 knots\nwind in km/h\ncheck wind > 10 mph\nwind + 5 kg");
		expect(batch.slice(0, 3)).toEqual(["= 12.00 knots", "= 22.22 km/h", "= ✓"]);
		expect(batch[3]).toMatch(/^ERROR /);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as a number of knots", () => {
		for (const line of fill("X knots in m/s", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("5 mph + X knots", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
