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

import { Value, ValueType, numberValue, stringValue, errorValue, symbolicValue, matrixValue, faultedOperand } from "@solve-js/vm/Value";
import { solveForVariable, type SolveOutcome } from "@solve-js/symbolic/Solve";
import type { ApproximateRoot } from "@solve-js/symbolic/NumericRoots";
import { solveNumerically, NUMERIC_ROOTS_MAX, type NumericSolveOutcome, type SearchRange } from "@solve-js/symbolic/NumericSolve";
import { definiteIntegral } from "@solve-js/symbolic/DefiniteIntegral";
import { evaluateConstant, describeNumber } from "@solve-js/symbolic/NumericEvaluate";
import {
	type SymbolicNode,
	type Rational,
	complex,
	complexNode,
	constNode,
	powNode,
	callNode,
	simplifySymbolic,
	freeVariables,
	rational,
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
export const SYMBOLIC_NATIVE_BUILTINS: ReadonlySet<number> = new Set([67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79]);

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
		// Propagate a faulted operand unchanged rather than replacing it, so the
		// original code and message (or pending query key) reach the caller.
		// Pending counts: valueToSymbolic() below returns null for one, which
		// would report "no symbolic reading" for a value that simply has not
		// arrived yet.
		const faulted = faultedOperand(arg);
		if (faulted) return faulted;
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
 * Renders an exact result of a calculus verb (a definite integral, a limit) as
 * a value, keeping a fraction a fraction for the same reason a root does.
 *
 * @param node - The exact result: a constant, or an expression in unknowns
 * other than the one the verb was about.
 * @returns A Number for a whole number, a Symbolic value otherwise.
 */
export function exactResultToValue(node: SymbolicNode): Value {
	const simplified = simplifySymbolic(node);
	return simplified.kind === "const" ? rootToValue(simplified) : symbolicToValue(simplified);
}

/**
 * Renders one numerically-found root as a value.
 *
 * A root off the real line becomes an exact complex node built from the two
 * doubles, so it displays as `-0.809+0.5878i` rather than being dropped or
 * flattened to its real part. The rational conversion is of the double's own
 * decimal form, so nothing is invented: the value shown is the value found, and
 * the number formatter rounds it for display exactly as it rounds any other.
 */
function approximateRootToValue(root: ApproximateRoot): Value {
	if (root.im === 0) return numberValue(root.re);
	return symbolicValue(complexNode(complex(rationalFromNumber(root.re), rationalFromNumber(root.im))));
}

/**
 * Renders a {@link SolveOutcome} as a VM value.
 *
 * Some outcomes are answers rather than errors and read as sentences, since
 * "no solution" is the complete and correct response to `1=2` and dressing it
 * up as a failure would misrepresent it.
 *
 * An `incomplete` outcome becomes an error even though roots were found. That
 * is the point of it: `solve(x^5-1=0, x)` answering `1` was wrong in the way
 * that matters most, because one root of five looks exactly like the whole
 * answer. Saying how many are missing is the only reading a user cannot be
 * misled by.
 */
function solveOutcomeToValue(outcome: SolveOutcome): Value {
	switch (outcome.kind) {
		case "identity":
			return stringValue("true for every value");
		case "contradiction":
			return stringValue("no solution");
		case "unsupported":
			return errorValue("SYMBOLIC_SOLVE_UNSUPPORTED", `Cannot solve this equation: ${outcome.reason}.`);
		case "incomplete": {
			const found = outcome.exact.length + outcome.approximate.length;
			return errorValue(
				"SYMBOLIC_SOLVE_INCOMPLETE",
				`Only ${found} of this equation's ${found + outcome.missing} roots could be found: ${outcome.reason}.`,
			);
		}
		case "roots": {
			const values = outcome.exact.map(rootToValue);
			for (const approximate of outcome.approximate) values.push(approximateRootToValue(approximate));
			if (values.length === 0) return stringValue("no solution");
			// Several roots read best as a row of values, which the matrix
			// formatter already renders as "[-2, 2]".
			return rowOrSingle(values);
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
 * An equation that is not a polynomial goes on to a numeric search for where
 * its two sides cross (see `symbolic/NumericSolve.ts`), which is the only
 * refusal of the exact solver that a search can answer.
 *
 * @param lhsValue - The left-hand side, evaluated symbolic-tolerantly.
 * @param rhsValue - The right-hand side, likewise.
 * @param variable - The unknown to solve for.
 * @param range - Where to look, when the reader named a range. The roots
 * outside it are left out, exact ones included.
 * @returns The solution as a Value, or an error Value when a side has no exact
 * value to solve with.
 */
export function solveEquationValues(lhsValue: Value, rhsValue: Value, variable: string, range?: SearchRange): Value {
	const lhs = valueToSymbolic(lhsValue);
	const rhs = valueToSymbolic(rhsValue);
	if (lhs === null || rhs === null) {
		return errorValue("SYMBOLIC_NONFINITE_OPERAND", "An equation side has no exact value to solve with.");
	}
	const outcome = solveForVariable(lhs, rhs, variable);
	if (outcome.kind === "unsupported" && outcome.nonPolynomial === true) {
		return numericSolveToValue(solveNumerically(lhs, rhs, variable, range));
	}
	if (range !== undefined && outcome.kind === "roots") return rootsWithinRange(outcome.exact, outcome.approximate, range);
	return solveOutcomeToValue(outcome);
}

/** Several values as the row `[a, b, c]`, one as itself. */
function rowOrSingle(values: readonly Value[]): Value {
	if (values.length === 1) return values[0];
	return matrixValue(1, values.length, values.map(v => (v.type === ValueType.Symbolic ? (v.value as SymbolicNode) : v.toNumber())));
}

/** `between -1000000 and 1000000`, for a message. */
function describeRange(range: SearchRange): string {
	return `between ${describeNumber(range.lower)} and ${describeNumber(range.upper)}`;
}

/**
 * Renders a numeric root search as a VM value.
 *
 * Finding nothing is an error, not the answer "no solution": a search that
 * found no crossing in the range it looked at has not shown that there is none
 * anywhere, and saying so would overstate it. The exact solver's "no solution"
 * is a proof; this is a report.
 */
function numericSolveToValue(outcome: NumericSolveOutcome): Value {
	switch (outcome.kind) {
		case "unsupported":
			return errorValue(
				"SYMBOLIC_SOLVE_UNSUPPORTED",
				`Cannot solve this equation: it is not a polynomial equation, and it cannot be solved numerically because ${outcome.reason}.`,
			);
		case "none":
			return errorValue(
				"SYMBOLIC_SOLVE_NO_ROOT_FOUND",
				`No root was found ${describeRange(outcome.range)}: the two sides never cross there. This equation is solved numerically, which finds crossings, so a root where the sides only touch, or one outside the range searched, is not found.` +
					(outcome.stated ? "" : " To search elsewhere, name a range after the unknown, as in solve(log(x) = 20, x, 0, 1e9)."),
			);
		case "tooMany":
			return errorValue(
				"SYMBOLIC_SOLVE_TOO_MANY_ROOTS",
				`More than ${NUMERIC_ROOTS_MAX} roots lie ${describeRange(outcome.range)}, so this equation may have infinitely many, as one built on sin or cos does. Name a narrower range after the unknown, as in solve(sin(x) = 0.5, x, 0, 3).`,
			);
		case "flat":
			return errorValue(
				"SYMBOLIC_SOLVE_TOO_MANY_ROOTS",
				`The two sides are equal, or too close for a double to tell apart, all the way from ${describeNumber(outcome.from)} to ${describeNumber(outcome.to)}, so there is no list of roots to give. Numeric solving compares the two sides as numbers, and there they compare equal.`,
			);
		case "roots":
			return rowOrSingle(outcome.roots.map(numberValue));
	}
}

/**
 * The exact solver's roots that lie in a stated range.
 *
 * A polynomial's roots are all known, so the ones in the range are a complete
 * answer and an empty range is a true "no solution" there. A complex root lies
 * on no range of the real line and is always left out.
 */
function rootsWithinRange(exact: readonly SymbolicNode[], approximate: readonly ApproximateRoot[], range: SearchRange): Value {
	const inside = (x: number | null): boolean => x !== null && x >= range.lower && x <= range.upper;
	const values: Value[] = [];
	for (const root of exact) {
		const simplified = simplifySymbolic(root);
		// `solve(a*x+b=0, x, 0, 1)`: the root is -b/a, and whether that lies in
		// the range depends on a and b. Dropping it would claim there is no
		// solution there, which nothing has shown.
		if (freeVariables(simplified).size > 0) {
			return errorValue(
				"SYMBOLIC_SOLVE_UNSUPPORTED",
				`Cannot keep only the roots ${describeRange(range)}: a root depends on another unknown, so whether it lies in the range is not known.`,
			);
		}
		if (inside(evaluateConstant(simplified))) values.push(rootToValue(root));
	}
	for (const root of approximate) {
		if (root.im === 0 && inside(root.re)) values.push(approximateRootToValue(root));
	}
	if (values.length === 0) return stringValue(`no solution ${describeRange(range)}`);
	return rowOrSingle(values);
}

/** A bound, range end or limit point read exactly, alongside its double. */
export interface RealOperand {
	/** The exact value, or `null` for an infinite operand, which has none. */
	readonly exact: Rational | null;
	/** The nearest double, which is infinite exactly when `exact` is `null`. */
	readonly approx: number;
}

/**
 * Reads a bound, a search range's end or a limit's point as an exact real
 * number.
 *
 * A fraction keeps the exact value it was typed as (`1/3` is a third, not the
 * double nearest it), which is what lets `integral(x, x, 0, 1/3)` come out as
 * exactly `1/18`. A value that is already a fault is handed back unchanged so
 * its own message reaches the reader.
 *
 * @param value - The operand.
 * @param what - What it is, for the message: "integral's lower bound".
 * @returns The number, or an error Value. An infinite operand comes back with
 * no exact value rather than as an error, since whether infinity is allowed is
 * the caller's decision and what to call it is theirs too.
 */
export function readRealOperand(value: Value, what: string): RealOperand | Value {
	const faulted = faultedOperand(value);
	if (faulted) return faulted;
	if (value.type === ValueType.Number || value.type === ValueType.BigInt) {
		const approx = value.toNumber();
		if (Number.isNaN(approx)) return errorValue("SYMBOLIC_BOUND_INVALID", `${what} is not a number.`);
		if (!Number.isFinite(approx)) return { exact: null, approx };
		if (value.type === ValueType.BigInt) return { exact: rational(value.value as bigint), approx };
		return { exact: value.rational ?? rationalFromNumber(approx), approx };
	}
	if (value.type === ValueType.Symbolic) {
		const node = simplifySymbolic(value.value as SymbolicNode);
		if (node.kind === "const") return { exact: node.value, approx: rationalToNumber(node.value) };
	}
	return errorValue("SYMBOLIC_BOUND_INVALID", `${what} must be a plain number, with no unit and no unknown in it.`);
}

/**
 * `integral(f, x, a, b)`, the definite integral, rendered as a VM value.
 *
 * An exact result keeps its fraction (`1/3`), as a root does. A result through
 * the antiderivative that involves an irrational value, and a numeric one, are
 * ordinary numbers.
 *
 * @param integrand - The expression, as a tree.
 * @param variable - The variable of integration.
 * @param lowerValue - The lower bound.
 * @param upperValue - The upper bound.
 * @returns The integral, or an error Value naming why there is none.
 */
export function definiteIntegralValue(integrand: SymbolicNode, variable: string, lowerValue: Value, upperValue: Value): Value {
	const lower = readRealOperand(lowerValue, "integral's lower bound");
	if (lower instanceof Value) return lower;
	const upper = readRealOperand(upperValue, "integral's upper bound");
	if (upper instanceof Value) return upper;
	if (lower.exact === null || upper.exact === null) {
		return errorValue("SYMBOLIC_INTEGRAL_IMPROPER", "Cannot integrate this: a bound is infinite, which makes this an improper integral, and those are not evaluated.");
	}

	const outcome = definiteIntegral(integrand, variable, lower.exact, upper.exact);
	switch (outcome.kind) {
		case "exact":
			return exactResultToValue(outcome.value);
		case "evaluated":
		case "numeric":
			return numberValue(outcome.value);
		case "improper":
			return errorValue("SYMBOLIC_INTEGRAL_IMPROPER", `Cannot integrate this: ${outcome.reason}.`);
		case "unsettled":
			return errorValue("SYMBOLIC_INTEGRAL_UNSETTLED", `Cannot integrate this: ${outcome.reason}.`);
		case "unsupported":
			return errorValue("SYMBOLIC_INTEGRAL_UNSUPPORTED", `Cannot integrate this: it has no antiderivative here and cannot be integrated numerically because ${outcome.reason}.`);
	}
}

/**
 * A stated search range for `solve`, read from its two operands.
 *
 * @returns The range, lowest end first, or an error Value.
 */
export function readSearchRange(lowerValue: Value | undefined, upperValue: Value | undefined): SearchRange | Value {
	if (lowerValue === undefined || upperValue === undefined) {
		return errorValue("SYMBOLIC_BOUND_INVALID", "solve's range needs both ends, as in solve(cos(x) = x, x, 0, 1).");
	}
	const lower = readRealOperand(lowerValue, "solve's range");
	if (lower instanceof Value) return lower;
	const upper = readRealOperand(upperValue, "solve's range");
	if (upper instanceof Value) return upper;
	if (lower.exact === null || upper.exact === null) {
		return errorValue("SYMBOLIC_BOUND_INVALID", "solve's range must have two finite ends.");
	}
	if (lower.approx === upper.approx) {
		return errorValue("SYMBOLIC_BOUND_INVALID", "solve's range must have two different ends.");
	}
	return { lower: Math.min(lower.approx, upper.approx), upper: Math.max(lower.approx, upper.approx) };
}
