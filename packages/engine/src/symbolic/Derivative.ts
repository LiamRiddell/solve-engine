/**
 * Symbolic differentiation.
 *
 * Genuinely symbolic, not a finite-difference approximation. Once a `pow` node
 * and a function-application node exist, applying the differentiation rules to
 * the tree is both easier to get right and exact, where a finite difference
 * needs a step size chosen against competing truncation and rounding errors and
 * is wrong in the last digits by construction.
 *
 * An unknown function is left as an unevaluated `der` call rather than guessed
 * at. Returning something plausible for a function whose derivative this module
 * does not know would be the worst available outcome.
 */

import {
	type SymbolicNode,
	constNode,
	varNode,
	powNode,
	callNode,
} from "@solve-js/symbolic/SymbolicNode";
import { RATIONAL_ONE, RATIONAL_ZERO, rationalSub } from "@solve-js/symbolic/Rational";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Highest derivative order accepted by {@link differentiate}.
 *
 * Each order re-differentiates the previous result, and the quotient rule in
 * particular grows a tree quickly, so repeated differentiation is the operation
 * most able to run away.
 */
export const DERIVATIVE_MAX_ORDER = 16;

/** Shorthand for the constant zero node. */
function zero(): SymbolicNode {
	return constNode(RATIONAL_ZERO);
}

/** Shorthand for the constant one node. */
function one(): SymbolicNode {
	return constNode(RATIONAL_ONE);
}

/**
 * The derivative of a known single-argument function, in terms of its own
 * argument, before the chain rule multiplies by the argument's derivative.
 *
 * @param name - The function name.
 * @param argument - The argument expression, substituted into the result.
 * @returns The derivative expression, or `null` when the function is not one
 * this module knows how to differentiate.
 */
export function functionDerivative(name: string, argument: SymbolicNode): SymbolicNode | null {
	switch (name) {
		case "sin":
			return callNode("cos", [argument]);
		case "cos":
			return { kind: "neg", operand: callNode("sin", [argument]) };
		case "tan":
			// 1/cos(u)^2, avoiding a sec() this engine has no name for.
			return { kind: "div", left: one(), right: powNode(callNode("cos", [argument]), constNode(2)) };
		case "exp":
			return callNode("exp", [argument]);
		case "log":
			return { kind: "div", left: one(), right: argument };
		case "sqrt":
			return {
				kind: "div",
				left: one(),
				right: { kind: "mul", left: constNode(2), right: callNode("sqrt", [argument]) },
			};
		case "asin":
			return { kind: "div", left: one(), right: callNode("sqrt", [oneMinusSquare(argument)]) };
		case "acos":
			return { kind: "neg", operand: { kind: "div", left: one(), right: callNode("sqrt", [oneMinusSquare(argument)]) } };
		case "atan":
			return { kind: "div", left: one(), right: onePlusSquare(argument) };
		case "sinh":
			return callNode("cosh", [argument]);
		case "cosh":
			return callNode("sinh", [argument]);
		case "tanh":
			return { kind: "div", left: one(), right: powNode(callNode("cosh", [argument]), constNode(2)) };
		case "abs":
			return callNode("sign", [argument]);
		default:
			return null;
	}
}

/** `1 - u^2`, shared by the inverse trigonometric derivatives. */
function oneMinusSquare(argument: SymbolicNode): SymbolicNode {
	return { kind: "sub", left: one(), right: powNode(argument, constNode(2)) };
}

/** `1 + u^2`, for the arctangent derivative. */
function onePlusSquare(argument: SymbolicNode): SymbolicNode {
	return { kind: "add", left: one(), right: powNode(argument, constNode(2)) };
}

/**
 * Differentiates an expression with respect to one variable.
 *
 * @param node - The expression to differentiate.
 * @param variable - The variable to differentiate with respect to.
 * @param order - How many times, defaulting to once.
 * @returns The simplified derivative.
 * @throws {EngineError} `SYMBOLIC_DERIVATIVE_ORDER_LIMIT` past
 * {@link DERIVATIVE_MAX_ORDER}.
 */
export function differentiate(node: SymbolicNode, variable: string, order = 1): SymbolicNode {
	if (order < 0 || !Number.isInteger(order)) {
		throw ErrorFactory.execution("SYMBOLIC_DERIVATIVE_ORDER_LIMIT", "A derivative order must be a whole number, at least zero.");
	}
	if (order > DERIVATIVE_MAX_ORDER) {
		throw ErrorFactory.execution(
			"SYMBOLIC_DERIVATIVE_ORDER_LIMIT",
			`A derivative order above ${DERIVATIVE_MAX_ORDER} is not supported.`,
			{ limit: DERIVATIVE_MAX_ORDER },
		);
	}

	let result = simplifySymbolic(node);
	for (let i = 0; i < order; i++) result = simplifySymbolic(derive(result, variable));
	return result;
}

/** One differentiation pass, before simplification. */
function derive(node: SymbolicNode, variable: string): SymbolicNode {
	switch (node.kind) {
		case "const":
			return zero();
		case "var":
			return node.name === variable ? one() : zero();
		case "add":
			return { kind: "add", left: derive(node.left, variable), right: derive(node.right, variable) };
		case "sub":
			return { kind: "sub", left: derive(node.left, variable), right: derive(node.right, variable) };
		case "neg":
			return { kind: "neg", operand: derive(node.operand, variable) };
		case "mul":
			// Product rule.
			return {
				kind: "add",
				left: { kind: "mul", left: derive(node.left, variable), right: node.right },
				right: { kind: "mul", left: node.left, right: derive(node.right, variable) },
			};
		case "div":
			// Quotient rule.
			return {
				kind: "div",
				left: {
					kind: "sub",
					left: { kind: "mul", left: derive(node.left, variable), right: node.right },
					right: { kind: "mul", left: node.left, right: derive(node.right, variable) },
				},
				right: powNode(node.right, constNode(2)),
			};
		case "pow":
			return derivePow(node, variable);
		case "call": {
			if (node.args.length !== 1) return unevaluated(node, variable);
			const outer = functionDerivative(node.name, node.args[0]);
			if (outer === null) return unevaluated(node, variable);
			// Chain rule.
			return { kind: "mul", left: outer, right: derive(node.args[0], variable) };
		}
	}
}

/**
 * Differentiates a power.
 *
 * The constant-exponent case is the ordinary power rule with the chain rule
 * applied to the base. The general `f^g` case is only attempted when it is
 * sound to do so: with a constant positive base, where it reduces to
 * `f^g * ln(f) * g'`. A general `f^g` would need `ln(f)`, which is undefined
 * for a negative base, so guessing there could produce a formula that is wrong
 * exactly where the original expression was fine.
 */
function derivePow(node: SymbolicNode & { kind: "pow" }, variable: string): SymbolicNode {
	if (node.exponent.kind === "const") {
		const reduced = constNode(rationalSub(node.exponent.value, RATIONAL_ONE));
		return {
			kind: "mul",
			left: { kind: "mul", left: node.exponent, right: powNode(node.base, reduced) },
			right: derive(node.base, variable),
		};
	}
	if (node.base.kind === "const" && node.base.value.n > 0n) {
		return {
			kind: "mul",
			left: { kind: "mul", left: node, right: callNode("log", [node.base]) },
			right: derive(node.exponent, variable),
		};
	}
	return unevaluated(node, variable);
}

/** Leaves an unknown derivative as an explicit `der(expr, variable)` call rather than inventing an answer for it. */
function unevaluated(node: SymbolicNode, variable: string): SymbolicNode {
	return callNode("der", [node, varNode(variable)]);
}
