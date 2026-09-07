/**
 * `min of column` on a long column answers instead of overflowing the stack.
 *
 * The three reductions that take an extreme were written as `Math.min(...cells)`,
 * which makes the whole column into an argument list. Past roughly 126,000
 * arguments V8 overflows, so a table inside the engine's own document-line cap
 * came back as "Maximum call stack size exceeded" — through `evaluateLine` as a
 * thrown `EngineError` rather than as a value. `sum` on the byte-identical table
 * always answered, because it folds, and that is what isolated the cause.
 *
 * The control below is the load-bearing part of this spec: it asserts the raw
 * spread form still throws at the size the document uses, so if a future V8
 * raises the argument limit the test says so rather than passing vacuously.
 */
import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Comfortably past the argument-count cliff measured on a default Node stack. */
const ROWS = 130_000;

/** A markdown table of `rows` numeric cells, then each trailing line verbatim. */
function tableDocument(rows: number, trailing: string[]): string[] {
	const lines = ["| item | n |", "| --- | --- |"];
	for (let i = 0; i < rows; i++) lines.push(`| r${i} | ${i + 1} |`);
	return [...lines, ...trailing];
}

describe("a column longer than the spread-argument limit", () => {
	// One document, one evaluation: building 130,000 rows is the expensive part.
	const trailing = [
		'min of column "n" above',
		'max of column "n" above',
		'spread of column "n" above',
		'sum of column "n" above',
	];
	const lines = tableDocument(ROWS, trailing);
	const engine = newTrackedEngine();
	const doc = new DocumentModel(400_000);
	doc.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: lines.length });

	/** The display of the nth trailing line, counted from the end. */
	const trailingResult = (offsetFromEnd: number): string => {
		const result = doc.getLineAt(lines.length - offsetFromEnd)!.result;
		return result === null || result === undefined ? "(none)" : formatValue(result).replace(/^=\s*/, "");
	};

	test("min answers rather than overflowing", () => {
		expect(trailingResult(3)).toBe("1");
	});

	test("max answers rather than overflowing", () => {
		expect(trailingResult(2)).toBe("130,000");
	});

	test("spread answers rather than overflowing", () => {
		expect(trailingResult(1)).toBe("129,999");
	});

	test("and sum, which always worked, is unchanged", () => {
		// 1 + 2 + ... + 130,000.
		expect(trailingResult(0)).toBe("8,450,065,000");
	});

	test("the control: the spread form really does still throw at this size", () => {
		const cells = Array.from({ length: ROWS }, (_, i) => i + 1);
		expect(() => Math.min(...cells)).toThrow(RangeError);
		// And the fold this replaced it with does not.
		expect(cells.reduce((acc, n) => Math.min(acc, n), Infinity)).toBe(1);
	});
});

describe("the identities the fold has to preserve", () => {
	/** Evaluate a small table and return the trailing line's display. */
	const smallTable = (trailing: string): string => {
		const lines = tableDocument(4, [trailing]);
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: lines.length });
		try {
			const result = doc.getLineAt(lines.length)!.result;
			return result === null || result === undefined ? "(none)" : formatValue(result).replace(/^=\s*/, "");
		} finally {
			engine.clear();
		}
	};

	test("an ordinary short column reads exactly as it did", () => {
		expect(smallTable('min of column "n" above')).toBe("1");
		expect(smallTable('max of column "n" above')).toBe("4");
		expect(smallTable('spread of column "n" above')).toBe("3");
		expect(smallTable('sum of column "n" above')).toBe("10");
	});

	test("no cells is the identity the spread form returned", () => {
		// `Math.min()` is Infinity and `Math.max()` is -Infinity, and the fold is
		// seeded with exactly those, so an empty column cannot change meaning.
		expect([].reduce((acc: number, n: number) => Math.min(acc, n), Infinity)).toBe(Math.min());
		expect([].reduce((acc: number, n: number) => Math.max(acc, n), -Infinity)).toBe(Math.max());
	});
});
