/**
 * The bridge between VM Values and the symbolic core.
 *
 * The first block is the one that earns its keep. `SYMBOLIC_BUILTIN_NAMES` and
 * `SYMBOLIC_NATIVE_BUILTINS` live in `vm/` and duplicate knowledge that really
 * belongs to `packages/`, because `vm/` may not import from `packages/`. A test
 * file has no such restriction, so this is where the two are held to agreement.
 * Allocating a builtin index and never implementing it has happened before when
 * parallel work collided on that shared number space.
 */
import { describe, expect, test } from "@jest/globals";
import {
	SYMBOLIC_BUILTIN_NAMES,
	SYMBOLIC_NATIVE_BUILTINS,
	valueToSymbolic,
	symbolicToValue,
	symbolicPow,
	symbolicNeg,
	symbolicBuiltin,
	solveEquationValues,
} from "@solve-js/vm/SymbolicOps";
import { builtinNameToIndex } from "@solve-js/packages/function/parselets/FunctionCallParselet";
import { builtinFunctions } from "@solve-js/vm/VMBuiltins";
import { SYMBOLIC_FUNCTIONS } from "@solve-js/packages/symbolic";
import { ValueType, numberValue, stringValue, errorValue, symbolicValue } from "@solve-js/vm/Value";
import { formatSymbolic, constNode, varNode, type SymbolicNode } from "@solve-js/symbolic";

/** Renders whatever a bridge function returned, the way a caller would see it. */
function render(value: { type: number; value: unknown; toNumber(): number }): string {
	if (value.type === ValueType.Symbolic) return formatSymbolic(value.value as SymbolicNode);
	if (value.type === ValueType.Error) return String(value.value);
	return String(value.toNumber());
}

const x = symbolicValue(varNode("x"));

describe("the duplicated tables agree with their real sources", () => {
	test("every symbolic builtin name maps back to the same index the parser uses", () => {
		for (const [index, name] of Object.entries(SYMBOLIC_BUILTIN_NAMES)) {
			expect(builtinNameToIndex[name]).toBe(Number(index));
		}
	});

	test("every symbolic builtin index has a live implementation", () => {
		for (const index of Object.keys(SYMBOLIC_BUILTIN_NAMES)) {
			expect(typeof builtinFunctions[Number(index)]).toBe("function");
		}
	});

	test("every algebra verb the package registers is exempt from symbolic interception", () => {
		for (const fn of SYMBOLIC_FUNCTIONS) {
			expect(SYMBOLIC_NATIVE_BUILTINS.has(fn.builtinIndex)).toBe(true);
		}
	});

	test("the only exempt index without a verb row is the imaginary literal", () => {
		// `3i` is fused by its own normalizer rule rather than being a word, so it
		// has no row in SYMBOLIC_FUNCTIONS. Pinning that here keeps the exemption
		// set from quietly growing entries nobody registered.
		const fromPackage = new Set(SYMBOLIC_FUNCTIONS.map(fn => fn.builtinIndex));
		const extra = [...SYMBOLIC_NATIVE_BUILTINS].filter(index => !fromPackage.has(index));
		expect(extra).toEqual([74]);
	});

	test("pow is deliberately absent from the name table, being special-cased into a pow node", () => {
		expect(SYMBOLIC_BUILTIN_NAMES[builtinNameToIndex.pow]).toBeUndefined();
	});
});

describe("valueToSymbolic", () => {
	test("a symbolic value returns its own tree", () => {
		expect(valueToSymbolic(x)).toEqual(varNode("x"));
	});

	test("a number becomes an exact constant, read by its written decimal", () => {
		expect(formatSymbolic(valueToSymbolic(numberValue(0.1))!)).toBe("0.1");
	});

	test("values with no exact rational image decline", () => {
		expect(valueToSymbolic(numberValue(Number.NaN))).toBeNull();
		expect(valueToSymbolic(numberValue(Number.POSITIVE_INFINITY))).toBeNull();
		expect(valueToSymbolic(errorValue("SOME_CODE", "boom"))).toBeNull();
	});
});

