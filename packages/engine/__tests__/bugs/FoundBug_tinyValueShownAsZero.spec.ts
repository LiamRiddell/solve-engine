import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, type FormattingSettings } from "@solve-js/format/FormattingSettings";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { matrixValue, numberValueUncertain, uomValue } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a value that is not zero was shown as one in two places, a list
 * and a tolerance. `[1e-6, 1]` was `[0.00, 1]` and `0.004 kg ± 0.001 kg` was
 * `0 ± 0.0`, while a plain `1e-6` is `1e-6` and `0.004 kg` is `0.004 kg`. Both
 * rounded each figure to the two-place budget without the rule every other
 * result follows: a figure below the budget is shown to three significant
 * digits, as a decimal while the zeros are countable and in exponent form after.
 * A list cell and the centre and spread of a tolerance now follow it.
 *
 * The report that led here, `1e-320 km / 1e10` showing `0.00 km`, is not this
 * bug: the quotient is below the smallest number a double holds (about
 * 4.94e-324), so the division itself gives an exact zero, as a plain
 * `1e-320 / 1e10` gives 0. That zero is the honest answer for the number
 * held, and every nonzero quantity, down to the smallest subnormal, shows its
 * digits (pinned below). Money rounds to its minor unit, as documented.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** The display of a tolerance built directly, without a line. */
const tolerance = (center: number, spread: number, settings?: FormattingSettings): string => formatValue(numberValueUncertain(center, spread), settings).replace(/^=\s*/, "");

/** The display of a one-row list built directly, without a line. */
const list = (cells: readonly number[], unit?: string): string => formatValue(matrixValue(1, cells.length, cells, unit)).replace(/^=\s*/, "");

/** Whether a display reads as an exact zero, with or without places, a sign or a unit. */
const readsAsZero = (text: string): boolean => /^-?[$£€]?0(\.0+)?( |$)/.test(text);

describe("the lines that exposed it", () => {
	test("a small cell of a list keeps its digits, as the plain number does", () => {
		expect(shown("1e-6")).toBe("1e-6");
		expect(shown("[1e-6, 1]")).toBe("[1e-6, 1]");
		expect(shown("[0.001, 0.5]")).toBe("[0.001, 0.50]");
		expect(shown("[1, 2; 3e-7, 4]")).toBe("[1, 2; 3e-7, 4]");
		expect(shown("[1e-6 km, 1 km]")).toBe("[1e-6 km, 1.00 km]");
	});

	test("a small tolerance keeps its digits", () => {
		expect(shown("0.004 kg ± 0.001 kg")).toBe("0.004 ± 0.001");
		expect(shown("1e-6 ± 1e-7")).toBe("1e-6 ± 1e-7");
		expect(shown("0 ± 0.001")).toBe("0 ± 0.001");
		expect(shown("-0.004 kg ± 0.001 kg")).toBe("-0.004 ± 0.001");
	});

	test("what already read is unchanged", () => {
		expect(shown("12.3 +/- 0.5")).toBe("12.3 ± 0.5");
		expect(shown("(10 +/- 1) + (20 +/- 2)")).toBe("30 ± 2.24");
		expect(shown("5 m +/- 1 cm")).toBe("5 ± 0.01");
		expect(shown("[1, 2, 3]")).toBe("[1, 2, 3]");
		expect(shown("[0, -0]")).toBe("[0, 0]");
	});

	test("the report: a quotient below the smallest double is an exact zero, for a quantity as for a number", () => {
		expect(shown("1e-320 / 1e10")).toBe("0");
		expect(shown("1e-320 km / 1e10")).toBe("0.00 km");
		expect(shown("0 km")).toBe("0.00 km");
		// One step above the underflow, the quantity shows its digits.
		expect(shown("1e-320 km / 2")).toBe("5e-321 km");
		expect(shown("1e-320 km / 10")).toBe("9.98e-322 km");
	});

	test("money rounds to its minor unit, as documented", () => {
		expect(shown("$0.001")).toBe("$0.00");
		expect(shown("$0.001 / 3")).toBe("$0.00");
		expect(shown("$0.001/kWh")).toBe("$0.001/kWh");
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "[1e-6, 1]"))).toBe("= [1e-6, 1]");
		expect(both(["a = 1e-6", "[a, 1]", "a ± (a/10)"])).toEqual(["1e-6", "[1e-6, 1]", "1e-6 ± 1e-7"]);
		expect(both(["w = 0.004 kg", "w ± 0.001 kg"])).toEqual(["0.004 kg", "0.004 ± 0.001"]);
	});
});

describe("the parts: a list cell", () => {
	test("ordinary: a small cell, a whole cell and a cell with places", () => {
		expect(list([1e-6, 1, 0.5])).toBe("[1e-6, 1, 0.50]");
		expect(list([0.001])).toBe("[0.001]");
	});

	test("boundary: the budget's own edge, zero, negative zero and the smallest double", () => {
		expect(list([0.005])).toBe("[0.01]");
		expect(list([0.004])).toBe("[0.004]");
		expect(list([0, -0])).toBe("[0, 0]");
		expect(list([Number.MIN_VALUE, -Number.MIN_VALUE])).toBe("[4.94e-324, -4.94e-324]");
	});

	test("hostile: an infinity and a NaN cell are not leaked as JavaScript words", () => {
		expect(list([Infinity, -Infinity])).not.toMatch(/Infinity/);
		expect(list([Number.MAX_VALUE])).not.toMatch(/e\+/);
	});
});

