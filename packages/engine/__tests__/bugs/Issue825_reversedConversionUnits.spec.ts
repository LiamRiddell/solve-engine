import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, NUMERIC_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { isReversibleUnit } from "@solve-js/packages/uom/normalizer/ReversedConversionNormalizerRule";
import { typeableUnitNameIndex, unitNameIndex } from "@solve-js/vm/VMConversion";
import { excludedUnitSpellings, isKnownUnit } from "@solve-js/lexer/units";
import { nearestNames } from "@solve-js/errors/DidYouMean";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import type { Token } from "@solve-js/lexer/Token";

/**
 * Issue #825: the reversed conversion (`km in 1 mile`, how many of the first
 * unit make one of the second) lower-cased the unit and looked it up in the
 * generated table alone, so an extended unit (`km in 1 furlong`), a currency
 * (`USD in 1 EUR`) and a unit whose case matters (`mW in 1 W`) were refused.
 * And the did-you-mean for a spelling the lexer leaves out as ordinary English
 * suggested another such spelling: `1 turn` offered `turns`, and `1 turns`
 * offered `turn`.
 */

afterEach(() => {
	currencyExchangeService.clearRates();
});

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A UNIT token as the lexer writes one, for the rule's own check. */
function unitToken(value: string, type = "UNIT"): Token {
	return { type, value, text: value } as unknown as Token;
}

describe("the reversed conversion reads every unit the conversion path reads", () => {
	test.each([
		["km in 1 mile", "= 1.61 km"],
		["km in 1 furlong", "= 0.20 km"],
		["m in 1 furlong", "= 201.17 m"],
		["km in a furlong", "= 0.20 km"],
		["g in 1 carat", "= 0.20 g"],
		["mW in 1 W", "= 1,000.00 mW"],
		["MHz in 1 GHz", "= 1,000.00 MHz"],
		["days in 3 weeks", "= 21 days"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("it asks the same question as the forward form", () => {
		for (const [reversed, forward] of [["km in 1 furlong", "1 furlong in km"], ["mW in 1 W", "1 W in mW"], ["g in 1 carat", "1 carat in g"]]) {
			expect(shown(reversed)).toBe(shown(forward));
		}
	});

	test("a currency, at a primed rate", () => {
		currencyExchangeService.primeRates("EUR", { USD: 1.25 }, { provider: "host" });
		expect(shown("USD in 1 EUR")).toBe("= $1.25");
		expect(shown("USD in 1 EUR")).toBe(shown("1 EUR in USD"));
	});

	test("case is read as written, as the rest of the unit system reads it", () => {
		// `KM` is not a unit, so there is nothing to reverse, and the line is refused as before.
		expect(shown("KM in 1 mile")).toMatch(/^THROWS /);
		expect(shown("MW in 1 kW")).toBe("= 0.001 MW");
		expect(shown("mW in 1 W")).not.toBe(shown("MW in 1 W"));
	});
});

describe("isReversibleUnit, the rule's own check", () => {
	test("an ordinary, an extended, a case-sensitive and a currency unit", () => {
		for (const unit of ["km", "furlong", "carat", "mW", "MW", "GHz", "USD", "BTC"]) expect(isReversibleUnit(unitToken(unit))).toBe(true);
	});

	test("a spelling in the wrong case, or no unit at all", () => {
		for (const text of ["KM", "Furlong", "mw", "banana", ""]) expect(isReversibleUnit(unitToken(text))).toBe(false);
	});

	test("a token that is not a unit token, or no token", () => {
		expect(isReversibleUnit(undefined)).toBe(false);
		expect(isReversibleUnit(unitToken("km", "IDENT"))).toBe(false);
		expect(isReversibleUnit(unitToken("km", "NUMBER"))).toBe(false);
		expect(isReversibleUnit({ type: "UNIT" } as unknown as Token)).toBe(false);
	});

	test("a word naming an inherited property is not a unit", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(isReversibleUnit(unitToken(word))).toBe(false);
		});
	});
});

