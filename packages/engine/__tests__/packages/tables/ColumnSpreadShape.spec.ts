/**
 * The 2.5.0 spread and shape aggregates over a markdown table column (issue
 * #184): the column siblings of `standard deviation of ...`, `variance of ...`,
 * `spread of ...` and `mode of ...`. They read the nearest table above the
 * query line, the same plumbing `sum of column` / `average of column` use.
 */

import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a whole document and return the numeric result of its last line. */
function lastNumber(lines: string[]): number {
	const engine = newTrackedEngine();
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: lines.length });
	return doc.getLineAt(lines.length)!.result!.toNumber();
}

// The issue's canonical population set, as a column.
const TABLE = [
	"| reading | score |",
	"| --- | --- |",
	"| a | 2 |",
	"| b | 4 |",
	"| c | 4 |",
	"| d | 4 |",
	"| e | 5 |",
	"| f | 5 |",
	"| g | 7 |",
	"| h | 9 |",
];

describe("spread and shape of a table column", () => {
	test('standard deviation of column "score" above', () => {
		expect(lastNumber([...TABLE, 'standard deviation of column "score" above'])).toBe(2);
	});

	test('variance of column "score" above', () => {
		expect(lastNumber([...TABLE, 'variance of column "score" above'])).toBe(4);
	});

	test('the sample form of a column', () => {
		expect(lastNumber([...TABLE, 'sample standard deviation of column "score" above'])).toBeCloseTo(Math.sqrt(32 / 7), 10);
		expect(lastNumber([...TABLE, 'sample variance of column "score" above'])).toBeCloseTo(32 / 7, 10);
	});

	test('spread of column "score" above is largest minus smallest', () => {
		expect(lastNumber([...TABLE, 'spread of column "score" above'])).toBe(7);
	});

	test('mode of column "score" above is the most frequent cell', () => {
		expect(lastNumber([...TABLE, 'mode of column "score" above'])).toBe(4);
	});
});