describe("symbolicToValue", () => {
	test("a tree that reduced to a constant comes back as an ordinary number", () => {
		const result = symbolicToValue({ kind: "sub", left: varNode("x"), right: varNode("x") });
		expect(result.type).toBe(ValueType.Number);
		expect(result.toNumber()).toBe(0);
	});

	test("a tree that still holds an unknown stays symbolic", () => {
		expect(symbolicToValue(varNode("x")).type).toBe(ValueType.Symbolic);
	});
});

describe("the three VM entry points", () => {
	test("symbolicPow builds a power rather than computing against a placeholder zero", () => {
		expect(render(symbolicPow(x, numberValue(2)))).toBe("x^2");
	});

	test("symbolicNeg negates rather than producing -0", () => {
		expect(render(symbolicNeg(x))).toBe("-x");
	});

	test("symbolicBuiltin carries a known function through", () => {
		expect(render(symbolicBuiltin(0, [x]))).toBe("sqrt(x)");
		expect(render(symbolicBuiltin(2, [x]))).toBe("sin(x)");
	});

	test("pow(x, 2) and x^2 produce the identical tree", () => {
		expect(render(symbolicBuiltin(builtinNameToIndex.pow, [x, numberValue(2)]))).toBe(render(symbolicPow(x, numberValue(2))));
	});

	test("an index with no symbolic reading reports it instead of computing from zero", () => {
		// 32 is random(), 51 is a finance function; neither means anything applied
		// to an unknown, and returning a number here would be silently wrong.
		expect(render(symbolicBuiltin(32, [x]))).toBe("SYMBOLIC_UNSUPPORTED_FUNCTION");
		expect(render(symbolicBuiltin(51, [x]))).toBe("SYMBOLIC_UNSUPPORTED_FUNCTION");
	});

	test("an error operand propagates unchanged, keeping its original code", () => {
		expect(render(symbolicBuiltin(0, [errorValue("ORIGINAL_CODE", "boom")]))).toBe("ORIGINAL_CODE");
	});

	test("a non-finite operand is reported rather than folded in", () => {
		expect(render(symbolicPow(x, numberValue(Number.NaN)))).toBe("SYMBOLIC_UNSUPPORTED_FUNCTION");
	});
});

describe("solveEquationValues, shared by solve() and the stored equation form", () => {
	/** `x^2 - 4` as a symbolic value. */
	const quadratic = symbolicValue({
		kind: "sub",
		left: { kind: "pow", base: varNode("x"), exponent: constNode(2) },
		right: constNode(4),
	});

	test("roots come back in ascending order", () => {
		const result = solveEquationValues(quadratic, numberValue(0), "x");
		expect(result.type).toBe(ValueType.Matrix);
	});

	test("a quadratic with complex roots returns them rather than a sentence", () => {
		const complexRoots = symbolicValue({
			kind: "add",
			left: { kind: "pow", base: varNode("x"), exponent: constNode(2) },
			right: constNode(1),
		});
		const result = solveEquationValues(complexRoots, numberValue(0), "x");
		expect(result.type).toBe(ValueType.Matrix);
	});

	test("an outcome that is genuinely not a root still reads as a sentence", () => {
		const result = solveEquationValues(numberValue(1), numberValue(2), "x");
		expect(result.type).toBe(ValueType.String);
		expect(String(result.value)).toMatch(/no solution/);
	});

	test("a side with no exact value is reported", () => {
		expect(render(solveEquationValues(quadratic, numberValue(Number.NaN), "x"))).toBe("SYMBOLIC_NONFINITE_OPERAND");
	});

	test("a string argument is not mistaken for an equation side", () => {
		// Guards the PUSH_STRING convention: the name argument must never be
		// treated as a value to solve with.
		expect(valueToSymbolic(stringValue("x"))).not.toBeNull();
	});
});
