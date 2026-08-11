/**
 * Operand types the arithmetic opcodes were not written for.
 *
 * `VMConversion.binaryOp()` dispatches on operand type and ends with a
 * fallback that calls `toNumber()` on both sides. `Value.toNumber()` is
 * documented to answer 0 for anything with no numeric meaning, and the
 * fallback then folds a NaN into 0 as well. Together those two make a whole
 * class of nonsense arithmetic answer a confident, plausible number instead
 * of failing.
 *
 * This codebase has already fought that fight twice and won. `binaryOp()`
 * short-circuits Error and Pending operands at the top with a comment
 * explaining that without it `prev + 1` on a failed line quietly answered 1,
 * and `EXP` grew its own copy of the same guard because `errorValue ^ 2` had
 * silently become 0. The first block below pins those wins, because they are
 * the behaviour the rest of the file argues the remaining types should match.
 *
 * Booleans and strings never got the same treatment, and they reach that
 * fallback. `true + 1` and `false + 1` both answer 1. `"abc" + 1` answers 1
 * too. Those are written below as `test.failing` with the truthful
 * expectation rather than pinned, for the reason the file header of
 * `ArithmeticBigInt.spec.ts` gives about its own gap: writing the current
 * answer down as expected would be writing down the bug.
 *
 * `^` on a BigInt has the same shape of defect and is deliberately not
 * covered here, because `ArithmeticBigInt.spec.ts` already owns and reports
 * it.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("an operand with no numeric meaning propagates rather than becoming zero", () => {
	test("an error value survives every arithmetic operator", () => {
		// `[1,2][9]` is an out-of-bounds index, which the VM reports as an Error
		// VALUE rather than a throw, so it is the cheapest way to get one onto
		// the stack as an operand. Each of these would answer a number if the
		// error were read through toNumber().
		for (const source of ["[1,2][9] + 1", "[1,2][9] - 1", "[1,2][9] * 2", "[1,2][9] / 2", "[1,2][9] ^ 2", "[1,2][9] mod 2"]) {
			expect(evaluate(source).type).toBe(ValueType.Error);
		}
	});

	test("the error keeps its own message rather than being replaced", () => {
		// A generic "something went wrong" here would be almost as bad as a
		// zero: the point of propagating is that the reader learns which line
		// actually failed.
		const value = evaluate("[1,2][9] * 2");
		expect(String(value.unit ?? value.value)).toMatch(/out of bounds/i);
	});

	test("an error on the right-hand side propagates too", () => {
		expect(evaluate("1 + [1,2][9]").type).toBe(ValueType.Error);
		expect(evaluate("2 * [1,2][9]").type).toBe(ValueType.Error);
	});

	test("a symbolic operand builds a formula rather than folding to zero", () => {
		// The third member of the same family, and the one whose comment in
		// `EXP` records that `x^2` used to evaluate to 0.
		expect(evaluate("x + 1 =>").type).toBe(ValueType.Symbolic);
		expect(evaluate("x^2 =>").type).toBe(ValueType.Symbolic);
	});
});

describe("a boolean operand", () => {
	test("boolean-only operations work, so the type is real", () => {
		expect(evaluate("true").type).toBe(ValueType.Boolean);
		expect(evaluate("true and true").value).toBe(true);
		expect(evaluate("true and false").value).toBe(false);
		expect(evaluate("true > false").type).toBe(ValueType.Boolean);
	});

	test("is not silently worth zero in arithmetic", () => {
		// `Value.toNumber()` used to have no Boolean branch. A Boolean payload
		// is not a number so the eager cache was skipped, not a bigint so the
		// bigint branch was skipped, and it reached `parseFloat(value)`, which
		// stringifies `true` to "true", yields NaN, and folds to 0. Both
		// booleans therefore weighed exactly nothing:
		//
		//   true + 1   = 1      false + 1  = 1
		//   true * 2   = 0      true - 1   = -1
		//
		// Whether a boolean should be worth 1 and 0 or should refuse to do
		// arithmetic at all was a design call, resolved as 1 and 0. What it
		// cannot do is answer the same as its own opposite, which is the
		// assertion here.
		expect(num("true + 1")).not.toBe(num("false + 1"));
	});

	test("and it converts as one and zero", () => {
		// The conventional resolution of the choice above, stated separately so
		// that a change of mind that instead makes boolean arithmetic an error
		// only has to touch this one and not the previous one.
		expect(num("true + 1")).toBe(2);
		expect(num("false + 1")).toBe(1);
		expect(num("true * 2")).toBe(2);
	});
});

describe("a string operand", () => {
	test("a string literal produces a String value", () => {
		expect(evaluate("\"abc\"").type).toBe(ValueType.String);
	});

	test("carrying the text between the quotes and not the quotes", () => {
		// `PrecedenceParser.parsePrefix` emits `PUSH_STRING` with `token.value`,
		// and `ExpressionLexer.tokenizeString()` used to set that to
		// `input.slice()` across the whole literal, delimiters included, so the
		// payload of `"abc"` was the five characters `"abc"` rather than the
		// three characters `abc`.
		//
		// It was invisible on screen, because `formatString()` prints the
		// payload raw and the retained quotes landed exactly where a display
		// would have put them back. It was not invisible to anything that reads
		// `.value`, and it was not invisible to `toNumber()`: see the next test.
		//
		// `tokenizeString()` now strips the delimiters when it builds the token.
		// The token's `text` still holds the quoted source slice, because that
		// is the span a host underlines.
		expect(evaluate("\"abc\"").value).toBe("abc");
		expect(evaluate("\"5\"").value).toBe("5");
	});

	test.failing("is not silently worth zero in arithmetic", () => {
		// The truthful expectation, failing today. Same fallback as the boolean
		// case, reached for a different reason: `parseFloat` of a string that
		// starts with a quote is NaN whatever the digits after it say, so every
		// string weighs nothing.
		//
		//   "a" + "b"   = 0    (a plain Number 0, not a string and not an error)
		//   "abc" + 1   = 1
		//   "3" * "4"   = 0
		//   "5" + 5     = 5
		//
		// The last one is the clearest: a reader who writes it means either 10
		// or "55", and 5 is neither. Concatenation is not the claim being made
		// here, only that arithmetic on a string must not answer as though the
		// string were absent.
		const engine = newTrackedEngine("en");
		const sum = engine.evaluateExpression("\"abc\" + 1")[0];
		expect(sum.type).not.toBe(ValueType.Number);
	});

	test("and a string that never closes is not accepted as a string", () => {
		// `tokenizeString()` used to run off the end of the input and return
		// what it had, so `"abc` lexed to a String rather than to an
		// unterminated-literal error. Combined with the retained delimiters
		// above, an unterminated literal was indistinguishable from a
		// terminated one by payload shape, which is why the two were fixed
		// together. It now raises UNTERMINATED_STRING.
		const engine = newTrackedEngine("en");
		let threw = false;
		try {
			engine.evaluateExpression("\"abc");
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});
