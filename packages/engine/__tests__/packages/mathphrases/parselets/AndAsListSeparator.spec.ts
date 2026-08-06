/**
 * The word "and" as an English list separator, not just as addition.
 *
 * `and` is a synonym for `+` in this engine ("5 and 3" is 8), which used to be
 * implemented by mapping the word straight onto the PLUS token in the locale
 * keyword table. That made every phrase using "and" to separate a list parse
 * its last two items as one sum:
 *
 *     average of 36, 42, 19 and 81   →  (36 + 42 + (19 + 81)) / 3  =  59.33
 *
 * rather than 178 / 4 = 44.5, which is what Soulver returns and what anyone
 * writing that line means. `total of` hid the bug, because summing four numbers
 * and summing three numbers where two were pre-added give the same answer, and
 * `total of 3, 4, 7 and 9` is the example the original tests used.
 *
 * The word now has its own token type (AND_CONJ) that still compiles to an
 * addition, but binds one step looser than `+`, so a phrase parselet can parse
 * an argument and stop at it. See Token.ts's AND_CONJ comment.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The evaluated number for a single line. */
function evaluate(source: string): number {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("`and` as a list separator", () => {
	test("average counts every item, including the one after `and`", () => {
		// The regression. 178 / 4, not 178 / 3.
		expect(evaluate("average of 36, 42, 19 and 81")).toBeCloseTo(44.5, 10);
	});

	test("median sees the item after `and` as its own value", () => {
		// With `and` folded into an addition this read as [10, 50] and answered
		// 30. The middle of [10, 20, 30] is 20.
		expect(evaluate("median of 10, 20 and 30")).toBe(20);
	});

	test("count counts the item after `and`", () => {
		expect(evaluate("count of 1, 2, 3 and 4")).toBe(4);
	});

	test("total is unchanged, which is why this went unnoticed", () => {
		expect(evaluate("total of 3, 4, 7 and 9")).toBe(23);
	});

	test("a list may be separated entirely by `and`", () => {
		expect(evaluate("average of 10 and 20 and 30")).toBeCloseTo(20, 10);
	});
});

describe("`and` still adds", () => {
	test("between two numbers", () => {
		expect(evaluate("5 and 3")).toBe(8);
	});

	test("binding looser than `*`, so it sums the product", () => {
		expect(evaluate("2 and 3 * 4")).toBe(14);
	});

	test("binding looser than `+`, so a real `+` stays inside one argument", () => {
		// The point of giving `and` its own binding power rather than just
		// stopping the argument at `Product`: "1 + 2" is one item, "4" is another.
		expect(evaluate("average of 1 + 2, 4 and 5")).toBeCloseTo(4, 10);
	});
});

describe("the other phrases that use `and` as a separator", () => {
	test("larger of", () => {
		expect(evaluate("larger of 100 and 200")).toBe(200);
	});

	test("midpoint between", () => {
		expect(evaluate("midpoint between 150 and 300")).toBe(225);
	});

	test("clamp", () => {
		expect(evaluate("clamp 26 between 5 and 25")).toBe(25);
	});

	test("midpoint accepts arithmetic in an operand now that `and` is distinct", () => {
		// Previously impossible: the operand slot had to stop at `Product` to
		// avoid swallowing "and", which also stopped a genuine "+".
		expect(evaluate("midpoint between 100 + 50 and 300")).toBe(225);
	});
});
