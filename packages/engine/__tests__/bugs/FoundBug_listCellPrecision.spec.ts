import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatMatrixAligned, formatValue, listTakesSignificantForm } from "@solve-js/format/FormatEngine";
import { resolveFormattingSettings } from "@solve-js/format/FormattingSettings";
import { hiddenDigitsText, significantDigitsText, tooSmallToPrintText } from "@solve-js/utilities/Number";
import type { MatrixData } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `map(x px at 300 dpi, 1:2)` showed `[0.00333 in, 0.01 in]`.
 *
 * Each cell of a list was formatted on its own. The first, a third of a
 * hundredth of an inch, rounds to zero at two places, so it took the
 * three-significant-digit form batch W gave a list cell; the second, 0.00667,
 * does not round to zero, so it was cut to two places and read 0.01. One list
 * showed its cells to two different precisions. Once any shown cell needs the
 * significant form, every cell below one whose places would hide its digits
 * now takes it too (`listTakesSignificantForm` in format/FormatEngine.ts, with
 * the cell rule in `hiddenDigitsText` in utilities/Number.ts):
 * `[0.00333 in, 0.00667 in]`. A cell the places show in full keeps them, so
 * `[0.001, 0.5]` is still `[0.001, 0.50]`.
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine. */
function single(line: string): string {
	const value = newTrackedEngine().evaluateLine(1, line);
	if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
	return formatValue(value).replace(/^=\s*/, "");
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** A one-row list of plain numbers, or of one unit. */
function list(data: readonly number[], unit?: string): MatrixData {
	return { rows: 1, cols: data.length, data, hasSymbolic: false, unit };
}

const SETTINGS = resolveFormattingSettings();

describe("the line that exposed it", () => {
	test("both cells show three significant digits, through every entry point", () => {
		expect(outcome("map(x px at 300 dpi, 1:2)")).toBe("[0.00333 in, 0.00667 in]");
		expect(single("map(x px at 300 dpi, 1:2)")).toBe("[0.00333 in, 0.00667 in]");
		expect(both(["map(x px at 300 dpi, 1:2)"])).toEqual(["[0.00333 in, 0.00667 in]"]);
	});

	test("a longer list, plain numbers and a negative cell read alike", () => {
		expect(outcome("map(x px at 300 dpi, 1:4)")).toBe("[0.00333 in, 0.00667 in, 0.01 in, 0.0133 in]");
		expect(outcome("[0.001, 0.006]")).toBe("[0.001, 0.006]");
		expect(outcome("[0.001, -0.006]")).toBe("[0.001, -0.006]");
		expect(outcome("[0.001, 0.25, 3]")).toBe("[0.001, 0.25, 3]");
	});

	test("a cell the places show in full keeps them, beside a small cell", () => {
		expect(outcome("[0.001, 0.5]")).toBe("[0.001, 0.50]");
		expect(outcome("[0.001, 0.123]")).toBe("[0.001, 0.123]");
		expect(outcome("[1e-6, 1, 0.5]")).toBe("[1e-6, 1, 0.50]");
	});

	test("a list with no cell below its places keeps the place budget", () => {
		expect(outcome("[0.5, 0.25]")).toBe("[0.50, 0.25]");
		expect(outcome("map(x px at 96 dpi, 1:2)")).toBe("[0.01 in, 0.02 in]");
		expect(outcome("[1 km, 500 m]")).toBe("[1.00 km, 0.50 km]");
	});

	test("each cell on its own line keeps the scalar rule", () => {
		expect(outcome("1 px at 300 dpi")).toBe("0.00333 in");
		expect(outcome("2 px at 300 dpi")).toBe("0.01 in");
	});

	test("the aligned grid writes the cells the same way", () => {
		expect(formatMatrixAligned(list([1 / 300, 2 / 300], "in"))).toBe("[ 0.00333 in  0.00667 in ]");
		expect(formatMatrixAligned(list([0.5, 0.25]))).toBe("[ 0.50  0.25 ]");
	});
});

describe("the parts: listTakesSignificantForm", () => {
	test("ordinary: true once a shown cell rounds away at its places", () => {
		expect(listTakesSignificantForm(list([1 / 300, 2 / 300], "in"), SETTINGS, 1, 2)).toBe(true);
		expect(listTakesSignificantForm(list([0.001, 3]), SETTINGS, 1, 2)).toBe(true);
	});

	test("boundary: no cell below the places, a cell left out of the preview, zero, money", () => {
		expect(listTakesSignificantForm(list([0.5, 0.25]), SETTINGS, 1, 2)).toBe(false);
		expect(listTakesSignificantForm(list([0.5, 0.001]), SETTINGS, 1, 1)).toBe(false);
		expect(listTakesSignificantForm(list([0, -0]), SETTINGS, 1, 2)).toBe(false);
		expect(listTakesSignificantForm(list([0.001, 0.006], "USD"), SETTINGS, 1, 2)).toBe(false);
		expect(listTakesSignificantForm(list([0.004]), resolveFormattingSettings({ floatResult: { decimalPlaces: 3 } }), 1, 1)).toBe(false);
	});

	test("hostile: an empty list, counts past the shape, infinities, NaN, text and booleans", () => {
		expect(listTakesSignificantForm(list([]), SETTINGS, 1, 0)).toBe(false);
		expect(listTakesSignificantForm(list([0.001]), SETTINGS, 99, 99)).toBe(true);
		expect(listTakesSignificantForm(list([0.001]), SETTINGS, -1, -1)).toBe(false);
		expect(listTakesSignificantForm(list([Infinity, -Infinity, NaN]), SETTINGS, 1, 3)).toBe(false);
		const mixed: MatrixData = { rows: 1, cols: 2, data: [true, 0.001], hasSymbolic: false };
		expect(listTakesSignificantForm(mixed, SETTINGS, 1, 2)).toBe(true);
		expect(listTakesSignificantForm(list([0.001], "constructor"), SETTINGS, 1, 1)).toBe(true);
	});
});

describe("the parts: hiddenDigitsText", () => {
	test("ordinary: a value below one whose places hide its digits", () => {
		expect(hiddenDigitsText(2 / 300, 2)).toBe("0.00667");
		expect(hiddenDigitsText(0.123, 2)).toBe("0.123");
		expect(hiddenDigitsText(-0.0133, 2)).toBe("-0.0133");
	});

	test("boundary: a value the places show in full, one and above, zero, more places", () => {
		expect(hiddenDigitsText(0.5, 2)).toBeUndefined();
		expect(hiddenDigitsText(0.25, 2)).toBeUndefined();
		expect(hiddenDigitsText(0.01, 2)).toBeUndefined();
		expect(hiddenDigitsText(1, 2)).toBeUndefined();
		expect(hiddenDigitsText(-1.5, 2)).toBeUndefined();
		expect(hiddenDigitsText(0, 2)).toBeUndefined();
		expect(hiddenDigitsText(-0, 2)).toBeUndefined();
		expect(hiddenDigitsText(2 / 300, 5)).toBeUndefined();
		expect(hiddenDigitsText(2 / 300, 0)).toBe("0.00667");
		expect(hiddenDigitsText(0.00667, 2, "de-DE")).toBe("0,00667");
	});

	test("hostile: infinities, NaN, the smallest double", () => {
		expect(hiddenDigitsText(Infinity, 2)).toBeUndefined();
		expect(hiddenDigitsText(-Infinity, 2)).toBeUndefined();
		expect(hiddenDigitsText(NaN, 2)).toBeUndefined();
		expect(hiddenDigitsText(5e-324, 2)).toBe("4.94e-324");
	});
});

describe("the parts: significantDigitsText and tooSmallToPrintText", () => {
	test("ordinary: three significant digits, trailing zeros dropped, the exponent form below 1e-4", () => {
		expect(significantDigitsText(2 / 300)).toBe("0.00667");
		expect(significantDigitsText(0.01)).toBe("0.01");
		expect(significantDigitsText(0.25)).toBe("0.25");
		expect(significantDigitsText(1e-6)).toBe("1e-6");
		expect(significantDigitsText(-0.006)).toBe("-0.006");
	});

	test("boundary: zero, the edge of the plain form, a value that rounds up to one, a locale", () => {
		expect(significantDigitsText(0)).toBeUndefined();
		expect(significantDigitsText(-0)).toBeUndefined();
		expect(significantDigitsText(1e-4)).toBe("0.0001");
		expect(significantDigitsText(0.99999)).toBe("1");
		expect(significantDigitsText(0.00667, "de-DE")).toBe("0,00667");
	});

	test("hostile: infinities, NaN and the smallest double", () => {
		expect(significantDigitsText(Infinity)).toBeUndefined();
		expect(significantDigitsText(NaN)).toBeUndefined();
		expect(significantDigitsText(5e-324)).toBe("4.94e-324");
	});

	test("tooSmallToPrintText still answers only for a value that rounds away", () => {
		expect(tooSmallToPrintText(2 / 300, 2)).toBeUndefined();
		expect(tooSmallToPrintText(1 / 300, 2)).toBe("0.00333");
		expect(tooSmallToPrintText(0, 2)).toBeUndefined();
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a unit or a cell touches no prototype and answers honestly", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("[0.001, X]", PROTOTYPE_WORDS), ...fill("map(x / 1000 X, 1:2)", PROTOTYPE_WORDS)]) expectHonestLine(line);
		});
	});

	test("a long list of small cells is written within the budget", () => {
		expect(expectHonestLine("map(x / 1000000, 1:20000)", { budgetMs: 5_000 }).kind).not.toBe("crashed");
	});

	test("markup-shaped text beside a small list is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`[0.001, 0.006] ${edge}`);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a list from the line above, a name, a conversion and a check", () => {
		expect(both(["x = map(x px at 300 dpi, 1:2)", "x", "x in mm", "check 2 px at 300 dpi < 0.01 in"])).toEqual([
			"[0.00333 in, 0.00667 in]",
			"[0.00333 in, 0.00667 in]",
			"[0.08 mm, 0.17 mm]",
			"✓",
		]);
		expectHonestDocument("# Sizes\nmap(x px at 300 dpi, 1:2)\n## More\nmap(x px at 300 dpi, 1:4)");
	});

	test("a money list keeps the currency's places for a cell that does not round away", () => {
		expect(outcome("[$0.001, $0.006]")).toBe("[$0.001, $0.01]");
	});

	test("a list converted to another unit is weighed again in that unit", () => {
		// 0.0847 mm and 0.169 mm: neither rounds away at two places, so both keep them.
		expect(outcome("map(x px at 300 dpi, 1:2) in mm")).toBe("[0.08 mm, 0.17 mm]");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero and negatives beside a small cell", () => {
		expect(outcome("[-0.001, 0]")).toBe("[-0.001, 0]");
		expect(outcome("[0.001, -0, -0.25]")).toBe("[0.001, 0, -0.25]");
	});

	test("the largest and smallest doubles in one list", () => {
		expect(outcome("[1e-320, 0.5]")).toBe("[1e-320, 0.50]");
		expect(outcome("[1e-320, 0.123]")).toBe("[1e-320, 0.123]");
		for (const line of fill("[0.001, X]", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["map(x px at 300 dpi, 1:2)\r", ""])).toEqual(["[0.00333 in, 0.00667 in]", ""]);
	});
});
