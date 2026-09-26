import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { isKnownUnit } from "@solve-js/lexer/units";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { tryDimensionalCompose } from "@solve-js/uom/Dimensions";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { canConvert, convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { ValueType, uomValue } from "@solve-js/vm/Value";

/**
 * Issue #706: the units of food energy, heating bills, batteries, engines and gas
 * laws were refused as undefined variables. `2000 kcal in kJ`, `10 Ω`, `3000 mAh`,
 * `20 knots in km/h`, `120 mmHg in kPa`, `12 volts`, `2 L` and `1 mol` each threw
 * "Undefined variable", and `12 V / 2 A` stayed `6.00 V/A`.
 *
 * Each is a unit now. The calories, BTU, therm, electronvolt, astronomical unit
 * and millimetre of mercury extend measures the generated table already has; the
 * ohm, the amp-hour (a charge) and the mole are new measures; `revolution` is an
 * alias of the table's `turn`; and `L` joins the single letters the lexer admits.
 * A voltage over a current is an ohm, a charge is named in amp-hours, and a
 * charge in amp-hours at a voltage is a battery's energy in watt-hours.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `throws: ${(error as Error).message}`;
	}
}

function number(line: string): number {
	const value = newTrackedEngine().evaluateExpression(line);
	expect(value.type).toBe(ValueType.Uom);
	return value.toNumber();
}

/** The message a line refuses with, whether it throws or answers an error value. */
function refusal(line: string): string | undefined {
	try {
		const value = newTrackedEngine().evaluateExpression(line);
		return value.type === ValueType.Error ? value.errorMessage : undefined;
	} catch (error) {
		return (error as Error).message;
	}
}

function tokenTypes(input: string): string[] {
	const lexer = new ExpressionLexer();
	lexer.reset(input);
	return lexer.tokenizeAll().map((token) => token.type);
}

/** Every spelling #706 added. */
const EVERYDAY_SPELLINGS: readonly string[] = [
	"cal", "calorie", "calories", "kcal", "kilocalorie", "kilocalories", "Cal", "Calorie", "Calories",
	"BTU", "Btu", "therm", "therms", "eV", "keV", "MeV", "GeV",
	"ohm", "ohms", "\u03A9", "k\u03A9", "M\u03A9", "\u2126", "k\u2126", "M\u2126",
	"coulomb", "coulombs", "Ah", "mAh", "rpm", "RPM", "revolution", "revolutions",
	"knot", "knots", "AU", "mmHg", "volt", "volts", "amp", "amps", "ampere", "amperes", "L", "mol", "mmol",
];

describe("each form the issue lists", () => {
	// Before, on main at a9d53abb: every line below threw "Undefined variable"
	// except `20 kn in km/h`, `12 V`, `5 A`, `2 A * 12 V` and `2 l in ml`, which
	// are unchanged, and `12 V / 2 A`, which answered 6.00 V/A.
	test.each([
		["2000 kcal in kJ", "= 8,368.00 kJ"],
		["1 calorie in J", "= 4.18 J"],
		["100000 BTU in kWh", "= 29.31 kWh"],
		["1 therm in kWh", "= 29.31 kWh"],
		["1 eV in J", "= 1.6e-19 J"],
		["10 ohm", "= 10.00 ohm"],
		["10 \u03A9", "= 10.00 \u03A9"],
		["3000 mAh", "= 3,000.00 mAh"],
		["3 Ah", "= 3.00 Ah"],
		["3000 rpm", "= 3,000.00 rpm"],
		["1 revolution", "= 1.00 revolution"],
		["20 knots in km/h", "= 37.04 km/h"],
		["20 kn in km/h", "= 37.04 km/h"],
		["1 AU in km", "= 149,597,870.70 km"],
		["120 mmHg in kPa", "= 16.00 kPa"],
		["12 volts", "= 12.00 volts"],
		["5 amps", "= 5.00 amps"],
		["12 V", "= 12.00 V"],
		["5 A", "= 5.00 A"],
		["12 V / 2 A", "= 6.00 \u03A9"],
		["2 A * 12 V", "= 24.00 W"],
		["2 L", "= 2.00 L"],
		["2 l in ml", "= 2,000.00 ml"],
		["1 mol", "= 1.00 mol"],
		["3000 mAh * 3.7 V", "= 11.10 Wh"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("the calorie: the spelling decides the size", () => {
	test("every lower-case spelling is the small calorie, the thermochemical 4.184 J", () => {
		expect(number("1 cal in J")).toBe(4.184);
		expect(number("1 calorie in J")).toBe(4.184);
		expect(number("1 calories in J")).toBe(4.184);
		// Not the International Table calorie of steam tables.
		expect(number("1 cal in J")).not.toBe(4.1868);
	});

	test("kcal, kilocalorie and the capital Cal are the food Calorie, a thousand of them", () => {
		expect(number("1 kcal in J")).toBe(4184);
		for (const spelling of ["kilocalorie", "kilocalories", "Cal", "Calorie", "Calories"]) {
			expect(number(`1 ${spelling} in kcal`)).toBe(1);
		}
		expect(number("1 Cal in cal")).toBe(1000);
	});

	test("so a food label's figure is written kcal or Cal, and lower-case calories is the small unit", () => {
		expect(shown("2000 kcal in kJ")).toBe("= 8,368.00 kJ");
		expect(shown("2000 Calories in kJ")).toBe("= 8,368.00 kJ");
		expect(shown("2000 calories in kJ")).toBe("= 8.37 kJ");
		expect(shown("250 Cal in kJ")).toBe("= 1,046.00 kJ");
		expect(shown("1 kWh in kcal")).toBe("= 860.42 kcal");
		expect(shown("500 kcal + 200 kJ")).toBe("= 547.80 kcal");
	});

	test("the lexer is case-sensitive, so shouted spellings are names", () => {
		expect(shown("2 KCAL")).toBe("throws: Undefined variable: KCAL");
		expect(shown("5 CAL")).toBe("throws: Undefined variable: CAL");
	});
});

describe("the other energy units", () => {
	test("the BTU is the International Table one, in both spellings", () => {
		expect(convertUnit(1, "BTU", "J")).toBe(1055.05585262);
		expect(convertUnit(1, "Btu", "J")).toBe(1055.05585262);
		expect(shown("100000 Btu in kWh")).toBe("= 29.31 kWh");
	});

	test("a therm is 100,000 of those BTU", () => {
		expect(number("1 therm in BTU")).toBeCloseTo(100_000, 6);
		expect(shown("45 therms in kWh")).toBe("= 1,318.82 kWh");
	});

	test("the electronvolt is exact, and its prefixes step by a thousand", () => {
		expect(convertUnit(1, "eV", "J")).toBe(1.602176634e-19);
		expect(number("1 keV in eV")).toBeCloseTo(1000, 9);
		expect(number("1 MeV in keV")).toBeCloseTo(1000, 9);
		expect(number("1 GeV in MeV")).toBeCloseTo(1000, 9);
		expect(shown("13.6 eV in J")).toBe("= 2.18e-18 J");
	});
});

describe("resistance", () => {
	test("the ohm in words and by its symbol, in both code points", () => {
		for (const spelling of ["ohm", "ohms", "\u03A9", "\u2126"]) {
			expect(convertUnit(1, spelling, "ohm")).toBe(1);
		}
		expect(convertUnit(1, "k\u03A9", "\u2126")).toBe(1000);
		expect(convertUnit(1, "k\u2126", "\u03A9")).toBe(1000);
		expect(convertUnit(1, "M\u03A9", "k\u2126")).toBe(1000);
		expect(shown("4.7 k\u03A9 in ohm")).toBe("= 4,700.00 ohm");
	});

	test("the symbol is read glued to its number", () => {
		expect(shown("10\u03A9")).toBe("= 10.00 \u03A9");
		expect(shown("10\u2126")).toBe("= 10.00 \u2126");
	});

	test("the lower-case omega is not the ohm", () => {
		expect(shown("10 \u03C9")).toBe("throws: Undefined variable: \u03C9");
	});
});

describe("charge", () => {
	test("an amp-hour is 3,600 coulombs", () => {
		expect(convertUnit(1, "Ah", "coulomb")).toBe(3600);
		expect(convertUnit(1, "mAh", "coulombs")).toBe(3.6);
		expect(shown("3000 mAh in Ah")).toBe("= 3.00 Ah");
		expect(shown("1 Ah in coulombs")).toBe("= 3,600.00 coulombs");
	});

	test("the coulomb has no symbol, since C stays Celsius", () => {
		expect(getMeasure("C")).toBe("temperature");
		expect(shown("20 C in F")).toBe("= 68.00 F");
		expect(refusal("1 C in coulombs")).toBe("a temperature cannot be converted to a charge");
	});
});

describe("rotation", () => {
	test("rpm is a frequency, a sixtieth of a hertz, in both cases", () => {
		expect(shown("3000 rpm in Hz")).toBe("= 50.00 Hz");
		expect(shown("3000 RPM in Hz")).toBe("= 50.00 Hz");
		expect(shown("50 Hz in rpm")).toBe("= 3,000.00 rpm");
	});

	test("a revolution is the table's full turn, while turn itself stays English", () => {
		expect(UNIT_TABLE.revolution).toBe(UNIT_TABLE.turn);
		expect(UNIT_TABLE.revolutions).toBe(UNIT_TABLE.turns);
		expect(shown("1 revolution in deg")).toBe("= 360.00 deg");
		expect(shown("2 revolutions in rad")).toBe("= 12.57 rad");
		expect(isKnownUnit("turn")).toBe(false);
		expect(isKnownUnit("turns")).toBe(false);
	});
});

describe("knots, the astronomical unit, mmHg, volts, amps, L and mol", () => {
	test("the knot in words is the kn beside it, and kt stays the kilotonne", () => {
		expect(convertUnit(1, "knot", "kn")).toBe(1);
		expect(convertUnit(1, "knots", "kn")).toBe(1);
		expect(shown("1 knot in m/s")).toBe("= 0.51 m/s");
		expect(number("1 kt in kg")).toBe(1_000_000);
	});

	test("the astronomical unit is the IAU's exact figure", () => {
		expect(convertUnit(1, "AU", "m")).toBe(149_597_870_700);
		expect(shown("1 ly in AU")).toBe("= 63,241.08 AU");
		expect(isKnownUnit("au")).toBe(false);
	});

	test("mmHg is the conventional 133.322387415 Pa, beside the torr but not the torr", () => {
		expect(convertUnit(1, "mmHg", "Pa")).toBe(133.322387415);
		expect(convertUnit(1, "mmHg", "torr")).not.toBe(1);
		expect(convertUnit(1, "mmHg", "torr")).toBeCloseTo(1, 6);
		expect(shown("120 mmHg in torr")).toBe("= 120.00 torr");
		expect(shown("760 mmHg in atm")).toBe("= 1.00 atm");
	});

	test("volts and amps in words are V and A", () => {
		for (const spelling of ["volt", "volts"]) expect(convertUnit(1, spelling, "V")).toBe(1);
		for (const spelling of ["amp", "amps", "ampere", "amperes"]) expect(convertUnit(1, spelling, "A")).toBe(1);
		expect(shown("5 amps in mA")).toBe("= 5,000.00 mA");
	});

	test("L is the litre, the same entry as l", () => {
		expect(UNIT_TABLE.L).toBe(UNIT_TABLE.l);
		expect(shown("2L")).toBe("= 2.00 L");
		expect(shown("1.5L + 500 ml")).toBe("= 2.00 L");
		expect(shown("500 ml in L")).toBe("= 0.50 L");
	});

	test("the mole converts within its own measure only", () => {
		expect(shown("1 mol in mmol")).toBe("= 1,000.00 mmol");
		expect(shown("2 mol + 500 mmol")).toBe("= 2.50 mol");
		expect(isKnownUnit("mole")).toBe(false);
		expect(isKnownUnit("moles")).toBe(false);
	});
});

describe("the dimensional products", () => {
	test.each([
		["12 V / 2 A", "= 6.00 \u03A9"],
		["12 volts / 2 amps", "= 6.00 \u03A9"],
		["2 A * 6 ohm", "= 12.00 V"],
		["2 A * 6 \u03A9", "= 12.00 V"],
		["12 V / 6 \u03A9", "= 2.00 A"],
		["24 W / 12 V", "= 2.00 A"],
		["2 mA * 4.7 k\u03A9", "= 9.40 V"],
		["3000 mAh * 3.7 V", "= 11.10 Wh"],
		["3.7 V * 3000 mAh", "= 11.10 Wh"],
		["100 Ah * 12 V", "= 1,200.00 Wh"],
		["100 Ah * 12 V in kWh", "= 1.20 kWh"],
		["11.1 Wh / 3.7 V", "= 3.00 Ah"],
		["11.1 Wh / 3000 mAh", "= 3.70 V"],
		["2 A * 3 h", "= 6.00 Ah"],
		["3 Ah / 6 h", "= 0.50 A"],
		["2 A * 30 s in coulombs", "= 60.00 coulombs"],
		["60 coulombs * 12 V", "= 720.00 J"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a charge is always named in amp-hours, whatever the time", () => {
		// Before, `2 A * 30 s` was refused: "current and duration cannot be multiplied".
		expect(shown("2 A * 30 s")).toBe("= 0.02 Ah");
		expect(number("2 A * 30 s")).toBeCloseTo(1 / 60, 12);
		expect(number("720 J / 12 V")).toBeCloseTo(1 / 60, 12);
	});

	test("the battery energy is exact to the double", () => {
		expect(number("3000 mAh * 3.7 V")).toBeCloseTo(11.1, 12);
		const composed = tryDimensionalCompose(uomValue(12, "V"), uomValue(2, "A"), false);
		expect(composed?.unit).toBe("\u03A9");
		expect(composed?.toNumber()).toBe(6);
	});

	test("what did not change", () => {
		expect(shown("230 V * 13 A")).toBe("= 2,990.00 W");
		expect(shown("2990 W / 13 A")).toBe("= 230.00 V");
		expect(shown("2 kW * 3 h")).toBe("= 6.00 kWh");
		expect(shown("6 kWh / 3 h")).toBe("= 2.00 kW");
		expect(shown("50 N * 4 m as J")).toBe("= 200.00 J");
	});

	test("the boundary: a charge over a current is not named as a time, as an energy over a power is not", () => {
		expect(shown("3000 mAh / 500 mA")).toBe("= 6.00 mAh/mA");
		expect(shown("6 kWh / 2 kW")).toBe("= 3.00 kWh/kW");
	});
});

describe("mixed measures are refused by name", () => {
	test.each([
		["2 kcal * 3 m", "energy and length cannot be multiplied"],
		["2 ohm + 3 kg", "resistance and mass cannot be added"],
		["2 Ah in kg", "a charge cannot be converted to a mass"],
		["1 kcal in mAh", "an energy cannot be converted to a charge"],
		["2 mol * 3 kg", "amount of substance and mass cannot be multiplied"],
		["1 mol in g", "an amount of substance cannot be converted to a mass"],
		["5 amps + 2 V", "current and voltage cannot be added"],
		["1 rpm in rad", "a frequency cannot be converted to an angle"],
		["1 knot in m", "a speed cannot be converted to a length"],
		["120 mmHg in kg", "a pressure cannot be converted to a mass"],
		["1 AU in s", "a length cannot be converted to a duration"],
	])("%s", (line, message) => {
		expect(refusal(line)).toBe(message);
	});
});

describe("huge, negative and zero amounts", () => {
	test.each([
		["0 kcal in kJ", "= 0.00 kJ"],
		["-5 ohm", "= -5.00 ohm"],
		["-0 L", "= 0.00 L"],
		["-3000 mAh * 3.7 V", "= -11.10 Wh"],
		["0 mAh * 3.7 V", "= 0.00 Wh"],
		["1e-320 eV in J", "= 0.00 J"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
		expectHonestLine(line);
	});

	test("an amount past the exact integers keeps its size", () => {
		expect(number("2^53 mAh in Ah") / (2 ** 53 / 1000)).toBeCloseTo(1, 12);
	});

	test.each(["1e308 AU in km", "1e308 mAh * 1e308 V", "12 V / 0 A", "0 V / 0 A", "-1e308 kcal in J", "(5 Ah) / (0 Ah)"])(
		"%s answers honestly",
		(line) => {
			expectHonestLine(line, { allowNaN: true });
		},
	);
});

describe("a variable of the same name", () => {
	test("L is the variable at the start of a line and after an operator, and the litre after a number", () => {
		// Before #706 the second and third lines read the variable and answered
		// 6 each, since `L` was not a unit. The changeset names the change.
		const { batch } = expectHonestDocument("L = 3\n2L\n2 L\nL * 2\nL");
		expect(batch).toEqual(["= 3", "= 2.00 L", "= 2.00 L", "= 6", "= 3"]);
	});

	test.each([
		// Before, the middle line of each multiplied by the variable and answered 6.
		["amp", "= 2.00 amp"],
		["therm", "= 2.00 therm"],
		["volts", "= 2.00 volts"],
		["Cal", "= 2.00 Cal"],
		["mol", "= 2.00 mol"],
		["\u03A9", "= 2.00 \u03A9"],
	])("%s works the same way", (name, unit) => {
		const { batch } = expectHonestDocument(`${name} = 3\n2 ${name}\n${name} * 2`);
		expect(batch).toEqual(["= 3", unit, "= 6"]);
	});

	test("a global works the same way", () => {
		const { batch } = expectHonestDocument(":L = 3\n2L\nL * 2");
		expect(batch).toEqual(["= 3", "= 2.00 L", "= 6"]);
	});

	test("a quantity in a new unit carries it through a variable", () => {
		expect(expectHonestDocument("x = 2 L\nx in ml").batch).toEqual(["= 2.00 L", "= 2,000.00 ml"]);
		expect(expectHonestDocument("battery = 3000 mAh\nbattery * 3.7 V").batch).toEqual(["= 3,000.00 mAh", "= 11.10 Wh"]);
		expect(expectHonestDocument("3000 mAh\nprev * 3.7 V").batch).toEqual(["= 3,000.00 mAh", "= 11.10 Wh"]);
	});

	test("on its own a new unit word is still an undefined name, not a unit", () => {
		expect(shown("L")).toBe("throws: Undefined variable: L");
		expect(shown("\u03A9")).toBe("throws: Undefined variable: \u03A9");
		expect(shown("L = 1")).toBe("= 1");
	});
});

describe("prose is still prose", () => {
	test.each([
		"the amp was loud",
		"amps are loud",
		"volts are dangerous",
		"3 volts of power",
		"tie 2 knots in the rope",
		"the revolution of 1848",
		"I ate 2000 calories today",
		"Calories burned 300",
		"Cal owes me 5",
		"Ah well",
		"the mole ran off 3 times",
	])("%s is not answered", (sentence) => {
		const doc = newTrackedEngine().parseDocument(`${sentence}\n5`);
		expect(doc.lines[0].result ?? null).toBeNull();
		expect(formatValue(doc.lines[1].result!)).toBe("= 5");
		expectHonestDocument(sentence);
	});

	test("a sentence that mentions a unit word with no number starts with a name", () => {
		// The host's prose gate skips a line of words whose first token is a plain name.
		for (const sentence of ["the amp was loud", "the revolution was televised", "tie a knot in it", "count the calories"]) {
			expect(tokenTypes(sentence)[0]).toBe("IDENT");
		}
	});
});

describe("prototype words are not units", () => {
	test.each(PROTOTYPE_WORDS)("%s", (word) => {
		// Before, `tryDimensionalCompose` read its table of unmeasured units
		// without an own-property guard, and a quantity in `constructor` threw a
		// raw TypeError there.
		expect(isKnownUnit(word)).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(EXTENDED_UNITS, word)).toBe(false);
		expect(getMeasure(word)).toBeUndefined();
		expect(canConvert("kcal", word)).toBe(false);
		expect(canConvert(word, "Ah")).toBe(false);
		expect(tryDimensionalCompose(uomValue(1, word), uomValue(2, "V"), true)).toBeNull();
		expect(tryDimensionalCompose(uomValue(3, "Ah"), uomValue(1, word), true)).toBeNull();
		expect(refusal(`3000 mAh in ${word}`)).toBe(`"${word}" is not a unit.`);
		expectHonestLine(`12 V / 2 A in ${word}`);
		expectHonestLine(`2000 kcal in ${word}`);
	});

	test("a document using them as names leaves Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			expectHonestDocument("constructor = 5\n__proto__ = 3\n3000 mAh * 3.7 V\n12 V / 2 A in __proto__\nconstructor * 2 L");
		});
	});
});

describe("adversarial: every new spelling answers honestly", () => {
	test.each(
		EVERYDAY_SPELLINGS.flatMap((w) => [
			`5 ${w}`,
			`5${w}`,
			`-5 ${w}`,
			`${w}`,
			`${w} = 1`,
			`5 ${w} ^ 2`,
			`(5 ${w}) / (0 ${w})`,
			`5 ${w} in J`,
			`5 ${w} * 2 V`,
		]),
	)("%s", (line) => {
		expectHonestLine(line, { allowNaN: true });
	});
});
