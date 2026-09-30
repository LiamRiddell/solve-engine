import { describe, expect, test } from "@jest/globals";
import { formatValue, formatMatrixAligned, matrixElementCeiling, matrixPreview } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, mergeFormattingSettings, resolveFormattingSettings } from "@solve-js/format/FormattingSettings";
import { autoFormatIntegerOrFloat, numberFormatFor } from "@solve-js/utilities/Number";
import { matrixValue, type MatrixData } from "@solve-js/vm/Value";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { PROTOTYPE_WORDS, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #764: a list or matrix was written element by element, and each
 * element built a new `Intl` formatter through `toLocaleString` with an
 * options object. `map(10*x, 0:99999)` took 2.5 s to format after 0.15 s to
 * evaluate, on this spec's machine: 888,791 characters that nobody reads.
 *
 * Two changes. Numbers are written through one cached `Intl.NumberFormat` per
 * locale and option set, which writes exactly what `toLocaleString` wrote: the
 * same list formats in about 60 ms. And `matrixResult.maxElements`, an opt-in
 * ceiling, writes the leading elements and counts the rest, in the short form
 * the trace already used: `= [0, 10, 20, and 99,997 more]`. With a ceiling of
 * 1,000 the list formats in under a millisecond.
 */

const settings = (maxElements: unknown) => resolveFormattingSettings({ matrixResult: { maxElements } } as never);
const list = (n: number) => matrixValue(1, n, Array.from({ length: n }, (_, i) => i * 10));
const column = (n: number) => matrixValue(n, 1, Array.from({ length: n }, (_, i) => i + 1));
/** A row-major grid, stored column-major as the VM stores it. */
function grid(rows: number, cols: number): ReturnType<typeof matrixValue> {
	const data: number[] = new Array(rows * cols);
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r + c * rows] = r * cols + c + 1;
	return matrixValue(rows, cols, data);
}

// ── numberFormatFor, the cached formatter ─────────────────────────────────

