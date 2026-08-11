/**
 * Operator precedence and associativity, checked against a reference rather
 * than against itself.
 *
 * A precedence bug does not throw and does not look wrong: `2 + 3 * 4` answers
 * 20 instead of 14 and nothing anywhere reports a problem. The only way to
 * catch one is to know the answer before asking, so each case here carries the
 * parenthesised form it is claimed to be equivalent to, and the equivalence is
 * asserted as well as the number. If the parser ever regroups an expression,
 * the two halves of the assertion stop agreeing.
 *
 * Two operator families were once deliberately absent from this file, because
 * the engine disagreed with its own comments about them. Both are now settled
 * and both are pinned below.
 *
 * `^` groups to the RIGHT: `2^3^2` is 2^(3^2) = 512. That is what mathematics,
 * Python, Ruby, Wolfram and JavaScript's `**` all do, and what
 * `BindingPower.ts` and `PrecedenceParser.ts` had always claimed in comments
 * while the code grouped left and answered 64.
 *
 * The shifts and the bitwise trio rank as they do in C and JavaScript: `|`
 * loosest, then `xor`, then `&`, all three looser than comparison, then the
 * shifts, then `+`. They used to share a single level between `+` and `*`,
 * which no language does.
 *
 * The reference for every bitwise and shift expectation below is the same
 * expression evaluated in JavaScript, computed separately and written in by
 * hand rather than read back off this engine.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

/**
 * Assert that `source` means `parenthesised`, and that both mean `expected`.
 *
 * Checking the pair is what makes this a precedence test rather than an
 * arithmetic test: a wrong `expected` would fail loudly, but a parser that
 * regrouped BOTH forms the same wrong way would still be caught by nothing
 * else.
 */
function groupsAs(source: string, parenthesised: string, expected: number): void {
	expect(num(source)).toBe(expected);
	expect(num(parenthesised)).toBe(expected);
}

describe("multiplication and division outrank addition and subtraction", () => {
	test("a product inside a sum", () => {
		groupsAs("2 + 3 * 4", "2 + (3 * 4)", 14);
		groupsAs("2 * 3 + 4", "(2 * 3) + 4", 10);
	});

	test("a quotient inside a difference", () => {
		groupsAs("10 - 8 / 4", "10 - (8 / 4)", 8);
		groupsAs("10 / 5 - 1", "(10 / 5) - 1", 1);
	});

	test("all four together", () => {
		// 1 + 6 - 2. Computed by hand, not by asking the engine twice.
		groupsAs("1 + 2 * 3 - 4 / 2", "1 + (2 * 3) - (4 / 2)", 5);
	});

	test("negative operands do not change the grouping", () => {
		groupsAs("-2 + 3 * 4", "-2 + (3 * 4)", 10);
		groupsAs("2 - 3 * -4", "2 - (3 * -4)", 14);
	});
});

describe("same-precedence operators group to the left", () => {
	test("subtraction, where the difference is visible", () => {
		// Right grouping would be 10 - (3 - 2) = 9.
		groupsAs("10 - 3 - 2", "(10 - 3) - 2", 5);
		expect(num("10 - (3 - 2)")).toBe(9);
	});

	test("division, likewise", () => {
		// Right grouping would be 100 / (10 / 2) = 20.
		groupsAs("100 / 10 / 2", "(100 / 10) / 2", 5);
		expect(num("100 / (10 / 2)")).toBe(20);
	});

	test("a mixed product and quotient chain", () => {
		groupsAs("10 / 2 * 5", "(10 / 2) * 5", 25);
		expect(num("10 / (2 * 5)")).toBe(1);
	});

	test("modulo sits with multiplication and groups left", () => {
		groupsAs("6 mod 4 * 2", "(6 mod 4) * 2", 4);
		groupsAs("2 * 3 mod 4", "(2 * 3) mod 4", 2);
		groupsAs("2 + 3 mod 2", "2 + (3 mod 2)", 3);
		groupsAs("7 mod 3 + 1", "(7 mod 3) + 1", 2);
	});
});

describe("exponentiation outranks multiplication and unary minus", () => {
	test("a power inside a product", () => {
		groupsAs("2 * 3 ^ 2", "2 * (3 ^ 2)", 18);
		groupsAs("2 ^ 3 * 2", "(2 ^ 3) * 2", 16);
	});

	test("a power inside a sum", () => {
		groupsAs("1 + 2 ^ 3 * 4", "1 + ((2 ^ 3) * 4)", 33);
	});

	test("a parenthesised base is raised as a whole", () => {
		groupsAs("2 * (3 + 4) ^ 2", "2 * ((3 + 4) ^ 2)", 98);
	});

	test("a negative exponent is a reciprocal, not a subtraction", () => {
		groupsAs("2 ^ -1", "1 / 2", 0.5);
		groupsAs("2 ^ -2", "1 / 4", 0.25);
	});
});

