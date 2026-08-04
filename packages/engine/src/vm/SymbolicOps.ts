/**
 * The adapter between VM {@link Value}s and the symbolic algebra core.
 *
 * This is the only module that legitimately knows both types, which is why it
 * lives in `vm/` rather than in `symbolic/` (which imports nothing from the VM)
 * or in `packages/symbolic/` (which is grammar, and sits above `vm/` in the
 * layering).
 *
 * It exists because of a specific class of silent wrong answer.
 * `Value.toNumber()` reports `0` for a symbolic operand, deliberately, since a
 * free-variable formula has no single numeric value. Any opcode that reaches
 * for `.toNumber()` without checking `.isSymbolic()` first therefore computes
 * with zero and returns a confidently wrong result with no error at all:
 * `x^2 + 3x + 2` evaluated to `3x+2`, `-x` to `-0`, and `sqrt(x)` to `0`. The
 * three entry points below are what `vm/VM.ts` calls instead, for `EXP`, `NEG`
 * and `CALL_BUILTIN` respectively.
 */

import { Value, ValueType, numberValue, stringValue, errorValue, symbolicValue, matrixValue } from "@solve-js/vm/Value";
import { solveForVariable, type SolveOutcome } from "@solve-js/symbolic/Solve";
import {
	type SymbolicNode,
	constNode,
	powNode,
	callNode,
	simplifySymbolic,
	rationalFromNumber,
	rationalToNumber,
} from "@solve-js/symbolic";

/**
 * Builtin function indices that carry a meaning through a symbolic
 * expression, mapped to the name a `call` node records.
 *
 * Declared here rather than derived from
 * `packages/function/parselets/FunctionCallParselet.ts`'s `builtinNameToIndex`,
 * because `vm/` must not import from `packages/`. `__tests__/vm/SymbolicOps.spec.ts`
 * asserts the two agree, which a test file may do since it can import both.
 *
 * Membership is a deliberate judgement, not a transcription. A function is
 * here only when applying it to a free variable is meaningful. Everything
 * absent (`min`/`max`/`random`, the number-base conversions, the finance block
 * at 51 to 60, the matrix block at 63 to 66) has no symbolic reading and is
 * reported as an error rather than silently computed against zero.
 *
 * Index 31 (`pow`) is intentionally absent: it is special-cased in
 * {@link symbolicBuiltin} to build a `pow` node, so that `pow(x, 2)` and `x^2`
 * produce the identical tree.
 */
export const SYMBOLIC_BUILTIN_NAMES: Readonly<Record<number, string>> = {
	0: "sqrt", 1: "abs", 2: "sin", 3: "cos", 4: "tan", 5: "log",
	6: "ceil", 7: "floor", 8: "round",
	11: "asin", 12: "acos", 13: "atan", 14: "atan2",
	15: "sinh", 16: "cosh", 17: "tanh",
	18: "asinh", 19: "acosh", 20: "atanh",
	21: "cbrt", 23: "expm1", 24: "exp", 26: "hypot",
	28: "log10", 29: "log1p", 30: "log2",
	33: "sign", 34: "trunc",
	// Spelled exactly as `builtinNameToIndex` accepts them, all lower case. A
	// `call` node's name is what gets displayed, so a name the parser would not
	// accept back would render an expression the user cannot retype.
	35: "degtorad", 36: "radtodeg",
	61: "root", 62: "fact",
};

/** Builtin index for `pow(base, exponent)`, which becomes a `pow` node rather than a `call` node. */
const POW_BUILTIN_INDEX = 31;

/**
 * Builtin indices that take a symbolic argument on purpose and handle it
 * themselves, so `vm/VM.ts` must **not** route them through
 * {@link symbolicBuiltin}.
 *
 * These are the algebra verbs (`expand`, and the later phases' `factor`,
 * `solve` and calculus functions). Every other builtin reads its arguments
 * through `toNumber()` and has to be intercepted; these exist precisely to
 * receive an expression containing unknowns, so intercepting them would report
 * "cannot be applied to an expression that still contains an unknown" for the
 * one family of functions where that is the whole point.
 *
 * Listed here rather than imported from `packages/symbolic/` because `vm/` must
 * not import from `packages/`. `__tests__/engine/SymbolicSurfaceParity.spec.ts`
 * asserts this set matches the package's own table.
 */
export const SYMBOLIC_NATIVE_BUILTINS: ReadonlySet<number> = new Set([67, 68, 69, 70, 71, 72, 73]);

/**
 * Converts a Value into a {@link SymbolicNode}.
 *
 * @param v - The value to convert.
 * @returns The value's own tree when it is already symbolic, otherwise a
 * `const` node wrapping its numeric value. `null` when the value has no exact
 * rational image, which covers `NaN`, `±Infinity`, and the `Error`/`Pending`
 * value types whose `toNumber()` is a placeholder zero rather than a quantity.
 */
export function valueToSymbolic(v: Value): SymbolicNode | null {
	if (v.type === ValueType.Symbolic) return v.value as SymbolicNode;
	if (v.type === ValueType.Error || v.type === ValueType.Pending) return null;
	const numeric = v.toNumber();
	if (!Number.isFinite(numeric)) return null;
	return constNode(rationalFromNumber(numeric));
}

/**
 * Simplifies a tree and wraps it back as a Value.
 *
 * @param node - The tree to finish.
 * @returns A plain `Number` Value when the tree simplified to a bare constant,
 * so an expression whose unknowns all cancelled reads as an ordinary number,
 * otherwise a `Symbolic` Value.
 */
