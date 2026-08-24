/**
 * IEEE 754 behaviour, pinned deliberately rather than by accident.
 *
 * Every number in this engine is a JavaScript double, so the engine inherits
 * every double's quirks: 0.1 + 0.2 is not 0.3, integers above 2^53 have gaps
 * in them, and dividing by zero is a value rather than an error. None of that
 * is a defect. What would be a defect is any of it being *different* from a
 * double, because then an answer computed here could not be reproduced
 * anywhere else, and there would be no rule a reader could apply to predict it.
 *
 * So the expectations below are exact, never `toBeCloseTo`. Each one is the
 * value the same expression produces in plain JavaScript, computed
 * independently and written out in full. A test that passes because it is
 * fuzzy would not notice the engine quietly rounding, truncating, or
 * short-circuiting somewhere in the middle of the pipeline, which is precisely
 * the failure this file exists to catch.
 *
 * The one thing pinned loosely is *display*, because the formatter's decimal
 * place count is a setting and not arithmetic.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("representation error survives the pipeline unchanged", () => {
	test("0.1 + 0.2 is the double, not the decimal", () => {
		// 0.1 and 0.2 are both inexact in binary, and their sum lands one ulp
		// above 0.3. Any other answer here means something rounded on the way
		// through, which would make the engine's arithmetic unpredictable
		// rather than more accurate.
		expect(num("0.1 + 0.2")).toBe(0.30000000000000004);
		expect(num("0.1 + 0.2") === 0.3).toBe(false);
	});

	test("and the same error appears through multiplication", () => {
		expect(num("0.1 * 3")).toBe(0.30000000000000004);
	});

	test("subtraction cancels down to a visible error too", () => {
		expect(num("1 - 0.9")).toBe(0.09999999999999998);
	});

	test("a third is the double nearest a third", () => {
		expect(num("1 / 3")).toBe(0.3333333333333333);
		// Three of them do not make one, and pretending otherwise here would
		// mean the engine had rounded the division.
		expect(num("1 / 3 * 3")).toBe(1);
		expect(num("0.1 + 0.1 + 0.1")).toBe(0.30000000000000004);
	});
});

describe("the integer precision ceiling", () => {
	test("2^53 is exact", () => {
		expect(num("2 ^ 53")).toBe(9007199254740992);
	});

	test("2^53 + 1 is not representable, so it is not represented", () => {
		// The next double after 9007199254740992 is 9007199254740994. Adding
		// one lands between them and rounds back down. This is the honest
		// answer for a double; the alternative would be silently promoting to
		// BigInt, which would change the type of an expression based on its
		// runtime magnitude.
		expect(num("2 ^ 53 + 1")).toBe(9007199254740992);
	});

	test("and an odd literal past the ceiling is rounded at parse time", () => {
		expect(num("9007199254740993")).toBe(9007199254740992);
	});

	test("2^53 + 2 is representable and does move", () => {
		expect(num("2 ^ 53 + 2")).toBe(9007199254740994);
	});
});

describe("overflow and underflow", () => {
	test("past the largest double is Infinity, not an error", () => {
		expect(num("1e308 * 10")).toBe(Infinity);
		expect(num("-1e308 * 10")).toBe(-Infinity);
	});

	test("a literal too large to represent is already Infinity", () => {
		expect(num("1e400")).toBe(Infinity);
		expect(num("-1e400")).toBe(-Infinity);
	});

	test("a literal too small to represent is zero", () => {
		expect(num("1e-400")).toBe(0);
	});

	test("denormals survive as themselves", () => {
		// 5e-324 is the smallest positive double. Halving it underflows to
		// zero, which is the correct result and not a rounding shortcut.
		expect(num("5e-324")).toBe(5e-324);
		expect(num("5e-324 / 2")).toBe(0);
	});

	test("Infinity keeps its arithmetic", () => {
		expect(num("1 / 0 + 1 / 0")).toBe(Infinity);
		expect(num("1 / 0 * 2")).toBe(Infinity);
		expect(num("1 / (1 / 0)")).toBe(0);
	});
});

describe("NaN", () => {
	test("zero over zero is NaN", () => {
		expect(num("0 / 0")).toBeNaN();
	});

	test("Infinity minus Infinity is NaN", () => {
		expect(num("1 / 0 - 1 / 0")).toBeNaN();
	});

	test("Infinity times zero is NaN", () => {
		expect(num("(1 / 0) * 0")).toBeNaN();
	});

	test("NaN propagates through further arithmetic", () => {
		// The propagation matters more than the value: an engine that turned
		// NaN back into 0 somewhere would report a confidently wrong total for
		// an expression that has no answer.
		expect(num("(0 / 0) + 1")).toBeNaN();
		expect(num("(0 / 0) * 0")).toBeNaN();
		expect(num("(0 / 0) - (0 / 0)")).toBeNaN();
	});

	test("NaN is not equal to itself, which is how you detect it", () => {
		expect(evaluate("0 / 0 == 0 / 0").value).toBe(false);
		expect(evaluate("0 / 0 != 0 / 0").value).toBe(true);
	});

	test("and every ordering comparison against NaN is false", () => {
		expect(evaluate("0 / 0 > 1").value).toBe(false);
		expect(evaluate("0 / 0 < 1").value).toBe(false);
		expect(evaluate("0 / 0 >= 0 / 0").value).toBe(false);
	});

	test("the root of a negative number has no real answer", () => {
		expect(num("-2 ^ 0.5")).toBeNaN();
	});

	test("and it propagates through a measured quantity, unit and all", () => {
		// `binaryOp()` used to intercept a NaN operand and answer a bare,
		// unitless 0, so "(1 kg / 0 * 0) + 1 kg" reported 0 for an expression
		// with no answer at all, and dropped the kilograms on the way, which
		// removed the last clue that anything had happened.
		const value = evaluate("(1 kg / 0 * 0) + 1 kg");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe("kg");
		expect(value.toNumber()).toBeNaN();
	});

	test("in either operand position, and for a currency too", () => {
		expect(evaluate("1 kg + (1 kg / 0 * 0)").toNumber()).toBeNaN();
		expect(evaluate("($1 / 0 * 0) + $1").toNumber()).toBeNaN();
		expect(evaluate("($1 / 0 * 0) + $1").unit).toBe("USD");
	});

	test("and a NaN quantity is still false against every comparison", () => {
		// Which is the only way a caller detects it, so it has to survive the
		// unit unification the comparison opcodes do first.
		expect(evaluate("(1 kg / 0 * 0) == 0 kg").value).toBe(false);
		expect(evaluate("(1 kg / 0 * 0) != 0 kg").value).toBe(true);
	});
});

describe("negative zero", () => {
	test("compares equal to zero, as IEEE 754 requires", () => {
		expect(evaluate("0 == -0").value).toBe(true);
	});

	test("but keeps its sign where the sign is observable", () => {
		// 1/-0 is the only cheap way to see the difference, and it is the
		// reason -0 has to be preserved rather than normalised to 0.
		expect(num("1 / -0")).toBe(-Infinity);
		expect(num("1 / (0 * -1)")).toBe(-Infinity);
		expect(num("1 / 0")).toBe(Infinity);
	});
});

describe("magnitudes far apart", () => {
	test("adding a small number to a huge one changes nothing", () => {
		// 1e21 + 1 has no representable answer other than 1e21. Silently
		// getting something else would mean the addition was not done in
		// doubles at all.
		// The gap between doubles at 1e16 is 2, so adding 1 is a tie and
		// rounds to even, which lands back on 1e16 exactly.
		expect(num("1e21 + 1")).toBe(1e21);
		expect(num("1e16 + 1")).toBe(10000000000000000);
	});

	test("but adding a whole gap does move the value", () => {
		expect(num("1e16 + 2")).toBe(10000000000000002);
		expect(num("1e16 + 2 + 2")).toBe(10000000000000004);
		// Three is a tie the other way, rounding up to the same place two
		// additions of two reach.
		expect(num("1e16 + 3")).toBe(10000000000000004);
	});

	test("association changes the answer, which is why order is preserved", () => {
		// (1e16 + 1) - 1e16 loses the 1 entirely; 1e16 - 1e16 + 1 keeps it.
		// Both are correct doubles, and the engine has to evaluate strictly
		// left to right for either to be predictable.
		expect(num("1e16 + 1 - 1e16")).toBe(0);
		expect(num("1e16 - 1e16 + 1")).toBe(1);
		expect(num("1e16 + 3 - 1e16")).toBe(4);
	});
});

describe("everything above is still a plain Number", () => {
	test("Infinity has not become a string or an error value", () => {
		expect(evaluate("1 / 0").type).toBe(ValueType.Number);
		expect(evaluate("0 / 0").type).toBe(ValueType.Number);
		expect(evaluate("1e400").type).toBe(ValueType.Number);
	});
});