describe("numberFormatFor (unit)", () => {
	/** The locales the engine ships (en, de, fr) as number locales, the default, and tags whose grouping differs. */
	const LOCALES = ["en-US", "en-GB", "de-DE", "fr-FR", "es-ES", "it-IT", "pt-BR", "ar-EG", "hi-IN", "ja-JP", "de-CH", "en"];
	const NUMBERS = [0, -0, 1, -1, 7, 1234, 12345, 1234567.891, -9876.5, 0.005, 0.125, 2 ** 53, 2 ** 53 + 2, 1e21, 1e308, -1e308, 5e-324, Number.NaN, Infinity, -Infinity];

	test("writes exactly what toLocaleString writes, for every locale and option set the engine uses", () => {
		const mismatches: string[] = [];
		for (const locale of LOCALES) {
			for (const n of NUMBERS) {
				for (const places of [0, 2, 6]) {
					const grouped = n.toLocaleString(locale, { minimumFractionDigits: places, maximumFractionDigits: places });
					const plain = n.toLocaleString(locale, { useGrouping: false, minimumFractionDigits: places, maximumFractionDigits: places });
					if (numberFormatFor(locale, undefined, places, places).format(n) !== grouped) mismatches.push(`${locale} ${n} ${places} grouped`);
					if (numberFormatFor(locale, false, places, places).format(n) !== plain) mismatches.push(`${locale} ${n} ${places} plain`);
				}
			}
		}
		expect(mismatches).toEqual([]);
	});

	test("the locale's own grouping is kept: Spanish leaves four digits ungrouped", () => {
		expect(numberFormatFor("es-ES", undefined, 0, 0).format(1234)).toBe((1234).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		expect(numberFormatFor("es-ES", undefined, 0, 0).format(1234)).toBe("1234");
		expect(numberFormatFor("es-ES", undefined, 0, 0).format(12345)).toBe("12.345");
	});

	test("the same formatter comes back for the same locale and options", () => {
		expect(numberFormatFor("de-DE", false, 2, 2)).toBe(numberFormatFor("de-DE", false, 2, 2));
		expect(numberFormatFor("de-DE", false, 2, 2)).not.toBe(numberFormatFor("de-DE", undefined, 2, 2));
		expect(numberFormatFor("de-DE", false, 2, 2)).not.toBe(numberFormatFor("de-DE", false, 0, 2));
	});

	test("hostile: an unusable locale or place count throws the RangeError toLocaleString throws, and is not cached", () => {
		for (const [locale, places] of [["", 2], ["not a locale!", 2], ["en-US", 200], ["en-US", -1], ["en-US", Number.NaN]] as const) {
			let expected: string | null = null;
			try { (1).toLocaleString(locale, { minimumFractionDigits: places, maximumFractionDigits: places }); } catch (e) { expected = (e as Error).constructor.name; }
			let actual: string | null = null;
			try { numberFormatFor(locale, undefined, places, places); } catch (e) { actual = (e as Error).constructor.name; }
			expect({ locale, places, actual }).toEqual({ locale, places, actual: expected });
		}
	});

	test("hostile: a stream of distinct locale strings is bounded, and prototype words are only tags", () => {
		expectPrototypeUntouched(() => {
			for (let i = 0; i < 500; i++) numberFormatFor(`en-US-x-${i.toString(36).padStart(2, "a")}`, undefined, 0, 0);
			for (const word of PROTOTYPE_WORDS) {
				try { numberFormatFor(word, false, 0, 0).format(1); } catch (e) { expect(e).toBeInstanceOf(RangeError); }
			}
		});
		// Whatever was cached, the answers are still right.
		expect(numberFormatFor("en-US", undefined, 0, 0).format(1234567)).toBe("1,234,567");
	});
});

describe("autoFormatIntegerOrFloat, now through the cached formatter", () => {
	test("ordinary, boundary and negative values in the engine's locales", () => {
		expect(autoFormatIntegerOrFloat(1234567, 2, true, "en-US")).toBe("1,234,567");
		expect(autoFormatIntegerOrFloat(1234567, 2, false, "en-US")).toBe("1234567");
		expect(autoFormatIntegerOrFloat(1234.5, 2, true, "de-DE")).toBe("1.234,50");
		expect(autoFormatIntegerOrFloat(1.5, 2, false, "fr-FR")).toBe("1,50");
		expect(autoFormatIntegerOrFloat(-0.125, 2, true, "en-US")).toBe("-0.13");
		expect(autoFormatIntegerOrFloat(2 ** 53, 2, true, "en-US")).toBe("9,007,199,254,740,992");
		expect(() => autoFormatIntegerOrFloat(1, 2, true, "")).toThrow(RangeError);
	});
});

// ── matrixElementCeiling and matrixPreview ────────────────────────────────

describe("matrixElementCeiling (unit)", () => {
	test("ordinary and boundary: a whole number of at least 1, a fraction rounded down", () => {
		expect(matrixElementCeiling(settings(1000))).toBe(1000);
		expect(matrixElementCeiling(settings(1))).toBe(1);
		expect(matrixElementCeiling(settings(2.9))).toBe(2);
		expect(matrixElementCeiling(DEFAULT_FORMATTING_SETTINGS)).toBeUndefined();
	});

	test("hostile: anything else is no ceiling", () => {
		for (const bad of [0, 0.5, -1, -0, Number.NaN, Infinity, -Infinity, "5", null, true, {}, [5], 2n]) {
			expect({ bad: String(bad), ceiling: matrixElementCeiling(settings(bad)) }).toEqual({ bad: String(bad), ceiling: undefined });
		}
		expect(matrixElementCeiling({ ...DEFAULT_FORMATTING_SETTINGS, matrixResult: null } as never)).toBeUndefined();
		expect(matrixElementCeiling({ ...DEFAULT_FORMATTING_SETTINGS, matrixResult: 7 } as never)).toBeUndefined();
	});
});

describe("matrixPreview (unit)", () => {
	const shape = (rows: number, cols: number): MatrixData => ({ rows, cols, data: new Array(rows * cols).fill(1) }) as unknown as MatrixData;

	test("within the ceiling, or with none, the whole matrix", () => {
		expect(matrixPreview(shape(1, 5), undefined)).toEqual({ kind: "whole" });
		expect(matrixPreview(shape(1, 5), 5)).toEqual({ kind: "whole" });
		expect(matrixPreview(shape(0, 0), 1)).toEqual({ kind: "whole" });
	});

	test("a row or a column past it: the leading elements and the count left out", () => {
		expect(matrixPreview(shape(1, 100_000), 10)).toEqual({ kind: "elements", shown: 10, leftOut: 99_990 });
		expect(matrixPreview(shape(4, 1), 2)).toEqual({ kind: "elements", shown: 2, leftOut: 2 });
	});

	test("a matrix past it: whole rows, or its shape when not one row fits", () => {
		expect(matrixPreview(shape(3, 3), 7)).toEqual({ kind: "rows", shown: 2, leftOut: 1 });
		expect(matrixPreview(shape(3, 3), 3)).toEqual({ kind: "rows", shown: 1, leftOut: 2 });
		expect(matrixPreview(shape(3, 3), 2)).toEqual({ kind: "shape" });
		expect(matrixPreview(shape(2, 5_000), 1_000)).toEqual({ kind: "shape" });
	});
});

// ── the formatters ────────────────────────────────────────────────────────

describe("formatValue and formatMatrixAligned under the ceiling", () => {
	test("a list shows its first elements and counts the rest", () => {
		expect(formatValue(list(100_000), { matrixResult: { maxElements: 5 } })).toBe("= [0, 10, 20, 30, 40, and 99,995 more]");
		expect(formatMatrixAligned(list(100_000).value as MatrixData, { matrixResult: { maxElements: 5 } })).toBe("[ 0  10  20  30  40 ]\nand 99,995 more");
	});

	test("a column continues with a semicolon, as its next element would", () => {
		expect(formatValue(column(4), { matrixResult: { maxElements: 2 } })).toBe("= [1; 2; and 2 more]");
		expect(formatMatrixAligned(column(4).value as MatrixData, { matrixResult: { maxElements: 2 } })).toBe("[ 1 ]\n[ 2 ]\nand 2 more");
	});

	test("a matrix shows whole rows, or its shape", () => {
		expect(formatValue(grid(3, 3), { matrixResult: { maxElements: 7 } })).toBe("= [1, 2, 3; 4, 5, 6; and 1 more row]");
		expect(formatValue(grid(4, 3), { matrixResult: { maxElements: 3 } })).toBe("= [1, 2, 3; and 3 more rows]");
		expect(formatValue(grid(3, 3), { matrixResult: { maxElements: 2 } })).toBe("= [3x3 matrix]");
		expect(formatMatrixAligned(grid(3, 3).value as MatrixData, { matrixResult: { maxElements: 7 } })).toBe("[ 1  2  3 ]\n[ 4  5  6 ]\nand 1 more row");
		expect(formatMatrixAligned(grid(3, 3).value as MatrixData, { matrixResult: { maxElements: 2 } })).toBe("[3x3 matrix]");
	});

	test("opt-in: without the setting the full text is unchanged, and at the ceiling nothing is cut", () => {
		expect(formatValue(list(12))).toBe("= [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]");
		expect(formatValue(list(3), { matrixResult: { maxElements: 3 } })).toBe("= [0, 10, 20]");
		expect(formatValue(grid(2, 2))).toBe("= [1, 2; 3, 4]");
	});

	test("the count is written the English way under any number locale, as the trace writes it", () => {
		const german = { numberResult: { decimalSeparatorLocale: "de-DE" }, matrixResult: { maxElements: 2 } };
		expect(formatValue(matrixValue(1, 1_002, Array.from({ length: 1_002 }, () => 1.5)), german)).toBe("= [1,50, 1,50, and 1,000 more]");
	});

	test("merged over another settings object, and through engine.formatValue", () => {
		const merged = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, { matrixResult: { maxElements: 2 } });
		expect(formatValue(list(4), merged)).toBe("= [0, 10, and 2 more]");
		const engine = newTrackedEngine();
		expect(engine.formatValue(engine.evaluateExpression("map(10*x, 0:99999)"), { matrixResult: { maxElements: 3 } })).toBe("= [0, 10, 20, and 99,997 more]");
	});

	test("a trace shortens a list in the same form", () => {
		const lines = newTrackedEngine().parseDocument(":scores = map(x * 10, 1:50)\ninputs of line 1").lines;
		expect(formatValue(lines[1].result!)).toBe("= scores [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, and 40 more] (line 1) reads no other line");
	});
});

