/**
 * Helpers shared by the symbolic algebra specs.
 *
 * A computer-algebra system is mostly tested by checking mathematical laws
 * rather than specific output strings: expanding a factorization returns the
 * original, differentiating an integral returns the integrand, a root
 * substitutes to zero. Those checks need two things repeatedly, a way to build
 * a polynomial and a way to evaluate a tree numerically, so they live here
 * rather than being copied into every spec.
 */

import {
	type SymbolicNode,
	constNode,
	varNode,
	powNode,
	simplifySymbolic,
} from "@solve-js/symbolic";

/**
 * Builds a univariate polynomial from descending coefficients.
 *
 * @param descending - Coefficients from the highest power down, so `[1, 0, -4]`
 * is `x^2 - 4`. A zero coefficient contributes no term.
 * @param variable - The variable name, defaulting to `x`.
 * @returns The simplified polynomial tree.
 */
export function poly(descending: readonly number[], variable = "x"): SymbolicNode {
	let result: SymbolicNode = constNode(0);
	const degree = descending.length - 1;
	descending.forEach((coeff, index) => {
		if (coeff === 0) return;
		const power = degree - index;
		let term: SymbolicNode = constNode(coeff);
		if (power === 1) term = { kind: "mul", left: term, right: varNode(variable) };
		else if (power > 1) term = { kind: "mul", left: term, right: powNode(varNode(variable), constNode(power)) };
		result = { kind: "add", left: result, right: term };
	});
	return simplifySymbolic(result);
}

/** The numeric form of each function a `call` node may name, for {@link evaluateNumerically}. */
const NUMERIC_FUNCTIONS: Readonly<Record<string, (v: number) => number>> = {
	sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
	log: Math.log, exp: Math.exp, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
	round: Math.round, trunc: Math.trunc, asin: Math.asin, acos: Math.acos, atan: Math.atan,
	sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, cbrt: Math.cbrt,
};

/**
 * Evaluates a symbolic tree at a point.
 *
 * This is how a symbolic result gets cross-checked against arithmetic: two
 * expressions that are equal as algebra must agree numerically everywhere they
 * are both defined, which catches a wrong rewrite that happens to look
 * plausible.
 *
 * @param node - The tree to evaluate.
 * @param bindings - A value for each free variable.
 * @returns The numeric value. `NaN` when a variable has no binding, which shows
 * up as a failed comparison rather than silently reading as zero.
 * @throws {Error} When the tree names a function with no numeric form here,
 * rather than guessing at one.
 */
export function evaluateNumerically(node: SymbolicNode, bindings: Readonly<Record<string, number>>): number {
	switch (node.kind) {
		case "const":
			return Number(node.value.n) / Number(node.value.d);
		case "var":
			return node.name in bindings ? bindings[node.name] : Number.NaN;
		case "neg":
			return -evaluateNumerically(node.operand, bindings);
		case "add":
			return evaluateNumerically(node.left, bindings) + evaluateNumerically(node.right, bindings);
		case "sub":
			return evaluateNumerically(node.left, bindings) - evaluateNumerically(node.right, bindings);
		case "mul":
			return evaluateNumerically(node.left, bindings) * evaluateNumerically(node.right, bindings);
		case "div":
			return evaluateNumerically(node.left, bindings) / evaluateNumerically(node.right, bindings);
		case "pow":
			return Math.pow(evaluateNumerically(node.base, bindings), evaluateNumerically(node.exponent, bindings));
		case "call": {
			const fn = NUMERIC_FUNCTIONS[node.name];
			if (!fn) throw new Error(`no numeric form for "${node.name}"`);
			return fn(evaluateNumerically(node.args[0], bindings));
		}
	}
}

/**
 * A small deterministic integer generator.
 *
 * Seeded rather than random, because a property test that fails must be
 * replayable. The generator is a plain linear congruential step, which is more
 * than good enough for producing varied test inputs.
 *
 * @param seed - The starting seed.
 * @returns A function yielding the next integer in `[-span, span]`.
 */
export function seededInts(seed: number): (span: number) => number {
	let state = seed;
	return (span: number): number => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return (state % (2 * span + 1)) - span;
	};
}
