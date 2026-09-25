import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, expectPrototypeUntouched, PROTOTYPE_WORDS } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { Value, numberValue, numberValueUncertain, matrixValue, stringValue, ValueType } from "@solve-js/vm/Value";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { namesAUnit, plainValueInUnit, unknownUnitError, unitNameIndex } from "@solve-js/vm/VMConversion";
import { converterPrepositionNormalizerRule } from "@solve-js/packages/converters/normalizer/ConverterPrepositionNormalizerRule";

/**
 * Issue #646: a bare number took any word after `in` as its unit. `in hex` and
 * `in binary` reached their converters because the lexer marks those names,
 * but a package's converter (`roman`, `words`, `ordinal`) lexes as an ordinary
 * word, so `2024 in roman` answered `2,024.00 roman`, and a word that is no
 * unit at all labelled the number: `5 in widgets` was `5.00 widgets`.
 *
 * `in` now reaches every converter a package registered, as `as` does, and a
 * word that is neither a unit nor a converter is refused with the UNKNOWN_UNIT
 * sentence a quantity already had. `to` keeps its reading as a percentage
 * change before a word, since that word may be a variable (`start to n`), and
 * a package converter is often named like one.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

function tk(type: string, value: string, offset = 0): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, offset, 0, 1, offset + 1);
}

describe("in reaches a converter a package registered", () => {
	test.each([
		["2024 in roman", "= MMXXIV"],
		["1994 in roman", "= MCMXCIV"],
		["42 in words", "= forty-two"],
		["3 in ordinal", "= 3rd"],
		["1500000 in compact", "= 1.5M"],
		['"hello" in base64', "= aGVsbG8="],
		["5 kJ in kwh", "= 0.00139 kWh"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the same answer as as", () => {
		expect(shown("2024 in roman")).toBe(shown("2024 as roman"));
		expect(shown("-3 in roman")).toBe(shown("-3 as roman"));
	});

	test("a converter from a package the host registered is reached too", () => {
		const shout: IEnginePackage = {
			name: "issue-646-shout",
			asConverters: { zzshout646: (v: Value) => stringValue(`${v.toNumber()}!`) },
		};
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, shout] });
		expect(formatValue(engine.evaluateExpression("5 in zzshout646"))).toBe("= 5!");
		expect(formatValue(engine.evaluateExpression("5 as zzshout646"))).toBe("= 5!");
	});
});

describe("a word that is neither a unit nor a converter is refused", () => {
	test.each([
		["5 in widgets", '"widgets" is not a unit.'],
		["5 in xyzzy", '"xyzzy" is not a unit.'],
		["5 in Tokyo", '"Tokyo" is not a unit.'],
		["5 in KM", '"KM" is not a unit.'],
		["5 in XYZ", '"XYZ" is not a unit.'],
	])("%s", (line, message) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.errorCode).toBe("UNKNOWN_UNIT");
		expect(formatValue(value)).toBe(message);
	});

	test("with the sentence a quantity already had", () => {
		expect(shown("5 in widgets")).toBe(shown("$5 in widgets"));
		expect(code("5 km in banana")).toBe("UNKNOWN_UNIT");
	});
});

describe("the boundary: a number given a real unit is unchanged", () => {
	test.each([
		["5 in km", "= 5.00 km"],
		["5 in furlong", "= 5.00 furlong"],
		["5 in nautical miles", "= 5.00 nautical miles"],
		["5 in EUR", "= €5.00"],
		["5 in BTC", "= 5.00 BTC"],
		["5 in km/h", "= 5.00 km/h"],
		["5 in hours", "= 5 hours"],
		["255 in hex", "= 0xFF"],
		["99 in binary", "= 0b1100011"],
		["0.5 in %", "= 50.00%"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("to before a word is still a percentage change to a variable", () => {
		const { batch } = expectHonestDocument("roman = 2025\n2024 to roman");
		expect(batch).toEqual(["= 2,025", "= 0.05%"]);
	});
});

describe("adversarial", () => {
	test("a word naming an inherited property is not a unit, and changes nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const outcome = expectHonestLine(`5 in ${word}`);
				expect(outcome.kind === "error" || outcome.kind === "thrown").toBe(true);
			}
		});
		expect(shown("5 in constructor")).toBe('"constructor" is not a unit.');
	});

	test("a rate of words that are not units is refused, and a very long one within budget", () => {
		expect(shown("5 in foo/bar")).toBe('"foo" is not a unit. Did you mean foot?');
		expectHonestLine(`5 in ${"a/".repeat(500)}a`);
	});

	test("a number from a variable or a line reference, through both passes", () => {
		const { batch } = expectHonestDocument("x = 5\nx in widgets\n2024\nline 3 in roman\nx in km");
		expect(batch).toEqual(["= 5", 'ERROR "widgets" is not a unit.', "= 2,024", "= MMXXIV", "= 5.00 km"]);
	});
});

describe("namesAUnit", () => {
	test("units, extended units, currencies, frames and rates of units", () => {
		for (const unit of ["km", "furlong", "nautical miles", "EUR", "BTC", "frames", "km/h", "/s", "USD/kWh", "mps2"]) expect(namesAUnit(unit)).toBe(true);
	});

	test("words that are not, a case that is not, and rates of them", () => {
		for (const unit of ["widgets", "KM", "Tokyo", "XYZ", "foo/bar", "km/widgets", "", "constructor", "__proto__"]) expect(namesAUnit(unit)).toBe(false);
	});
});

describe("unknownUnitError", () => {
	test("searches one shared index of every unit spelling", () => {
		expect(unitNameIndex()).toBe(unitNameIndex());
	});

	test("names the word and the nearest units", () => {
		expect(formatValue(unknownUnitError("widgets"))).toBe('"widgets" is not a unit.');
		expect(formatValue(unknownUnitError("mtres"))).toMatch(/^"mtres" is not a unit\. Did you mean/);
		expect(unknownUnitError("widgets").errorCode).toBe("UNKNOWN_UNIT");
	});
});

describe("plainValueInUnit", () => {
	test("a number with a real unit becomes the quantity", () => {
		const v = plainValueInUnit(numberValue(5), "km");
		expect(v.type).toBe(ValueType.Uom);
		expect(v.unit).toBe("km");
	});

	test("refuses a word that is not a unit, a list and an uncertain number, each by its own code", () => {
		expect(plainValueInUnit(numberValue(5), "widgets").errorCode).toBe("UNKNOWN_UNIT");
		expect(plainValueInUnit(matrixValue(1, 2, [1, 2]), "km").errorCode).toBe("CONVERT_NON_NUMERIC");
		expect(plainValueInUnit(numberValueUncertain(5, 0.1), "km").errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
	});
});

describe("converterPrepositionNormalizerRule", () => {
	const rule = converterPrepositionNormalizerRule();

	test("rewrites in before a package's converter into as", () => {
		const match = rule.match([tk("IN", "in"), tk("IDENT", "roman", 1)], 0);
		expect(match?.consumed).toBe(1);
		expect(match?.replacement[0].type).toBe("AS");
	});

	test("leaves to before a package's converter, and in before a word that is none", () => {
		expect(rule.match([tk("TO", "to"), tk("IDENT", "roman", 1)], 0)).toBeNull();
		expect(rule.match([tk("IN", "in"), tk("IDENT", "widgets", 1)], 0)).toBeNull();
		expect(rule.match([tk("IN", "in"), tk("IDENT", "constructor", 1)], 0)).toBeNull();
	});

	test("still rewrites both prepositions before a lexer converter name", () => {
		expect(rule.match([tk("TO", "to"), tk("CONVERTER_NAME", "binary", 1)], 0)?.replacement[0].type).toBe("AS");
		expect(rule.match([tk("IN", "in"), tk("FUNC", "hex", 1)], 0)?.replacement[0].type).toBe("AS");
	});
});