describe("a chain of exponents groups to the right", () => {
	test("the two-operator case, where the two groupings differ by 448", () => {
		// 2^(3^2) = 2^9 = 512, which is what `2 ** 3 ** 2` gives in
		// JavaScript and what Python, Ruby and Wolfram give. The other
		// grouping is (2^3)^2 = 64, which is what a pocket calculator gives
		// and what this engine used to give while both of its own source
		// comments said it did the opposite.
		groupsAs("2 ^ 3 ^ 2", "2 ^ (3 ^ 2)", 512);
		expect(num("(2 ^ 3) ^ 2")).toBe(64);
	});

	test("and keeps going right however long the chain is", () => {
		// 2^(2^(2^2)) = 2^(2^4) = 2^16. Left grouping would be 256.
		groupsAs("2^2^2^2", "2^(2^(2^2))", 65536);
		expect(num("((2^2)^2)^2")).toBe(256);
	});

	test("without disturbing the operators around it", () => {
		groupsAs("1 + 2 ^ 3 ^ 2", "1 + (2 ^ (3 ^ 2))", 513);
		groupsAs("2 * 2 ^ 2 ^ 2", "2 * (2 ^ (2 ^ 2))", 32);
	});

	test("and without moving unary minus, which still binds tighter", () => {
		// The base is negated before the power is applied, so this is
		// (-2)^2 rather than -(2^2). Excel agrees; C-family languages have no
		// `^` power operator to compare against, and Python's `**` binds
		// tighter than unary minus, so this one is a genuine convention
		// choice rather than a portability question. It is unchanged by
		// making `^` right-associative, and this pins that.
		expect(num("-2 ^ 2")).toBe(4);
		// (-2)^(3^2) = (-2)^9.
		expect(num("-2 ^ 3 ^ 2")).toBe(-512);
	});
});

describe("the shifts and the bitwise operators rank as they do in C and JavaScript", () => {
	test("addition binds tighter than a shift", () => {
		// `1 + 2 << 3` is 24 in JavaScript, not 17: the sum happens first.
		groupsAs("1 + 2 << 3", "(1 + 2) << 3", 24);
		groupsAs("8 >> 1 + 1", "8 >> (1 + 1)", 2);
		groupsAs("1 << 2 + 3", "1 << (2 + 3)", 32);
	});

	test("and tighter than the bitwise trio as well", () => {
		// `4 & 3 + 1` is 4 in JavaScript, not 1.
		groupsAs("4 & 3 + 1", "4 & (3 + 1)", 4);
		groupsAs("1 - 2 & 3", "(1 - 2) & 3", 3);
		groupsAs("5 & 3 + 1 * 2", "5 & (3 + (1 * 2))", 5);
	});

	test("inside the trio, and beats xor beats or", () => {
		groupsAs("4 | 6 & 3", "4 | (6 & 3)", 6);
		groupsAs("1 | 2 xor 3", "1 | (2 xor 3)", 1);
		groupsAs("6 xor 3 & 1", "6 xor (3 & 1)", 7);
		groupsAs("12 & 10 | 1", "(12 & 10) | 1", 9);
	});

	test("and a shift beats all three", () => {
		groupsAs("16 >> 3 & 1", "(16 >> 3) & 1", 0);
		groupsAs("16 >> 3 | 1", "(16 >> 3) | 1", 3);
		groupsAs("8 >> 1 & 3", "(8 >> 1) & 3", 0);
	});

	test("the three shifts share one level and group left", () => {
		groupsAs("1 << 2 << 3", "(1 << 2) << 3", 32);
		groupsAs("256 >> 2 >> 2", "(256 >> 2) >> 2", 16);
		// `>>>` had no fast-path entry at all and ran a level looser than its
		// two siblings, so the same expression answered differently depending
		// only on which spelling of right shift was typed.
		groupsAs("16 >>> 3 & 1", "(16 >>> 3) & 1", 0);
		groupsAs("1 + 2 >>> 1", "(1 + 2) >>> 1", 1);
	});

	test("same-level bitwise operators group left, like every other level", () => {
		groupsAs("7 & 3 & 1", "(7 & 3) & 1", 1);
		groupsAs("1 | 2 | 4", "(1 | 2) | 4", 7);
	});
});

describe("parentheses", () => {
	test("override precedence in both directions", () => {
		expect(num("(1 + 2) * 3")).toBe(9);
		expect(num("1 + 2 * 3")).toBe(7);
		expect(num("(2 + 3) ^ 2")).toBe(25);
		expect(num("2 + 3 ^ 2")).toBe(11);
	});

	test("nest to arbitrary depth without shifting the answer", () => {
		expect(num("((((1 + 2)))) * 3")).toBe(9);
		expect(num("100 / (2 + 3) * 4")).toBe(80);
		expect(num("(1 + 2) * (3 - 4) / 2")).toBe(-1.5);
	});

	test("a number against a parenthesised group multiplies implicitly", () => {
		expect(num("2(3)")).toBe(6);
		expect(num("2(3 + 4)")).toBe(14);
	});
});

describe("unary signs", () => {
	test("stack, each one flipping", () => {
		expect(num("- -5")).toBe(5);
		expect(num("--5")).toBe(5);
		expect(num("+-5")).toBe(-5);
		expect(num("1 - -1")).toBe(2);
	});

	test("bind tighter than multiplication, which cannot change the answer", () => {
		// -2 * 3 and -(2 * 3) are the same number either way, which is why
		// this pair is safe to pin and the `-2 ^ 2` pair is not.
		groupsAs("-2 * 3", "-(2 * 3)", -6);
		groupsAs("-6 / 3", "-(6 / 3)", -2);
	});
});

describe("comparison binds looser than arithmetic", () => {
	test("so both sides are fully evaluated before comparing", () => {
		expect(evaluate("1 + 2 > 2").value).toBe(true);
		expect(evaluate("1 + 2 > 4").value).toBe(false);
		expect(evaluate("2 * 3 == 5 + 1").value).toBe(true);
		expect(evaluate("10 / 2 == 4").value).toBe(false);
	});
});
