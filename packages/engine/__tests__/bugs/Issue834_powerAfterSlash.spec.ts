import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { poweredRateUnit } from "@solve-js/uom/UnitPowers";
import { isSquaredTimeUnder } from "@solve-js/packages/uom/normalizer/CompoundUnitNormalizerRule";
import { rateInLeftUnit } from "@solve-js/packages/conditionals/CheckFunctions";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { EngineError } from "@solve-js/errors/EngineError";
import { numberValue, uomValue } from "@solve-js/vm/Value";

/**
 * Issue #834: a power after a slash was refused. `1000 kg/m^3` threw "a power
 * applies only to a length", which `m` is: the compound rule had joined `kg/m`
 * before the `^` was seen, and the power was then looked for on the whole
 * `kg/m`. And `check` refused to compare `g/mL` with `g/cm³`, although
 * converting between them worked.
 *
 * A power after a slash now belongs to the unit after it
 * (`uom/UnitPowers.ts`'s `poweredRateUnit`): a length takes its square or cube
 * spelling (`kg/m³`), and a time under a length its square, an acceleration
 * (`ft/s²`). The `in` conversion takes a power on its target the same way
 * (`parser/UnitPower.ts`), the compound rule reads the printed `ft/s²` back,
 * and a check compares two rates whenever one converts into the other.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function thrownCode(line: string): string | undefined {
	try {
		newTrackedEngine().evaluateExpression(line);
		return undefined;
	} catch (e) {
		return e instanceof EngineError ? e.code : "raw";
	}
}

function token(type: string, value: string): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, 0, 0, 1, 1);
}

describe("a power after a slash belongs to the unit after it", () => {
	test.each([
		["1000 kg/m^3", "= 1,000.00 kg/m³"],
		["1000 kg/m³", "= 1,000.00 kg/m³"],
		["1 g/cm^3 in kg/m^3", "= 1,000.00 kg/m³"],
		["1 g/cm^3 in g/mL", "= 1.00 g/mL"],
		["5 USD/m^2", "= $5.00/m²"],
		["9.81 ft/s^2", "= 9.81 ft/s²"],
		["9.81 m/s^2 in ft/s^2", "= 32.19 ft/s²"],
		["9.81 m/s^2 in ft/s²", "= 32.19 ft/s²"],
		["(100 km/h / 10 s) in ft/s^2", "= 9.11 ft/s²"],
		["2 kg/m^3 * 3 m^3", "= 6.00 kg"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a power that makes no unit is refused by name", () => {
		for (const line of ["5 kg/s^2", "9.81 m/s^3", "5 kg/m^4", "5 kg/m^0.5", "5 ft/s^-2"]) {
			expect({ line, code: thrownCode(line) }).toEqual({ line, code: "UNIT_POWER_UNSUPPORTED" });
		}
		expect(shown("5 kg/s^2")).toBe('THROWS "kg/s^2" is not a unit: a power after a slash applies to the unit after it, which must be a length the unit table spells squared or cubed (kg/m^3), or the time of an acceleration, squared (ft/s^2).');
		expect(shown("5 kg^2")).toBe('THROWS "kg^2" is not a unit: a power on a unit makes an area or a volume, so it applies only to a length the unit table spells squared or cubed, such as m^2 or ft^3.');
	});
});

describe("a check compares two quantities whenever one converts into the other", () => {
	test.each([
		["check 1 g/mL == 1 g/cm^3", "= ✓"],
		["check 1 g/mL == 1 g/cm³", "= ✓"],
		["check 1 kg/m^3 == 0.001 g/cm^3", "= ✓"],
		["check 1 kg/m^3 < 1 g/cm^3", "= ✓"],
		["check 60 mph == 96.56064 km/h", "= ✓"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("and still refuses two that do not", () => {
		expect(newTrackedEngine().evaluateExpression("check 1 kg/m^3 == 1 km/h").errorCode).toBe("CHECK_INCOMPARABLE");
		expect(newTrackedEngine().evaluateExpression("check 2 g/mL == 1 g/cm^3").errorCode).toBe("CHECK_FAILED");
	});
});

describe("poweredRateUnit", () => {
	test("a length after the slash takes its power's spelling", () => {
		expect(poweredRateUnit("kg/m", 3)).toBe("kg/m³");
		expect(poweredRateUnit("kg/m", 2)).toBe("kg/m²");
		expect(poweredRateUnit("g/cm", 3)).toBe("g/cm³");
		expect(poweredRateUnit("USD/ft", 2)).toBe("USD/ft²");
	});

	test("a time under a length takes the square, an acceleration", () => {
		expect(poweredRateUnit("m/s", 2)).toBe("mps2");
		expect(poweredRateUnit("ft/s", 2)).toBe("ft/s²");
		expect(poweredRateUnit("km/h", 2)).toBe("km/h²");
	});

	test("anything else is no unit", () => {
		for (const [unit, power] of [["kg/s", 2], ["m/s", 3], ["kg/m", 4], ["kg/m", 0.5], ["kg/m", -1], ["kg/m", Number.NaN], ["m", 2], ["/m", 2], ["a/b/c", 2], ["kg/", 2], ["", 2]] as const) {
			expect({ unit, power, spelled: poweredRateUnit(unit, power) }).toEqual({ unit, power, spelled: undefined });
		}
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(poweredRateUnit(`kg/${word}`, 3)).toBeUndefined();
				expect(poweredRateUnit(`${word}/s`, 2)).toBeUndefined();
			}
		});
	});
});

describe("isSquaredTimeUnder", () => {
	test("a squared time under a length", () => {
		expect(isSquaredTimeUnder(token("UNIT", "ft"), token("IDENT", "s²"))).toBe(true);
		expect(isSquaredTimeUnder(token("UNIT", "km"), token("IDENT", "h²"))).toBe(true);
	});

	test("anything else", () => {
		expect(isSquaredTimeUnder(token("UNIT", "kg"), token("IDENT", "s²"))).toBe(false);
		expect(isSquaredTimeUnder(token("UNIT", "ft"), token("IDENT", "s"))).toBe(false);
		expect(isSquaredTimeUnder(token("UNIT", "ft"), token("IDENT", "s³"))).toBe(false);
		expect(isSquaredTimeUnder(token("IDENT", "ft"), token("IDENT", "s²"))).toBe(false);
		expect(isSquaredTimeUnder(token("UNIT", "ft"), token("NUMBER", "2"))).toBe(false);
		expect(isSquaredTimeUnder(undefined, undefined)).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(isSquaredTimeUnder(token("UNIT", "ft"), token("IDENT", `${word}²`))).toBe(false);
	});
});

describe("rateInLeftUnit", () => {
	test("the right side in the left side's unit", () => {
		expect(rateInLeftUnit(uomValue(1, "g/mL"), uomValue(1, "g/cm³"))).toBeCloseTo(1, 12);
		expect(rateInLeftUnit(uomValue(1, "kg/m³"), uomValue(1, "g/cm³"))).toBeCloseTo(1000, 9);
	});

	test("null for what does not convert, or is not a quantity", () => {
		expect(rateInLeftUnit(uomValue(1, "kg/m³"), uomValue(1, "km/h"))).toBeNull();
		expect(rateInLeftUnit(numberValue(1), uomValue(1, "km/h"))).toBeNull();
		expect(rateInLeftUnit(uomValue(1, "constructor/s"), uomValue(1, "km/h"))).toBeNull();
	});
});

describe("adversarial: security", () => {
	test.each([...fill("5 kg/X^3", PROTOTYPE_WORDS), ...fill("5 X/m^3", PROTOTYPE_WORDS), ...fill("9.81 m/s^2 in X/s^2", PROTOTYPE_WORDS), ...fill("5 m/X²", PROTOTYPE_WORDS)])("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a huge or absurd power is refused by name, quickly", () => {
		for (const line of ["5 kg/m^99999999999", "5 kg/m^1e308", "5 kg/m^(2)", "5 kg/m^^3"]) expectHonestLine(line, { budgetMs: 1_000 });
	});

	test("look-alike and markup-shaped text is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`1000 kg/m^3 ${edge}`);
		expectHonestLine("1000 kg/m^​3");
		expectHonestLine("1000 kg/m^٣");
		expectHonestLine("1000 kg/<b>m</b>^3");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check over it, and both document passes", () => {
		const { batch } = expectHonestDocument("water = 1000 kg/m^3\nwater in g/cm^3\ncheck water == 1 g/mL\nwater * 2 m^3");
		expect(batch).toEqual(["= 1,000.00 kg/m³", "= 1.00 g/cm³", "= ✓", "= 2,000.00 kg"]);
	});

	test("a unit that does not fit is refused by name", () => {
		expect(newTrackedEngine().evaluateExpression("1000 kg/m^3 in km/h").errorCode).toBe("INCOMPATIBLE_UNITS");
	});
});

describe("adversarial: edge cases", () => {
	test.each([...fill("X kg/m^3", NUMERIC_EDGES), ...fill("X ft/s^2 in m/s^2", NUMERIC_EDGES)])("%s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("zero and a negative", () => {
		expect(shown("0 kg/m^3")).toBe("= 0.00 kg/m³");
		expect(shown("-9.81 ft/s^2 in m/s^2")).toBe("= -2.99 m/s²");
	});
});
