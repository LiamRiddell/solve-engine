import { describe, expect, test } from "@jest/globals";
import { isFiniteNumber, lineFailureOf, spanInLine } from "@solve-js/engine/LineDiagnostics";
import type { SourceSpan } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * `spanInLine` runs once for every line that fails, which in a note is every
 * line of prose. It was written with `Number.isFinite`, `Math.min` and
 * `Math.max`, and where the engine runs inside a `vm` context (a Jest
 * environment is one, and the benchmark job runs there) every read of a global
 * goes through the context's interceptor: about 1.3 µs a call against 30 ns
 * without. That made `document-parse/doc_200_prose_warm` 1.33 times its merge
 * base in the benchmark job, after #709 began recording a span for every
 * failed line. It is now written with comparisons, and its answers are the
 * same for every finite argument, to the sign of zero.
 */

/** The implementation before, kept here as the reference the new one must agree with. */
function reference(span: SourceSpan | undefined, lineNumber: number, shift: number, lineLength: number): SourceSpan | null {
	if (span === undefined || !Number.isFinite(span.start) || !Number.isFinite(span.end)) return null;
	const limit = Math.max(0, lineLength);
	const start = Math.min(limit, Math.max(0, span.start + shift));
	const end = Math.min(limit, Math.max(start, span.end + shift));
	return { start, end, line: lineNumber, col: start + 1 };
}

const VALUES = [-1e9, -41, -10, -1, -0.5, -0, 0, 0.5, 1, 3, 7, 10, 40, 41, 1e9, 2 ** 53];
const LENGTHS = [0, -0, 1, 7, 40, 2 ** 53, Infinity];

describe("spanInLine", () => {
	test("agrees with the reference implementation on every finite combination, to the sign of zero", () => {
		const mismatches: string[] = [];
		for (const s of VALUES) {
			for (const e of VALUES) {
				for (const shift of VALUES) {
					for (const len of LENGTHS) {
						const span = { start: s, end: e };
						const got = spanInLine(span, 4, shift, len);
						const want = reference(span, 4, shift, len);
						const same = got !== null && want !== null && Object.is(got.start, want.start) && Object.is(got.end, want.end) && got.col === want.col && got.line === want.line;
						if (!same) mismatches.push(JSON.stringify({ s, e, shift, len, got, want }));
					}
				}
			}
		}
		expect(mismatches.slice(0, 5)).toEqual([]);
	});

	test("ordinary: a span measured against the document moves onto its line", () => {
		expect(spanInLine({ start: 46, end: 50, line: 2, col: 7 }, 2, -40, 41)).toEqual({ start: 6, end: 10, line: 2, col: 7 });
	});

	test("boundary: clamped to the line, and never ending before it starts", () => {
		expect(spanInLine({ start: -5, end: 3 }, 1, 0, 10)).toEqual({ start: 0, end: 3, line: 1, col: 1 });
		expect(spanInLine({ start: 8, end: 99 }, 1, 0, 10)).toEqual({ start: 8, end: 10, line: 1, col: 9 });
		expect(spanInLine({ start: 8, end: 2 }, 1, 0, 10)).toEqual({ start: 8, end: 8, line: 1, col: 9 });
		expect(spanInLine({ start: 3, end: 5 }, 1, 0, 0)).toEqual({ start: 0, end: 0, line: 1, col: 1 });
		const zero = spanInLine({ start: -0, end: -0 }, 1, -0, -0)!;
		expect(Object.is(zero.start, 0) && Object.is(zero.end, 0)).toBe(true);
	});

	test("hostile: no span, offsets or a shift that are not finite numbers, is no span", () => {
		expect(spanInLine(undefined, 1, 0, 10)).toBeNull();
		for (const bad of [Number.NaN, Infinity, -Infinity]) {
			expect(spanInLine({ start: bad, end: 3 }, 1, 0, 10)).toBeNull();
			expect(spanInLine({ start: 1, end: bad }, 1, 0, 10)).toBeNull();
			expect(spanInLine({ start: 1, end: 3 }, 1, bad, 10)).toBeNull();
		}
		expect(spanInLine({ start: "1", end: 3 } as unknown as SourceSpan, 1, 0, 10)).toBeNull();
		// A length that is not a number clamps to an empty line rather than
		// writing NaN into the span.
		expect(spanInLine({ start: 1, end: 3 }, 1, 0, Number.NaN)).toEqual({ start: 0, end: 0, line: 1, col: 1 });
	});

	test("reads no global: its body names neither Math nor Number", () => {
		// Comments name them, to say why; the code must not.
		const body = (spanInLine.toString() + isFiniteNumber.toString()).replace(/\/\/.*$/gm, "");
		expect(body).not.toMatch(/\bMath\.|\bNumber\./);
	});
});

describe("isFiniteNumber", () => {
	test("answers as Number.isFinite does", () => {
		for (const v of [0, -0, 1, -1.5, 2 ** 53, 1e308, -1e308, 5e-324, Number.NaN, Infinity, -Infinity, "1", "", null, undefined, true, {}, [], 1n]) {
			expect({ v: String(v), got: isFiniteNumber(v) }).toEqual({ v: String(v), got: Number.isFinite(v) });
		}
	});
});

describe("what a document line keeps is unchanged", () => {
	test("a prose line keeps its code and its span", () => {
		const lines = newTrackedEngine().parseDocument("1 + 1\nNotes from the quarterly planning session\nNotes from the quarterly planning session").lines;
		for (const line of [lines[1], lines[2]]) {
			expect(line.errorCode).toBe("UNEXPECTED_TRAILING_TOKEN");
			expect(line.errorSpan).toEqual({ start: 6, end: 10, line: line.lineNumber, col: 7 });
		}
	});

	test("lineFailureOf keeps the code, the message and the moved span, and prototype words stay text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const lines = newTrackedEngine().parseDocument(`${word} from the planning session`).lines;
				expect(typeof lines[0].error === "string" || lines[0].result !== null).toBe(true);
			}
		});
		const failure = lineFailureOf(new TypeError("boom"), 3, 0, 5);
		expect(failure).toEqual({ code: "UNEXPECTED_ERROR", message: "boom", span: null });
	});
});
