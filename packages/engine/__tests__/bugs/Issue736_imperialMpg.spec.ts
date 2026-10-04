import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EXTENDED_UNITS, IMPERIAL_MPG_SPELLINGS, MILES_PER_IMPERIAL_GALLON_IN_KM_PER_LITRE } from "@solve-js/uom/ExtendedUnits";
import { canConvert, convertRate, convertUnit, getMeasure, isConvertibleUnit } from "@solve-js/uom/UomConverter";
import { isNamedRate, rateForm } from "@solve-js/uom/RateForms";
import { litresForTrip, litresPer100Km } from "@solve-js/packages/travel/TripCost";

/**
 * Issue #736: a UK brochure quotes miles per imperial gallon, and `mpg` is
 * miles per US gallon. There was no way to say the other one: `35 mpg imperial`
 * was taken by the cooking form as an ingredient called "imperial", and the trip
 * recipe read its UK figure in US gallons, understating the fuel by about 17%.
 * `mpg imperial`, `imperial mpg`, `mpg uk`, `mpg UK` and `UK mpg` are now miles
 * per imperial gallon, converting both ways like `mpg`, and a bare `mpg` stays
 * the US gallon.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("miles per imperial gallon, under each spelling", () => {
	test.each(IMPERIAL_MPG_SPELLINGS.map((spelling) => [spelling]))("35 %s in l/100km is 8.07 l/100km", (spelling) => {
		expect(show(`35 ${spelling} in l/100km`)).toBe("8.07 l/100km");
	});

	test.each([
		["35 mpg imperial", "35.00 mpg imperial"],
		["35 mpg imperial in mpg", "29.14 mpg"],
		["35 mpg imperial in km/l", "12.39 km/l"],
		["8.07 l/100km in mpg imperial", "35.00 mpg imperial"],
		["40 mpg in mpg imperial", "48.04 mpg imperial"],
		["50 mpg uk in mpg", "41.63 mpg"],
		["35 mpg imperial in mpg uk", "35.00 mpg uk"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("agrees with miles over an imperial gallon written out", () => {
		expect(show("50 mpg imperial in l/100km")).toBe(show("50 miles / 1 imperial gallon in l/100km"));
		expect(show("50 mpg imperial in mpg")).toBe(show("50 miles / 1 imperial gallon in mpg"));
	});
});

describe("the travel forms read it as imperial", () => {
	test.each([
		["fuel for 300 miles at 35 mpg imperial", "38.97 litre"],
		["fuel for 300 miles at 35 mpg", "32.45 litre"],
		["fuel for 300 miles at 35 UK mpg", "38.97 litre"],
		["cost to drive 300 miles at 35 mpg imperial at £1.50/litre", "£58.45"],
		["cost to drive 300 miles at 35 mpg at £1.50/litre", "£48.67"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("unit algebra cancels it against the gallon it is per", () => {
		expect(show("35 mpg imperial * 2 imperial gallons")).toBe("70.00 mi");
		expect(show("300 miles / 35 mpg imperial")).toBe("8.57 imperial gallons");
	});
});

describe("what it must not break", () => {
	test.each([
		["35 mpg in l/100km", "6.72 l/100km"],
		["6 l/100km in mpg", "39.20 mpg"],
		["30 mpg in km/l", "12.75 km/l"],
		["2 cups flour in grams", "250.78 grams"],
		["300g butter in cups", "1.32 cups"],
		["1 imperial gallon in litres", "4.55 litres"],
	])("%s is still %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a word after mpg that is no spelling still reaches the cooking form, which refuses it", () => {
		expect(show("35 mpg foo in l/100km")).toBe('"mpg" is not a recognized mass or volume unit');
	});

	test("imperial, uk and UK stay names", () => {
		expect(doc("uk = 3\nuk * 2")).toEqual(["3", "6"]);
		expect(doc("UK = 4\nUK + 1")).toEqual(["4", "5"]);
	});
});

describe("the parts", () => {
	test("one mile per imperial gallon, in km/l, is the exact ratio", () => {
		expect(MILES_PER_IMPERIAL_GALLON_IN_KM_PER_LITRE).toBe(1.609344 / 4.54609);
		for (const spelling of IMPERIAL_MPG_SPELLINGS) {
			expect(EXTENDED_UNITS[spelling]).toEqual({ measure: "fuelEconomy", toBase: MILES_PER_IMPERIAL_GALLON_IN_KM_PER_LITRE });
			expect(getMeasure(spelling)).toBe("fuelEconomy");
			expect(isConvertibleUnit(spelling)).toBe(true);
		}
	});

	test("every spelling is two words, with mpg one of them", () => {
		for (const spelling of IMPERIAL_MPG_SPELLINGS) {
			const words = spelling.split(" ");
			expect(words).toHaveLength(2);
			expect(words).toContain("mpg");
		}
	});

	test("the imperial figure is about a fifth more than the US one", () => {
		expect(convertUnit(1, "mpg imperial", "mpg")).toBeCloseTo(3.785411784 / 4.54609, 12);
		expect(canConvert("mpg imperial", "mpg")).toBe(true);
		expect(canConvert("mpg imperial", "l100km")).toBe(false);
	});

	test("convertRate turns it over into consumption, and back", () => {
		expect(convertRate(35, "mpg imperial", "l100km")).toBeCloseTo(8.0709, 4);
		expect(convertRate(8.0709, "l100km", "mpg imperial")).toBeCloseTo(35, 3);
		expect(convertRate(0, "mpg imperial", "l100km")).toBeNull();
	});

	test("rateForm spells it as miles over the imperial gallon", () => {
		for (const spelling of IMPERIAL_MPG_SPELLINGS) {
			expect(rateForm(spelling)).toEqual({ numerator: "mi", denominator: "imperial gallon", scale: 1 });
			expect(isNamedRate(spelling)).toBe(true);
		}
		expect(rateForm("mpg")).toEqual({ numerator: "mi", denominator: "gal", scale: 1 });
	});

	test("rateForm and isNamedRate do not read an inherited property as a rate", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(rateForm(word)).toBeNull();
			expect(isNamedRate(word)).toBe(false);
			expect(convertRate(1, word, "l100km")).toBeNull();
		}
	});

	test("the trip arithmetic reads the imperial gallon", () => {
		expect(litresPer100Km(35, "mpg imperial")).toBeCloseTo(8.0709, 4);
		expect(litresForTrip(300, "mi", 35, "mpg imperial")).toBeCloseTo(38.97, 2);
		expect(litresForTrip(300, "mi", 35, "mpg")).toBeCloseTo(32.45, 2);
		expect(litresForTrip(300, "mi", 0, "mpg imperial")).toBeNull();
		expect(litresForTrip(300, "mi", -35, "mpg uk")).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: a prototype word after mpg is an unknown word", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`35 mpg ${word} in l/100km`);
				expectHonestLine(`8 l/100km in mpg ${word}`);
				expectHonestLine(`fuel for 300 miles at 35 mpg ${word}`);
			}
		});
	});

	test("security: text edges around the spelling stay honest", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`${edge} mpg imperial in l/100km`);
		expectHonestLine("35 mpg <b>imperial</b> in l/100km");
		expectHonestLine(Array.from({ length: 2_000 }, () => "1 mpg imperial").join(" + "), { budgetMs: 5_000 });
	});

	test("realistic: the recipe's economy named at the top, and a what-if through it", () => {
		expect(doc(":economy = 35 mpg imperial\ncost to drive 300 miles at economy at £1.50/litre")).toEqual(["35.00 mpg imperial", "£58.45"]);
		expectHonestDocument(":economy = 35 mpg imperial\nfuel for 300 miles at economy\nline 2 with economy = 40 mpg imperial");
		expectHonestDocument(":economy = 35 mpg uk\neconomy in l/100km\ncheck economy in l/100km > 8 l/100km");
	});

	test("realistic: a typo is refused, not read as the US gallon", () => {
		expect(show("35 mpg imperail in l/100km")).not.toMatch(/l\/100km$/);
		expect(show("35 Mpg imperial in l/100km")).toMatch(/^THROWS/);
	});

	test("edge: the numeric edges before the spelling stay honest", () => {
		for (const line of fill("X mpg imperial in l/100km", NUMERIC_EDGES)) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
		for (const line of fill("fuel for 300 miles at X mpg imperial", NUMERIC_EDGES)) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
	});

	test("edge: zero and a negative economy have no trip", () => {
		expect(show("fuel for 300 miles at 0 mpg imperial")).toMatch(/not an economy a trip can be worked out from/);
		expect(show("fuel for 300 miles at -35 mpg imperial")).toMatch(/not an economy a trip can be worked out from/);
	});
});
