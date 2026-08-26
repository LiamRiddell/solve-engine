/**
 * The 2.5.0 statistics aggregates over an inline list: standard deviation,
 * variance, spread and mode (issue #184), and weighted average (issue #185).
 *
 * These extend the existing `average of` / `median of` family, so they are
 * tested the same way, through the real engine (phrase fusion needs it). The
 * canonical population example (`2, 4, 4, 4, 5, 5, 7, 9`) is the one from the
 * issue, chosen because its population standard deviation is exactly 2.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ValueType } from "@solve-js/vm/Value";

const num = (source: string) => newTrackedEngine().evaluateExpression(source).toNumber();

const CLASSIC = "2, 4, 4, 4, 5, 5, 7, 9";

describe("spread and shape aggregates", () => {
	test("population standard deviation is the default", () => {
		expect(num(`standard deviation of ${CLASSIC}`)).toBe(2);
		expect(num(`stdev of ${CLASSIC}`)).toBe(2); // the short spelling
	});

	test("population variance is the default", () => {
		expect(num(`variance of ${CLASSIC}`)).toBe(4);
	});

	test("the sample form is a named variant", () => {
		expect(num(`sample variance of ${CLASSIC}`)).toBeCloseTo(32 / 7, 10);
		expect(num(`sample standard deviation of ${CLASSIC}`)).toBeCloseTo(Math.sqrt(32 / 7), 10);
	});

	test("spread is largest minus smallest", () => {
		expect(num("spread of 3, 7, 2, 9")).toBe(7);
	});

	test("mode is the most frequent value", () => {
		expect(num("mode of 4, 2, 4, 3, 4, 2")).toBe(4);
	});

	test("a tie in the mode is broken by first appearance, so it is deterministic", () => {
		// 1 and 2 both appear twice; 1 reaches the count first.
		expect(num("mode of 1, 1, 2, 2")).toBe(1);
		expect(num("mode of 2, 2, 1, 1")).toBe(2);
	});

	test("a trailing English `and` still ends the list", () => {
		// The same list, its last item joined with "and" rather than a comma.
		expect(num("spread of 3, 7, 2 and 9")).toBe(7);
	});
});

describe("weighted average", () => {
	test("weights are normalised by their own total", () => {
		expect(num("weighted average of 72 at 30%, 88 at 70%")).toBeCloseTo(83.2, 10);
		expect(num("weighted average of 10 at 2, 20 at 3")).toBe(16);
	});

	test("a weight written with a label ignores the label", () => {
		// Grade point average: weights are the credit counts, 3 and 1.
		expect(num("weighted average of 4.0 at 3 credits, 3.0 at 1 credit")).toBe(3.75);
	});

	test("`weighted mean of` is the same form", () => {
		expect(num("weighted mean of 10 at 2, 20 at 3")).toBe(16);
	});

	test("a value with no weight is reported, not given a silent weight of 1", () => {
		// Through the raw single-expression API a malformed expression throws,
		// the caller's cue to show it.
		expect(() => num("weighted average of 72, 88")).toThrow(/weight/i);
	});

	test("in a document the missing weight is a line error, and other lines are unharmed", () => {
		const doc = new DocumentModel();
		doc.setDocument("weighted average of 72, 88\naverage of 1, 2, 3");
		new ThreeTierEvaluator(doc, newTrackedEngine()).evaluate({ startLine: 1, endLine: 2 });
		expect(doc.getLineAt(1)!.result!.type).toBe(ValueType.Error);
		expect(doc.getLineAt(2)!.result!.toNumber()).toBe(2);
	});
});
