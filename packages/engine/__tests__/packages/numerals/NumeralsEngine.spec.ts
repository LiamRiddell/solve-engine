/**
 * Numeral conversions through the engine grammar: the `as` converters and the
 * `from roman` reverse (the pure conversions are pinned in NumeralOps.spec.ts).
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("as converters", () => {
	test("as roman", () => {
		expect(shown("2024 as roman")).toBe("MMXXIV");
		expect(shown("1994 as roman")).toBe("MCMXCIV");
	});
	test("as words", () => {
		expect(shown("1234 as words")).toBe("one thousand two hundred and thirty-four");
		expect(shown("105 as words")).toBe("one hundred and five");
	});
	test("as ordinal", () => {
		expect(shown("3 as ordinal")).toBe("3rd");
		expect(shown("22 as ordinal")).toBe("22nd");
		expect(shown("11 as ordinal")).toBe("11th");
	});
});

describe("from roman", () => {
	test("reads a Roman numeral string back to a number", () => {
		expect(value('"MMXXIV" from roman').toNumber()).toBe(2024);
		expect(value('"MCMXCIV" from roman').toNumber()).toBe(1994);
	});
});

describe("errors rather than wrong answers", () => {
	test("a number out of the Roman range", () => {
		expect(value("4000 as roman").type).toBe(ValueType.Error);
		expect(value("0 as roman").type).toBe(ValueType.Error);
	});
	test("a malformed Roman string", () => {
		expect(value('"IIII" from roman').type).toBe(ValueType.Error);
	});
});

describe("the numerals package is removable", () => {
	// Removability is checked through `from roman`, a per-engine parselet, not
	// through `as roman`: the as-converter registry is process-shared, so a
	// converter another test registered would still resolve in a slim engine.
	test("without it, `from roman` is not a clause", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-numerals") });
		let ok = false;
		try {
			ok = slim.evaluateLine(1, '"MMXXIV" from roman').toNumber() === 2024;
		} catch {
			ok = false;
		}
		expect(ok).toBe(false);
	});
});
