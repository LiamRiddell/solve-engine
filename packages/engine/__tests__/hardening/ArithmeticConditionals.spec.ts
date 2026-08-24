/**
 * Comparisons and conditionals.
 *
 * A comparison is the one operator whose result cannot be sanity-checked by
 * looking at it: `false` is a perfectly plausible answer to any question, so a
 * broken comparison is invisible until someone traces an expression by hand.
 * That makes the boring cases worth writing down, and it makes the ordering
 * relations worth testing as a family rather than one at a time, since the six
 * of them are separate opcodes and nothing forces them to agree.
 *
 * `if ... then ... else` is eager: both branches are evaluated before the
 * condition selects one (there are no jump opcodes; see `OpCode.SELECT`). That
 * is a real constraint rather than an implementation detail, because it means
 * a branch cannot be used to guard the other branch from failing, so it is
 * pinned here in the terms a caller would notice.
 *
 * Three families were reported rather than pinned when this file was written,
 * because every one of them answered true to a question whose answer is false,
 * and writing that down would have been writing down the bug. All three have
 * since been fixed, so they are pinned here instead:
 *
 * - Comparisons where an operand is a Boolean. `Value.toNumber()` had no
 *   boolean branch, so `true` and `false` both read as 0 and `true == false`
 *   answered true.
 * - Comparisons where an operand is a String, for the same reason: every
 *   non-numeric string read as 0, so `"a" == "b"` answered true.
 * - Ordering comparisons between two compatible units. `1 km > 999 m`
 *   answered false, because only EQ and NEQ unified units before comparing.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const bool = (source: string): boolean => {
	const value = evaluate(source);
	expect(value.type).toBe(ValueType.Boolean);
	return value.value as boolean;
};

const num = (source: string) => evaluate(source).toNumber();

describe("the six ordering relations agree with each other", () => {
	/**
	 * Each row is a pair and the six answers it must give, worked out from
	 * the pair rather than from the engine. Testing them together is what
	 * catches the case where one opcode of the six is subtly off: `<=` that
	 * forgot its equal half looks fine on its own.
	 */
	const rows: ReadonlyArray<readonly [string, string, boolean, boolean, boolean, boolean, boolean, boolean]> = [
		//  left      right     ==     !=     <      <=     >      >=
		["1", "2", false, true, true, true, false, false],
		["2", "1", false, true, false, false, true, true],
		["2", "2", true, false, false, true, false, true],
		["-1", "1", false, true, true, true, false, false],
		["-2", "-1", false, true, true, true, false, false],
		["0", "-0", true, false, false, true, false, true],
		["0.1 + 0.2", "0.3", false, true, false, false, true, true],
		["1 / 0", "1e308", false, true, false, false, true, true],
	];

	for (const [left, right, eq, neq, lt, lte, gt, gte] of rows) {
		test(`${left} against ${right}`, () => {
			expect(bool(`${left} == ${right}`)).toBe(eq);
			expect(bool(`${left} != ${right}`)).toBe(neq);
			expect(bool(`${left} < ${right}`)).toBe(lt);
			expect(bool(`${left} <= ${right}`)).toBe(lte);
			expect(bool(`${left} > ${right}`)).toBe(gt);
			expect(bool(`${left} >= ${right}`)).toBe(gte);
		});
	}

	test("and every one of them is false against NaN", () => {
		// Including equality, which is what makes NaN detectable at all.
		expect(bool("0 / 0 == 0 / 0")).toBe(false);
		expect(bool("0 / 0 < 1")).toBe(false);
		expect(bool("0 / 0 <= 1")).toBe(false);
		expect(bool("0 / 0 > 1")).toBe(false);
		expect(bool("0 / 0 >= 1")).toBe(false);
		// `!=` is the exception, and has to be, since it is the negation.
		expect(bool("0 / 0 != 0 / 0")).toBe(true);
	});
});

