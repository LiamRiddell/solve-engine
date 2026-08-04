/**
 * Bitwise complement and unsigned right shift.
 *
 * Both were declared and unreachable. `~` had an opcode, a lexer token and a VM
 * implementation, and no prefix parselet, so it lexed fine and then stopped at
 * the parser. `>>>` had only the opcode: no token, no parselet, no VM arm. That
 * is the same dead-declaration shape as the two opcodes deleted during the CAS
 * work, and the reason the tests below check reachability from real source text
 * rather than calling the VM directly. Testing the opcode would have passed on
 * the day both were unusable.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluates one line through a real engine and returns the number. */
function evaluate(source: string): number {
	const engine = newTrackedEngine("en");
	try {
		return engine.evaluateExpression(source)[0].toNumber();
	} finally {
		engine.clear();
	}
}

/** Evaluates one line and returns the raw value, for results that are not numbers. */
function evaluateRaw(source: string): unknown {
	const engine = newTrackedEngine("en");
	try {
		return engine.evaluateExpression(source)[0].value;
	} finally {
		engine.clear();
	}
}

describe("~, bitwise complement", () => {
	test("flips every bit, so ~n is -(n+1)", () => {
		expect(evaluate("~5")).toBe(-6);
		expect(evaluate("~0")).toBe(-1);
		expect(evaluate("~-1")).toBe(0);
		expect(evaluate("~255")).toBe(-256);
	});

	test("applies to a literal in any base", () => {
		expect(evaluate("~0xFF")).toBe(-256);
		expect(evaluate("~0b1010")).toBe(-11);
	});

	test("is a prefix, so it binds to what follows and composes with arithmetic", () => {
		expect(evaluate("1 + ~5")).toBe(-5);
		expect(evaluate("~(2 + 3)")).toBe(-6);
	});

	test("is its own inverse", () => {
		for (const n of [0, 1, 7, 255, -3, 1024]) {
			expect(evaluate(`~~${n < 0 ? `(${n})` : n}`)).toBe(n);
		}
	});
});

describe(">>>, unsigned right shift", () => {
	test("fills from the left with zeros, so a negative becomes large and positive", () => {
		// The whole point of the operator, and the only thing that distinguishes
		// it from `>>`: -8 as an unsigned 32-bit word is 4294967288.
		expect(evaluate("-8 >>> 1")).toBe(2147483644);
		expect(evaluate("-1 >>> 28")).toBe(15);
	});

	test("agrees with >> on non-negative values", () => {
		for (const [value, by] of [[8, 1], [256, 4], [1, 0], [1024, 10]]) {
			expect(evaluate(`${value} >>> ${by}`)).toBe(evaluate(`${value} >> ${by}`));
		}
	});

	test("does not shadow > or >=", () => {
		// `>>>` has to be matched before `>>`, which in turn comes before `>`. A
		// greedy or mis-ordered match here breaks comparison for the whole engine,
		// which is a far bigger blast radius than the operator being added.
		expect(evaluateRaw("3 > 2")).toBe(true);
		expect(evaluateRaw("3 >= 2")).toBe(true);
		expect(evaluateRaw("2 > 3")).toBe(false);
		expect(evaluate("8 >> 1")).toBe(4);
	});
});

describe("the bases stay numbers", () => {
	test("a converted value still does arithmetic", () => {
		// A base is a way of writing a number, not another kind of value. When
		// these returned strings they read as zero here, so `hex(255) + 1` was 1.
		expect(evaluate("hex(255) + 1")).toBe(256);
		expect(evaluate("bin(5) + 1")).toBe(6);
		expect(evaluate("(255 as hex) + 1")).toBe(256);
		expect(evaluate("(255 as binary) + 1")).toBe(256);
		expect(evaluate("(255 as octal) + 1")).toBe(256);
	});

	test("a converted value round-trips through the bitwise operators", () => {
		expect(evaluate("hex(0xF0) | 0x0F")).toBe(255);
		expect(evaluate("~hex(255)")).toBe(-256);
	});
});