export function symbolicToValue(node: SymbolicNode): Value {
	const simplified = simplifySymbolic(node);
	if (simplified.kind === "const") return numberValue(rationalToNumber(simplified.value));
	return symbolicValue(simplified);
}

/** The error returned whenever a symbolic operand reaches something with no symbolic meaning, in place of the old silent zero. */
function unsupported(what: string): Value {
	return errorValue(
		"SYMBOLIC_UNSUPPORTED_FUNCTION",
		`"${what}" cannot be applied to an expression that still contains an unknown.`,
	);
}

/**
 * `^` where at least one operand is symbolic.
 *
 * @param l - The base.
 * @param r - The exponent.
 * @returns The resulting Value, or an error Value when either operand has no
 * exact rational image.
 */
export function symbolicPow(l: Value, r: Value): Value {
	const base = valueToSymbolic(l);
	const exponent = valueToSymbolic(r);
	if (base === null || exponent === null) return unsupported("^");
	return symbolicToValue(powNode(base, exponent));
}

/**
 * Unary minus where the operand is symbolic.
 *
 * @param v - The operand.
 * @returns The negated Value, or an error Value when the operand has no exact
 * rational image.
 */
export function symbolicNeg(v: Value): Value {
	const operand = valueToSymbolic(v);
	if (operand === null) return unsupported("-");
	return symbolicToValue({ kind: "neg", operand });
}

/**
 * A builtin function call where at least one argument is symbolic.
 *
 * @param index - The builtin index, as pushed by `OpCode.CALL_BUILTIN`.
 * @param args - The already-ordered argument values.
 * @returns The resulting Value. An index with no symbolic meaning yields an
 * error Value rather than a number computed from a placeholder zero.
 */
export function symbolicBuiltin(index: number, args: readonly Value[]): Value {
	const nodes: SymbolicNode[] = [];
	for (const arg of args) {
		// Propagate an Error operand unchanged rather than replacing it, so the
		// original code and message reach the caller.
		if (arg.type === ValueType.Error) return arg;
		const node = valueToSymbolic(arg);
		if (node === null) return unsupported(SYMBOLIC_BUILTIN_NAMES[index] ?? `builtin ${index}`);
		nodes.push(node);
	}

	if (index === POW_BUILTIN_INDEX && nodes.length === 2) {
		return symbolicToValue(powNode(nodes[0], nodes[1]));
	}

	const name = SYMBOLIC_BUILTIN_NAMES[index];
	if (name === undefined) return unsupported(`builtin ${index}`);
	return symbolicToValue(callNode(name, nodes));
}

/**
 * Renders one root as a value, keeping a fraction exact.
 *
 * A whole-number root becomes an ordinary Number, which reads naturally. A
 * fractional one stays Symbolic so it renders as `1/3`: routing it through
 * {@link symbolicToValue} would collapse it to a double and the number
 * formatter would show `0.33`, throwing away the exactness that solving
 * exactly was for.
 */
function rootToValue(root: SymbolicNode): Value {
	const value = symbolicToValue(root);
	if (value.type === ValueType.Number && !Number.isInteger(value.toNumber())) return symbolicValue(root);
	return value;
}

/**
 * Renders a {@link SolveOutcome} as a VM value.
 *
 * Several outcomes are answers rather than errors and read as sentences, since
 * "no real solutions" is the complete and correct response to `x^2+1=0` over
 * the reals and dressing it up as a failure would misrepresent it. Only the
 * genuinely-unsupported case becomes an error value.
 */
function solveOutcomeToValue(outcome: SolveOutcome): Value {
	switch (outcome.kind) {
		case "identity":
			return stringValue("true for every value");
		case "contradiction":
			return stringValue("no solution");
		case "no-real-solutions":
			return stringValue(`no real solutions (${outcome.reason})`);
		case "unsupported":
			return errorValue("SYMBOLIC_SOLVE_UNSUPPORTED", `Cannot solve this equation: ${outcome.reason}.`);
		case "roots": {
			const values = outcome.exact.map(rootToValue);
			for (const approximate of outcome.approximate) values.push(numberValue(approximate));
			if (values.length === 0) return stringValue("no solution");
			if (values.length === 1) return values[0];
			// Several roots read best as a row of values, which the matrix
			// formatter already renders as "[-2, 2]".
			return matrixValue(1, values.length, values.map(v => (v.type === ValueType.Symbolic ? (v.value as SymbolicNode) : v.toNumber())));
		}
	}
}

/**
 * Solves `lhs = rhs` for a variable, given the two sides as already-evaluated
 * Values, and renders the outcome.
 *
 * Shared by the `solve(equation, variable)` builtin and by the stored
 * `x^2-4 = 0` then `x =>` form in `engine/ExpressionEngine.ts`. Both go through
 * here rather than each rendering an outcome themselves, so the two surfaces
 * cannot drift into disagreeing about what an answer looks like.
 *
 * @param lhsValue - The left-hand side, evaluated symbolic-tolerantly.
 * @param rhsValue - The right-hand side, likewise.
 * @param variable - The unknown to solve for.
 * @returns The solution as a Value, or an error Value when a side has no exact
 * value to solve with.
 */
export function solveEquationValues(lhsValue: Value, rhsValue: Value, variable: string): Value {
	const lhs = valueToSymbolic(lhsValue);
	const rhs = valueToSymbolic(rhsValue);
	if (lhs === null || rhs === null) {
		return errorValue("SYMBOLIC_NONFINITE_OPERAND", "An equation side has no exact value to solve with.");
	}
	return solveOutcomeToValue(solveForVariable(lhs, rhs, variable));
}