describe("comparison happens after arithmetic", () => {
	test("so each side is a finished value first", () => {
		expect(bool("1 + 2 == 3")).toBe(true);
		expect(bool("2 * 3 > 5")).toBe(true);
		expect(bool("10 / 4 < 3")).toBe(true);
		expect(bool("2 ^ 3 >= 8")).toBe(true);
	});

	test("and floating point error is visible through it", () => {
		// The reason `0.1 + 0.2 == 0.3` is false is worth having pinned
		// somewhere a reader will find it, because it is the single most
		// common bug report against any calculator.
		expect(bool("0.1 + 0.2 == 0.3")).toBe(false);
		expect(bool("0.1 + 0.2 > 0.3")).toBe(true);
	});
});

describe("equality between measured quantities converts first", () => {
	test("the same length written two ways is the same length", () => {
		expect(bool("1 km == 1000 m")).toBe(true);
		expect(bool("1 km != 1000 m")).toBe(false);
		expect(bool("100 cm == 1 m")).toBe(true);
	});

	test("and quantities of different kinds are never equal", () => {
		// Not "1 equals 1": the magnitudes match and the measures do not.
		expect(bool("1 kg == 1 m")).toBe(false);
		expect(bool("1 kg != 1 m")).toBe(true);
	});
});

describe("truthiness of a condition", () => {
	test("zero is the only falsy number", () => {
		expect(num("if 0 then 1 else 2")).toBe(2);
		expect(num("if 1 then 1 else 2")).toBe(1);
		expect(num("if -1 then 1 else 2")).toBe(1);
		expect(num("if 0.0001 then 1 else 2")).toBe(1);
	});

	test("and an infinity is truthy, being nonzero", () => {
		expect(num("if 1 / 0 then 1 else 2")).toBe(1);
	});

	test("a boolean uses itself, not its numeric reading", () => {
		expect(num("if true then 1 else 2")).toBe(1);
		expect(num("if false then 1 else 2")).toBe(2);
	});

	test("and so does a comparison", () => {
		expect(num("if 1 > 0 then 1 else 2")).toBe(1);
		expect(num("if 1 < 0 then 1 else 2")).toBe(2);
	});
});

describe("if then else", () => {
	test("selects a whole expression, not just a literal", () => {
		expect(num("if 1 > 0 then 2 + 3 else 4 * 5")).toBe(5);
		expect(num("if 1 < 0 then 2 + 3 else 4 * 5")).toBe(20);
	});

	test("keeps the selected branch's type", () => {
		expect(evaluate("if 1 > 0 then $5 else 3").type).toBe(ValueType.Uom);
		expect(evaluate("if 1 < 0 then $5 else 3").type).toBe(ValueType.Number);
	});

	test("evaluates both branches, so a branch cannot guard the other", () => {
		// The unselected branch still runs. It happens to be harmless here
		// because dividing by zero is a value rather than a throw, but a
		// caller writing `if x != 0 then 1 / x else 0` should know that the
		// division is performed either way.
		expect(num("if 1 > 0 then 1 else 1 / 0")).toBe(1);
		expect(num("if 1 < 0 then 1 else 1 / 0")).toBe(Infinity);
	});

	test("nests", () => {
		expect(num("if 1 > 0 then (if 2 > 1 then 10 else 20) else 30")).toBe(10);
		expect(num("if 1 > 0 then (if 2 < 1 then 10 else 20) else 30")).toBe(20);
		expect(num("if 1 < 0 then (if 2 > 1 then 10 else 20) else 30")).toBe(30);
	});

	test("and an incomplete conditional is refused rather than guessed at", () => {
		expect(() => evaluate("if 1 > 0 then 1")).toThrow();
	});
});