describe("an excluded spelling is never suggested for an undefined name", () => {
	test("the issue's lines", () => {
		expect(shown("1 turn")).toBe("THROWS Undefined variable: turn");
		expect(shown("1 turns")).toBe("THROWS Undefined variable: turns");
	});

	test.each([...excludedUnitSpellings.keys()])("%s is not offered", (spelling) => {
		for (const typed of [spelling, `${spelling}s`, spelling.slice(0, -1) || spelling]) {
			const message = shown(`1 ${typed}`);
			const offered = /Did you mean (.*)\?$/.exec(message)?.[1] ?? "";
			const names = offered.split(/, | or /).filter(Boolean);
			for (const excluded of excludedUnitSpellings.keys()) expect(names).not.toContain(excluded);
		}
	});

	test("a real unit is still suggested", () => {
		expect(shown("1 metr")).toBe("THROWS Undefined variable: metr. Did you mean meter or metre?");
		expect(shown("1 grade")).toBe("THROWS Undefined variable: grade. Did you mean grad or grads?");
		expect(shown("1 ares")).toBe("THROWS Undefined variable: ares. Did you mean acres?");
	});

	test("a conversion target still suggests from the whole table, where an excluded spelling is read", () => {
		// `points` is left out of the vocabulary, but it names a unit after `in`.
		expect(shown("1 mm in points")).toBe("= 2.83 points");
		expect(shown("1 mm in pointz")).toContain("points");
	});
});

describe("typeableUnitNameIndex, the index an undefined name searches", () => {
	test("every name it holds is a spelling the lexer reads", () => {
		const index = typeableUnitNameIndex();
		for (const word of ["metre", "turn", "turns", "point", "grade", "moment", "shake", "are"]) {
			for (const name of nearestNames(word, [], 3, index)) expect(isKnownUnit(name)).toBe(true);
		}
	});

	test("it is built once, and is not the conversion target's index", () => {
		expect(typeableUnitNameIndex()).toBe(typeableUnitNameIndex());
		expect(typeableUnitNameIndex()).not.toBe(unitNameIndex());
	});

	test("boundary and hostile words find nothing, and change nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of ["", "a", "ab", ...PROTOTYPE_WORDS, "x".repeat(10_000)]) {
				expect(() => nearestNames(word, [], 3, typeableUnitNameIndex())).not.toThrow();
			}
			expect(nearestNames("turn", [], 3, typeableUnitNameIndex())).toEqual([]);
			expect(nearestNames("turns", [], 3, typeableUnitNameIndex())).toEqual([]);
		});
	});
});

describe("adversarial", () => {
	test("security: inherited property names as either unit, and a long line", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("X in 1 mile", PROTOTYPE_WORDS), ...fill("km in 1 X", PROTOTYPE_WORDS), ...fill("1 X", PROTOTYPE_WORDS)]) expectHonestLine(line);
		});
		expectHonestLine(`km in ${RESOURCE_PROBES.longSum(2_000)} furlong`, { budgetMs: 5_000 });
		expectHonestLine(`km in 1 ${RESOURCE_PROBES.longIdentifier()}`, { budgetMs: 5_000 });
	});

	test("security: look-alike and markup-shaped text in place of the unit", () => {
		for (const line of fill("km in 1 X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		// A Cyrillic "м" is not the metre's "m".
		expect(shown("км in 1 mile")).not.toBe(shown("km in 1 mile"));
	});

	test("realistic: a typo, a unit that does not fit, a value from the line above", () => {
		expect(shown("km in 1 furlng")).toMatch(/^THROWS /);
		expectHonestLine("km in 1 kg");
		expect(shown("km in 1 kg")).toMatch(/length|mass|cannot/);
		const { batch, incremental } = expectHonestDocument("x = 3\nkm in 1 furlong\nprev * x");
		expect(batch).toEqual(["= 3", "= 0.20 km", "= 0.60 km"]);
		expect(incremental).toEqual(batch);
	});

	test("realistic: the form inside a check and a what-if", () => {
		const { batch } = expectHonestDocument("km in 1 furlong\ncheck prev < 1 km");
		expect(batch[1]).not.toMatch(/fail/i);
		expectHonestDocument("f = 1 furlong\nkm in 1 furlong\nline 2 with f = 2 furlong");
	});

	test("edge: zero, negative and huge counts", () => {
		for (const line of fill("km in X furlong", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expect(shown("km in 0 furlong")).toBe("= 0.00 km");
		// A signed count is not read as the reversed form, for a base-table unit
		// as for an extended one (a boundary this change leaves where it was).
		expect(shown("km in -1 furlong").startsWith("THROWS")).toBe(shown("km in -1 mile").startsWith("THROWS"));
	});

	test("edge: the bare form with no count, and with trailing text", () => {
		expectHonestLine("km in furlong");
		expectHonestLine("km in 1 furlong extra");
		expectHonestLine("km in");
	});
});
