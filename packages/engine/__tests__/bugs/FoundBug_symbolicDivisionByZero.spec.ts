import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dividesByZero, simplifySymbolic, constNode, varNode, powNode, type SymbolicNode } from "@solve-js/symbolic";
import { symbolicBuiltin, symbolicDivisionByZero, symbolicPow, symbolicToValue } from "@solve-js/vm/SymbolicOps";
import { binaryOp } from "@solve-js/vm/VMConversion";
import { ValueType, numberValue, symbolicValue } from "@solve-js/vm/Value";

/**
 * Found bug: symbolic algebra over a division by zero gave confident wrong
 * answers. `expand((x+1)/0)` was 1, `der(x/0, x)` was 0, `solve(x/0 = 1, x)`
 * held "for every value", and `expand((x*0)^-1)` was refused under the
 * internal name "builtin 65".
 *
 * The simplifier leaves a quotient by an exact zero unfolded (it cannot fold to
 * a Rational), but the cancellation after it took the greatest common divisor
 * of the numerator and zero, which is the numerator, and cancelled to 1; the
 * derivative and the solver then worked on that. A quotient by zero is now
 * refused where it is built (`dividesByZero`, checked by the arithmetic and by
 * `symbolicToValue`), the cancellation leaves it alone, and `^-1` over an
 * unknown is the reciprocal it is for a number.
 */

const REFUSAL = "This expression divides by zero, so it has no value, whatever its unknowns are.";

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const x = varNode("x");
const zero = constNode(0);

describe("the lines that exposed it", () => {
	test.each([
		"expand((x+1)/0)", "der(x/0, x)", "solve(x/0 = 1, x)", "expand((x*0)^-1)", "der((x*0)^-1, x)",
		"expand(x/(x-x))", "integral(x/0, x)", "factor(x/0)", "expand(x/0)",
	])("%s is refused as a division by zero", (line) => {
		expect(shown(line)).toBe(REFUSAL);
	});

	test("the refusal carries its code", () => {
		expect(newTrackedEngine().evaluateExpression("expand((x+1)/0)").errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
	});

	test("the division that is not by zero is unchanged", () => {
		expect(shown("expand(1/x)")).toBe("1/x");
		expect(shown("expand((x+1)^-1)")).toBe("(x+1)^(-1)");
		expect(shown("der(x/2, x)")).toBe("0.50");
		expect(shown("expand((x^2-1)/(x-1))")).toBe("x+1");
		expect(shown("1/0")).toBe("∞");
	});

	test("no symbolic refusal names a builtin by its number", () => {
		for (const line of ["expand(transpose(x))", "expand(det(x))", "expand((x*0)^-1)", "expand(inv(x))"]) {
			expect({ line, text: shown(line) }).not.toEqual({ line, text: expect.stringMatching(/builtin \d/) });
		}
	});
});

describe("the parts", () => {
	test("dividesByZero: ordinary, nested and boundary trees", () => {
		expect(dividesByZero({ kind: "div", left: x, right: zero })).toBe(true);
		expect(dividesByZero({ kind: "add", left: constNode(1), right: { kind: "div", left: x, right: zero } })).toBe(true);
		expect(dividesByZero({ kind: "pow", base: zero, exponent: constNode(-1) })).toBe(true);
		expect(dividesByZero({ kind: "pow", base: zero, exponent: constNode(-0.5) })).toBe(true);
		expect(dividesByZero({ kind: "pow", base: zero, exponent: constNode(2) })).toBe(false);
		expect(dividesByZero({ kind: "div", left: x, right: constNode(1e-300) })).toBe(false);
		expect(dividesByZero({ kind: "div", left: x, right: x })).toBe(false);
		expect(dividesByZero(x)).toBe(false);
		expect(dividesByZero(zero)).toBe(false);
	});

	test("dividesByZero: a chain as deep as the size guard does not overflow the stack", () => {
		let deep: SymbolicNode = x;
		for (let i = 0; i < 9_000; i++) deep = { kind: "neg", operand: deep };
		expect(dividesByZero(deep)).toBe(false);
		expect(dividesByZero({ kind: "div", left: deep, right: zero })).toBe(true);
	});

	test("simplifySymbolic leaves a quotient by zero as written rather than cancelling it", () => {
		const quotient: SymbolicNode = { kind: "div", left: { kind: "add", left: x, right: constNode(1) }, right: zero };
		expect(simplifySymbolic(quotient).kind).toBe("div");
		expect(dividesByZero(simplifySymbolic(quotient))).toBe(true);
		expect(dividesByZero(simplifySymbolic(powNode(zero, constNode(-2))))).toBe(true);
	});

	test("symbolicToValue refuses a tree that divides by zero, and wraps any other", () => {
		expect(symbolicToValue({ kind: "div", left: x, right: zero }).errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
		expect(symbolicToValue({ kind: "div", left: x, right: constNode(2) }).type).toBe(ValueType.Symbolic);
		expect(symbolicToValue(constNode(3)).toNumber()).toBe(3);
	});

	test("binaryOp refuses a symbolic quotient by zero where it is written", () => {
		const out = binaryOp(symbolicValue(x), numberValue(0), (a, b) => a / b, undefined, "div");
		expect(out.errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
		expect(binaryOp(symbolicValue(x), numberValue(-0), (a, b) => a / b, undefined, "div").errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
		expect(binaryOp(symbolicValue(x), numberValue(2), (a, b) => a / b, undefined, "div").type).toBe(ValueType.Symbolic);
		expect(binaryOp(symbolicValue(x), numberValue(0), (a, b) => a * b, undefined, "mul").type).not.toBe(ValueType.Error);
	});

	test("symbolicPow and inv: zero to a negative power is refused, an unknown's reciprocal is not", () => {
		expect(symbolicPow(symbolicValue(zero), numberValue(-1)).errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
		expect(symbolicBuiltin(65, [symbolicValue(x)]).type).toBe(ValueType.Symbolic);
		expect(symbolicBuiltin(65, [symbolicValue(zero)]).errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
		expect(String(symbolicBuiltin(63, [symbolicValue(x)]).errorMessage)).toBe("This function cannot be applied to an expression that still contains an unknown.");
	});

	test("symbolicDivisionByZero is a plain error Value with its message", () => {
		const refusal = symbolicDivisionByZero();
		expect(refusal.errorCode).toBe("SYMBOLIC_DIVISION_BY_ZERO");
		expect(refusal.errorMessage).toBe(REFUSAL);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the unknown", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`expand((${word}+1)/0)`);
				expectHonestLine(`der(${word}/0, ${word})`);
			}
		});
	});

	test("security: a long sum over zero, deep brackets and markup-shaped text", () => {
		expectHonestLine(`expand((${RESOURCE_PROBES.longSum(500).replace(/(\d+)/g, "$1*x")})/0)`, { budgetMs: 5_000 });
		expectHonestLine(`expand(${"(".repeat(200)}x/0${")".repeat(200)})`, { budgetMs: 5_000 });
		for (const line of fill("expand(X/0)", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: the zero from the line above, a check and a goal seek over it, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("d = 0\ny = (x + 1)/d\nexpand(y)");
		expect(batch[2]).toBe(`ERROR ${REFUSAL}`);
		expect(incremental[2]).toBe(batch[2]);
		expectHonestDocument("x = 5\nx / 0\nsolve line 2 for x = 5", { agree: false });
		expectHonestDocument("y = x/0\ncheck y == 1");
	});

	test("edge: every numeric edge as the divisor", () => {
		for (const line of fill("expand((x+1)/X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("der(x/X, x)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