describe("the parts: a tolerance", () => {
	test("ordinary: a small centre and spread, and an ordinary one", () => {
		expect(tolerance(0.004, 0.001)).toBe("0.004 ± 0.001");
		expect(tolerance(12.3, 0.5)).toBe("12.3 ± 0.5");
	});

	test("boundary: zero either side, negative zero, a negative spread and the smallest double", () => {
		expect(tolerance(0, 0)).toBe("0 ± 0.0");
		expect(tolerance(-0, 0)).toBe("0 ± 0.0");
		expect(tolerance(5, -0.1)).toBe("5 ± 0.1");
		expect(tolerance(Number.MIN_VALUE, Number.MIN_VALUE)).toBe("4.94e-324 ± 4.94e-324");
		expect(tolerance(-Number.MIN_VALUE, 0)).toBe("-4.94e-324 ± 0.0");
	});

	test("hostile: a zero-place budget still gives the spread its one place", () => {
		const settings: FormattingSettings = { ...DEFAULT_FORMATTING_SETTINGS, floatResult: { ...DEFAULT_FORMATTING_SETTINGS.floatResult, decimalPlaces: 0 } };
		expect(tolerance(3, 0.04, settings)).toBe("3 ± 0.04");
		expect(tolerance(0.3, 0.5, settings)).toBe("0.3 ± 0.5");
	});
});

describe("every nonzero quantity shows its digits", () => {
	// A sweep of magnitudes from the smallest subnormal up, each signed both
	// ways, through a list cell, a tolerance and a quantity in a unit.
	const magnitudes: number[] = [Number.MIN_VALUE, 2 * Number.MIN_VALUE, 1e-322, 1e-320, 1e-310, 2.2250738585072014e-308, 1e-300, 1e-100, 1e-20, 1e-7, 1e-4, 0.004];

	test("in a quantity", () => {
		for (const m of magnitudes) {
			for (const v of [m, -m]) {
				const text = formatValue(uomValue(v, "km")).replace(/^=\s*/, "");
				expect({ v, text, zero: readsAsZero(text) }).toEqual({ v, text, zero: false });
			}
		}
	});

	test("in a list and a tolerance", () => {
		for (const m of magnitudes) {
			for (const v of [m, -m]) {
				expect({ v, zero: readsAsZero(list([v]).slice(1)) }).toEqual({ v, zero: false });
				expect({ v, zero: readsAsZero(tolerance(v, m)) }).toEqual({ v, zero: false });
			}
		}
	});

	test("a negative zero quantity is an unsigned zero", () => {
		expect(shown("-0 km")).toBe("0.00 km");
		expect(formatValue(uomValue(-0, "km"))).toBe("= 0.00 km");
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`[${word}, 1e-6]`, `${word} ± 1e-6`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a long list of small cells and many small tolerances are answered in time", () => {
		expectHonestLine(`[${Array.from({ length: 5_000 }, (_, i) => `${i + 1}e-9`).join(", ")}]`, { budgetMs: 5_000 });
		expectHonestDocument(Array.from({ length: 500 }, () => "1e-6 ± 1e-7").join("\n"), { budgetMs: 10_000 });
	});

	test("digits from another script and a zero-width character beside a small value", () => {
		expectHonestLine("[١e-6, 1]");
		expectHonestLine("[1e-6​, 1]");
	});

	test.each(fill("[1e-6, X]", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge in a list: %j", (line) => {
		expectHonestLine(line);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check over it and a what-if through it", () => {
		expect(both(["a = 1 Hz in MHz", "[a, a]"])[1]).toBe("[1e-6 MHz, 1e-6 MHz]");
		expectHonestDocument("a = 1e-6\nb = [a, 1]\ncheck sum(b) > 1");
		expectHonestDocument("a = 0.004\nb = a ± 0.001\nline 2 with a = 0.002");
	});

	test("a unit that does not fit in a list is refused, not shown as zero", () => {
		expectHonestLine("[1e-6 km, 1 kg]");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("[X, 1e-6]", NUMERIC_EDGES))("a numeric edge beside a small cell: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(fill("(X) ± 1e-6", NUMERIC_EDGES))("a numeric edge with a small spread: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("a CRLF line and a trailing newline through both passes", () => {
		expect(both(["[1e-6, 1]\r", ""])[0]).toBe("[1e-6, 1]");
	});

	// Found while testing this, and fixed since: an amount of money typed in
	// exponent form now keeps its exact decimal as the point form does
	// (FoundBug_moneyInExponentForm.spec.ts), so it rounds to the cent.
	test("$1e-3 rounds to the cent as $0.001 does", () => {
		expect(shown("$1e-3")).toBe("$0.00");
	});
});