describe("the time spent formatting (measured)", () => {
	test("100,000 elements with a ceiling of 1,000 cost what a thousand do", () => {
		const big = list(100_000);
		const start = performance.now();
		const text = formatValue(big, { matrixResult: { maxElements: 1_000 } });
		expect(performance.now() - start).toBeLessThan(500);
		expect(text.endsWith("and 99,000 more]")).toBe(true);
	});

	test("100,000 elements in full, through the cached formatter, are well under the seconds they took", () => {
		const start = performance.now();
		const text = formatValue(list(100_000));
		expect(performance.now() - start).toBeLessThan(2_000);
		expect(text.length).toBe(888_791);
	});
});

// ── adversarial ───────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("prototype words in the settings group are ignored, and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const hostile = JSON.parse(`{"matrixResult": {"${word}": 3, "maxElements": 2}}`);
				expect(formatValue(list(4), hostile)).toBe("= [0, 10, and 2 more]");
				const onlyHostile = JSON.parse(`{"matrixResult": {"${word}": {"maxElements": 1}}}`);
				expect(formatValue(list(4), onlyHostile)).toBe("= [0, 10, 20, 30]");
			}
			expect(formatValue(list(4), JSON.parse('{"__proto__": {"matrixResult": {"maxElements": 1}}}'))).toBe("= [0, 10, 20, 30]");
		});
	});

	test("a million elements under a ceiling, and a huge ceiling, stay bounded", () => {
		const million = matrixValue(1, 1_000_000, new Array(1_000_000).fill(7));
		const start = performance.now();
		expect(formatValue(million, { matrixResult: { maxElements: 3 } })).toBe("= [7, 7, 7, and 999,997 more]");
		expect(formatValue(list(3), { matrixResult: { maxElements: Number.MAX_SAFE_INTEGER } })).toBe("= [0, 10, 20]");
		expect(performance.now() - start).toBeLessThan(1_000);
	});

	test("elements that are text-shaped or symbolic are written as they always were", () => {
		const mixed = matrixValue(1, 4, [true, false, 1, 2]);
		expect(formatValue(mixed, { matrixResult: { maxElements: 3 } })).toBe("= [true, false, 1, and 1 more]");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a long list from the line above, through both passes, with the host's ceiling", () => {
		const text = "xs = map(10*x, 0:9999)\nn = 3\nsum(x, xs)\nxs";
		const batch = newTrackedEngine().parseDocument(text).lines.map((l) => (l.result === null ? "" : formatValue(l.result, { matrixResult: { maxElements: 4 } })));
		const incremental = evaluateDocument(newTrackedEngine(), text).lines.map((l) => (l.result === null ? "" : formatValue(l.result, { matrixResult: { maxElements: 4 } })));
		expect(batch).toEqual(incremental);
		expect(batch[0]).toBe("= [0, 10, 20, 30, and 9,996 more]");
		expect(batch[2]).toBe("= 499,950,000");
		expectHonestDocument(text);
	});

	test("a snapshot round trip keeps a list that formats the same under the ceiling", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("xs = map(x^2, 1:2000)");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		const ceiling = { matrixResult: { maxElements: 3 } };
		expect(restored.formatValue(restored.evaluateExpression("xs"), ceiling)).toBe(engine.formatValue(engine.evaluateExpression("xs"), ceiling));
	});
});

describe("adversarial: edge cases", () => {
	test("negative zero, NaN, the infinities, 2^53 and the smallest double as elements", () => {
		const edges = matrixValue(1, 7, [-0, Number.NaN, Infinity, -Infinity, 2 ** 53, 5e-324, -1.005]);
		const full = formatValue(edges);
		expect(full).toBe(formatValue(edges, { matrixResult: { maxElements: 7 } }));
		expect(formatValue(edges, { matrixResult: { maxElements: 2 } })).toBe(`${full.slice(0, full.indexOf(",", full.indexOf(",") + 1))}, and 5 more]`);
		expect(full.startsWith("= [0, ")).toBe(true);
	});

	test("an empty list and a one-element list", () => {
		expect(formatValue(matrixValue(1, 0, []), { matrixResult: { maxElements: 1 } })).toBe("= []");
		expect(formatValue(matrixValue(1, 1, [5]), { matrixResult: { maxElements: 1 } })).toBe("= [5]");
		expect(formatValue(matrixValue(1, 2, [5, 6]), { matrixResult: { maxElements: 1 } })).toBe("= [5, and 1 more]");
	});
});
