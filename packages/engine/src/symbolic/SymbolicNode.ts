/**
 * The symbolic expression tree: an algebraic formula over free variables,
 * rather than a concrete number.
 *
 * This is the data type the whole symbolic algebra system manipulates. It is
 * deliberately a plain discriminated union of immutable object literals, not a
 * class hierarchy, so a node can cross the worker boundary by structured clone
 * (see `diagnostics/events.ts`, which carries these in its VM trace payload)
 * and so pattern matching in the simplifier stays exhaustive under the
 * compiler's own checking.
 *
 * Two variants exist here that the original bounded simplifier did not have,
 * and they are what unlocks the rest of the system:
 *
 * - `pow` gives exponentiation a representation. Without it `x^2` had nowhere
 *   to go, and `OpCode.EXP` fell through to `Math.pow(0, 2)` because
 *   `Value.toNumber()` reports `0` for a symbolic operand, so `x^2 + 3x + 2`
 *   silently evaluated to `3x+2`. Polynomials, derivatives and roots all need it.
 * - `call` gives function application a representation, so `sqrt(x)` and
 *   `sin(x)` carry through a symbolic expression instead of collapsing to
 *   `sqrt(0)`.
 *
 * Coefficients are exact rationals, never doubles. See `Rational.ts` for why.
 */

import type { Rational } from "@solve-js/symbolic/Rational";
import { rationalFromNumber } from "@solve-js/symbolic/Rational";

/**
 * A symbolic (algebraic) expression tree.
 *
 * Build nodes through the constructor functions in this module rather than as
 * object literals, so constants normalize consistently.
 */
export type SymbolicNode =
	| { kind: "const"; value: Rational }
	| { kind: "var"; name: string }
	| { kind: "add"; left: SymbolicNode; right: SymbolicNode }
	| { kind: "sub"; left: SymbolicNode; right: SymbolicNode }
	| { kind: "mul"; left: SymbolicNode; right: SymbolicNode }
	| { kind: "div"; left: SymbolicNode; right: SymbolicNode }
	| { kind: "neg"; operand: SymbolicNode }
	| { kind: "pow"; base: SymbolicNode; exponent: SymbolicNode }
	| { kind: "call"; name: string; args: readonly SymbolicNode[] };

/**
 * Ceiling on the size of a tree the simplifier will accept.
 *
 * Simplification itself never grows a tree (see `Simplify.ts`'s stated
 * invariant), but a tree can arrive already large from repeated symbolic
 * matrix elimination, and every rule walks it. Ten thousand nodes is orders of
 * magnitude beyond any hand-written expression while still bounding a single
 * simplify to milliseconds.
 */
export const SYMBOLIC_MAX_NODES = 10_000;

/**
 * A literal number in a symbolic expression.
 *
 * Accepts a plain `number` as well as a {@link Rational} so that the many
 * existing call sites reading a numeric Value can pass it straight through;
 * the number is converted by its decimal form, so `constNode(0.1)` is exactly
 * one tenth.
 *
 * @param value - The number, as a double or an exact rational.
 * @returns A constant node the simplifier can fold.
 */
export function constNode(value: number | Rational): SymbolicNode {
	return { kind: "const", value: typeof value === "number" ? rationalFromNumber(value) : value };
}

/**
 * An unresolved name in a symbolic expression.
 *
 * @param name - The variable name.
 * @returns A variable node, which the simplifier carries through rather than
 * evaluating.
 */
export function varNode(name: string): SymbolicNode {
	return { kind: "var", name };
}

/**
 * An exponentiation in a symbolic expression.
 *
 * @param base - The base expression.
 * @param exponent - The exponent expression, which does not have to be constant.
 * @returns A power node.
 */
export function powNode(base: SymbolicNode, exponent: SymbolicNode): SymbolicNode {
	return { kind: "pow", base, exponent };
}

/**
 * A function application in a symbolic expression.
 *
 * @param name - The function name, matching the builtin naming in
 * `vm/SymbolicOps.ts`'s own index table so the two surfaces agree.
 * @param args - The argument expressions.
 * @returns A call node.
 */
export function callNode(name: string, args: readonly SymbolicNode[]): SymbolicNode {
	return { kind: "call", name, args };
}