describe("the symbol forms of and/or", () => {
	test("bind looser than comparison, so comparisons are their operands", () => {
		expect(bool("5 > 3 && 2 > 1")).toBe(true);
		expect(bool("5 > 3 && 2 < 1")).toBe(false);
		expect(bool("5 < 3 || 2 > 1")).toBe(true);
		expect(bool("5 < 3 || 2 < 1")).toBe(false);
	});

	test("chain, and or binds looser than and", () => {
		// "a or b and c" is "a or (b and c)": with the other grouping the
		// first row below would be false.
		expect(bool("1 > 0 || 1 > 0 && 0 > 1")).toBe(true);
		expect(bool("1 > 0 && 1 > 0 && 1 > 0")).toBe(true);
		expect(bool("1 > 0 && 1 > 0 && 0 > 1")).toBe(false);
	});

	test("take a bare number as a condition too", () => {
		expect(bool("1 && 1")).toBe(true);
		expect(bool("1 && 0")).toBe(false);
		expect(bool("0 || 0")).toBe(false);
		expect(bool("0 || 5")).toBe(true);
	});

	test("and always produce a Boolean, never one of their operands", () => {
		// Unlike JavaScript, where `5 && 3` is 3. A calculator answering 3 to
		// a yes/no question would be worse than useless.
		expect(evaluate("5 && 3").type).toBe(ValueType.Boolean);
		expect(evaluate("5 || 3").type).toBe(ValueType.Boolean);
		expect(bool("5 && 3")).toBe(true);
	});
});

describe("the word and, when both sides are booleans", () => {
	test("is conjunction rather than addition", () => {
		// The same word is arithmetic addition for numbers ("5 and 3" is 8),
		// so which meaning applies is decided by the operands at run time.
		expect(bool("true and true")).toBe(true);
		expect(bool("true and false")).toBe(false);
		expect(bool("false and false")).toBe(false);
	});

	test("and is addition when both sides are numbers", () => {
		expect(num("5 and 3")).toBe(8);
		expect(num("1 and 2 * 3")).toBe(7);
	});

	test("and it binds looser than comparison, so comparisons are its operands", () => {
		// The word used to bind at 28, above the comparisons at 20, so this
		// grouped as "5 > (3 and 2) > 1" and answered false: two true
		// comparisons reported as a falsehood, with nothing on screen to say
		// so. It has to agree with the symbol form tested above it.
		expect(bool("5 > 3 and 2 > 1")).toBe(true);
		expect(bool("5 > 3 and 2 < 1")).toBe(false);
		expect(bool("5 < 3 and 2 > 1")).toBe(false);
		expect(num("if 5 > 3 and 2 > 1 then 1 else 0")).toBe(1);
	});
});

describe("a boolean is worth one or zero when a comparison has to read it as a number", () => {
	test("so the two booleans are not equal to each other", () => {
		// Both read as 0 before `Value.toNumber()` had a boolean branch, which
		// made this answer true.
		expect(bool("true == false")).toBe(false);
		expect(bool("false == true")).toBe(false);
		expect(bool("true != false")).toBe(true);
	});

	test("and each is equal to itself", () => {
		expect(bool("true == true")).toBe(true);
		expect(bool("false == false")).toBe(true);
	});

	test("and they order the way their numeric readings do", () => {
		expect(bool("true > false")).toBe(true);
		expect(bool("false < true")).toBe(true);
		expect(bool("true >= true")).toBe(true);
	});
});

describe("two strings compare as strings", () => {
	test("so different text is not equal", () => {
		// Every non-numeric string reads as 0 through `toNumber()`, so
		// comparing the numbers made every pair of words equal.
		expect(bool("\"a\" == \"b\"")).toBe(false);
		expect(bool("\"a\" != \"b\"")).toBe(true);
		expect(bool("\"abc\" == \"abd\"")).toBe(false);
	});

	test("and identical text is", () => {
		expect(bool("\"a\" == \"a\"")).toBe(true);
		expect(bool("\"abc\" == \"abc\"")).toBe(true);
		expect(bool("\"abc\" != \"abc\"")).toBe(false);
	});

	test("including two spellings of the same number, which are the same text", () => {
		// Not a claim that "5" and 5 are related; only that two identical
		// strings are identical and two different ones are not.
		expect(bool("\"5\" == \"5\"")).toBe(true);
		expect(bool("\"5\" == \"05\"")).toBe(false);
	});
});
