/**
 * Magnitudes written as words: `3 million` rather than only `3M`.
 *
 * The single-letter suffixes have always worked, but only when written
 * touching the number, which is the right rule for letters and the wrong one
 * for words. `3 million` is how the number is normally written and it used to
 * fail with "Undefined variable: million".
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function num(source: string): number {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("magnitudes as words", () => {
	test("thousand", () => {
		expect(num("3 thousand")).toBe(3_000);
	});

	test("million", () => {
		expect(num("3 million")).toBe(3_000_000);
	});

	test("billion", () => {
		expect(num("5 billion")).toBe(5_000_000_000);
	});

	test("trillion", () => {
		expect(num("2 trillion")).toBe(2_000_000_000_000);
	});

	test("the abbreviations", () => {
		expect(num("2.5 bn")).toBe(2_500_000_000);
		expect(num("4 mn")).toBe(4_000_000);
		expect(num("1 tn")).toBe(1_000_000_000_000);
	});

	test("plurals, since people write them", () => {
		expect(num("3 millions")).toBe(3_000_000);
	});

	test("case does not matter for a word", () => {
		expect(num("3 Million")).toBe(3_000_000);
	});

	test("a decimal amount", () => {
		expect(num("1.5 million")).toBe(1_500_000);
	});
});

describe("words compose with the rest of the language", () => {
	test("with currency", () => {
		expect(num("$10 million")).toBe(10_000_000);
	});

	test("with a percentage increase", () => {
		// Soulver's own example, and it exercises the relative-percentage rule
		// at the same time: 3,000,000 × 1.1.
		expect(num("3 million + 10%")).toBeCloseTo(3_300_000, 6);
	});

	test("in ordinary arithmetic", () => {
		expect(num("2 million + 500 thousand")).toBe(2_500_000);
	});
});

describe("what the words must not break", () => {
	test("the letter suffixes still require adjacency", () => {
		expect(num("5k")).toBe(5_000);
		expect(num("5M")).toBe(5_000_000);
	});

	test("`5 m` is still five metres, not five million", () => {
		// "m" is deliberately not a word magnitude. This is the collision the
		// letter table's own doc comment has always guarded against, and adding
		// spaced words must not reopen it.
		const engine = newTrackedEngine("en");
		const [value] = engine.evaluateExpression("5 m in cm");
		expect(value.toNumber()).toBeCloseTo(500, 6);
	});

	test("`million` is still usable as a variable name", () => {
		const engine = newTrackedEngine("en");
		engine.evaluateExpression(":million = 7");
		const [value] = engine.evaluateExpression(":million + 1");
		expect(value.toNumber()).toBe(8);
	});
});