/**
 * A stable structural key for a tree.
 *
 * Two trees produce the same key exactly when they are structurally identical,
 * so this serves both as the equality test and as a `Map` key for memoizing
 * simplification. Prefix form (`"+(*(2,x),6)"`) rather than a hash, because a
 * hash would need collision handling to be sound and these strings stay short
 * for the expressions that actually occur.
 *
 * @param node - The tree to key.
 * @returns The structural key.
 */
export function symbolicKey(node: SymbolicNode): string {
	switch (node.kind) {
		case "const":
			return `${node.value.n}/${node.value.d}`;
		case "var":
			return `v:${node.name}`;
		case "neg":
			return `-(${symbolicKey(node.operand)})`;
		case "pow":
			return `^(${symbolicKey(node.base)},${symbolicKey(node.exponent)})`;
		case "call":
			return `${node.name}(${node.args.map(symbolicKey).join(",")})`;
		case "add":
			return `+(${symbolicKey(node.left)},${symbolicKey(node.right)})`;
		case "sub":
			return `-(${symbolicKey(node.left)},${symbolicKey(node.right)})`;
		case "mul":
			return `*(${symbolicKey(node.left)},${symbolicKey(node.right)})`;
		case "div":
			return `/(${symbolicKey(node.left)},${symbolicKey(node.right)})`;
	}
}

/**
 * Structural equality between two trees.
 *
 * @param a - Left tree.
 * @param b - Right tree.
 * @returns True when the two are structurally identical. Note this is
 * structural, not mathematical: `x+1` and `1+x` are different trees.
 */
export function nodesEqual(a: SymbolicNode, b: SymbolicNode): boolean {
	if (a.kind !== b.kind) return false;
	switch (a.kind) {
		case "const": {
			const other = b as typeof a;
			return a.value.n === other.value.n && a.value.d === other.value.d;
		}
		case "var":
			return a.name === (b as typeof a).name;
		case "neg":
			return nodesEqual(a.operand, (b as typeof a).operand);
		case "pow": {
			const other = b as typeof a;
			return nodesEqual(a.base, other.base) && nodesEqual(a.exponent, other.exponent);
		}
		case "call": {
			const other = b as typeof a;
			if (a.name !== other.name || a.args.length !== other.args.length) return false;
			return a.args.every((arg, i) => nodesEqual(arg, other.args[i]));
		}
		case "add":
		case "sub":
		case "mul":
		case "div": {
			const other = b as typeof a;
			return nodesEqual(a.left, other.left) && nodesEqual(a.right, other.right);
		}
	}
}

/**
 * Counts the nodes in a tree.
 *
 * Used by the simplifier's own limit check, and by the property test enforcing
 * that no simplification rule ever grows a tree.
 *
 * @param node - The tree to measure.
 * @returns The total node count, including `node` itself.
 */
export function nodeCount(node: SymbolicNode): number {
	switch (node.kind) {
		case "const":
		case "var":
			return 1;
		case "neg":
			return 1 + nodeCount(node.operand);
		case "pow":
			return 1 + nodeCount(node.base) + nodeCount(node.exponent);
		case "call":
			return node.args.reduce((total, arg) => total + nodeCount(arg), 1);
		case "add":
		case "sub":
		case "mul":
		case "div":
			return 1 + nodeCount(node.left) + nodeCount(node.right);
	}
}

/**
 * Every variable name appearing anywhere in a tree.
 *
 * @param node - The tree to scan.
 * @returns The set of free variable names. Iteration order is first
 * appearance, which callers needing determinism should sort rather than rely on.
 */
export function freeVariables(node: SymbolicNode): ReadonlySet<string> {
	const names = new Set<string>();
	collectVariables(node, names);
	return names;
}

/** Recursive worker for {@link freeVariables}, kept separate so the public entry point allocates one set rather than one per level. */
function collectVariables(node: SymbolicNode, into: Set<string>): void {
	switch (node.kind) {
		case "const":
			return;
		case "var":
			into.add(node.name);
			return;
		case "neg":
			collectVariables(node.operand, into);
			return;
		case "pow":
			collectVariables(node.base, into);
			collectVariables(node.exponent, into);
			return;
		case "call":
			for (const arg of node.args) collectVariables(arg, into);
			return;
		case "add":
		case "sub":
		case "mul":
		case "div":
			collectVariables(node.left, into);
			collectVariables(node.right, into);
	}
}
