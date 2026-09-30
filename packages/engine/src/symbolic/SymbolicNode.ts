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
import type { Complex } from "@solve-js/symbolic/Complex";
import { complexEquals } from "@solve-js/symbolic/Complex";

/**
 * A symbolic (algebraic) expression tree.
 *
 * Build nodes through the constructor functions in this module rather than as
 * object literals, so constants normalize consistently.
 */
export type SymbolicNode =
	| { kind: "const"; value: Rational }
	| { kind: "complex"; value: Complex }
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
		case "complex":
			return `C(${node.value.re.n}/${node.value.re.d},${node.value.im.n}/${node.value.im.d})`;
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
		case "complex":
			return complexEquals(a.value, (b as typeof a).value);
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
export function nodeCount(node: SymbolicNode, limit = Number.POSITIVE_INFINITY): number {
	// Iterative rather than recursive, and deliberately so. A deeply nested tree
	// (a long `a+b+c+...` chain builds one nested `add` per term) would overflow
	// the native call stack before a recursive walk could finish, which made the
	// SYMBOLIC_NODE_LIMIT_EXCEEDED guard unreachable in exactly the case it
	// exists for: the caller crashed instead of being told the tree was too big.
	//
	// `limit` lets the walk stop as soon as the answer can no longer matter,
	// so the size guard costs O(limit) rather than O(tree).
	const pending: SymbolicNode[] = [node];
	let total = 0;
	while (pending.length > 0) {
		const current = pending.pop()!;
		total++;
		if (total > limit) return total;
		switch (current.kind) {
			case "const":
			case "complex":
			case "var":
				break;
			case "neg":
				pending.push(current.operand);
				break;
			case "pow":
				pending.push(current.base, current.exponent);
				break;
			case "call":
				for (const arg of current.args) pending.push(arg);
				break;
			case "add":
			case "sub":
			case "mul":
			case "div":
				pending.push(current.left, current.right);
				break;
		}
	}
	return total;
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

/**
 * The walk behind {@link freeVariables}: iterative, as {@link nodeCount} is, so
 * a chain as deep as the size guard admits is scanned rather than overflowing
 * the native stack. Children are pushed right to left so names are met left to
 * right, in order of first appearance.
 */
function collectVariables(root: SymbolicNode, into: Set<string>): void {
	const pending: SymbolicNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (node.kind === "var") {
			into.add(node.name);
			continue;
		}
		const children = childrenOf(node);
		for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
	}
}

/**
 * Whether a tree divides by an exact zero anywhere: a quotient whose
 * denominator is the constant 0, or the constant 0 raised to a negative power
 * (which is the same division, `0^-1` being `1/0`).
 *
 * The simplifier leaves such a quotient unfolded rather than throwing from the
 * middle of its walk, so the caller that builds an expression for the reader
 * asks this and refuses it: a later step that treated the quotient as ordinary
 * algebra answered `expand((x+1)/0)` as 1, by cancelling the numerator against
 * a greatest common divisor with zero. Only an exact zero counts, so a very
 * small number is not mistaken for one. Iterative, as {@link nodeCount} is.
 *
 * @param root - The tree to scan, simplified or not.
 * @returns `true` when some part of it divides by zero.
 */
export function dividesByZero(root: SymbolicNode): boolean {
	const pending: SymbolicNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (node.kind === "div" && node.right.kind === "const" && node.right.value.n === 0n) return true;
		if (
			node.kind === "pow" &&
			node.base.kind === "const" &&
			node.base.value.n === 0n &&
			node.exponent.kind === "const" &&
			node.exponent.value.n < 0n
		) {
			return true;
		}
		for (const child of childrenOf(node)) pending.push(child);
	}
	return false;
}

/**
 * Replaces every occurrence of a variable with an expression.
 *
 * @param node - The tree to rewrite.
 * @param variable - The variable name to replace.
 * @param replacement - What to put in its place.
 * @returns A new tree. The input is not modified.
 */
export function substitute(node: SymbolicNode, variable: string, replacement: SymbolicNode): SymbolicNode {
	switch (node.kind) {
		case "const":
		case "complex":
			return node;
		case "var":
			return node.name === variable ? replacement : node;
		case "neg":
			return { kind: "neg", operand: substitute(node.operand, variable, replacement) };
		case "pow":
			return {
				kind: "pow",
				base: substitute(node.base, variable, replacement),
				exponent: substitute(node.exponent, variable, replacement),
			};
		case "call":
			return { kind: "call", name: node.name, args: node.args.map(arg => substitute(arg, variable, replacement)) };
		case "add":
		case "sub":
		case "mul":
		case "div":
			return {
				kind: node.kind,
				left: substitute(node.left, variable, replacement),
				right: substitute(node.right, variable, replacement),
			};
	}
}

/**
 * Replaces every variable named in `replacements` with its expression, in one
 * walk.
 *
 * The replacements are not themselves rewritten: a replacement that mentions a
 * variable in the map keeps that variable. The walk is iterative, so a chain
 * as deep as {@link SYMBOLIC_MAX_NODES} admits is rewritten rather than
 * running out of native stack.
 *
 * @param node - The tree to rewrite.
 * @param replacements - The expression for each variable to replace. A
 * variable absent from the map is left as it is.
 * @returns A new tree, or `node` itself when nothing in it was replaced.
 */
export function substituteAll(node: SymbolicNode, replacements: ReadonlyMap<string, SymbolicNode>): SymbolicNode {
	if (replacements.size === 0) return node;
	// A post-order walk with an explicit stack: each frame records a node and
	// how many of its children have been rebuilt, which land on `built`.
	const frames: { node: SymbolicNode; next: number }[] = [{ node, next: 0 }];
	const built: SymbolicNode[] = [];
	while (frames.length > 0) {
		const frame = frames[frames.length - 1];
		const children = childrenOf(frame.node);
		if (frame.next < children.length) {
			frames.push({ node: children[frame.next++], next: 0 });
			continue;
		}
		frames.pop();
		const rebuilt = built.splice(built.length - children.length, children.length);
		built.push(rebuild(frame.node, rebuilt, replacements));
	}
	return built[0];
}

/** The direct children of a node, in the order {@link rebuild} takes them back. */
function childrenOf(node: SymbolicNode): readonly SymbolicNode[] {
	switch (node.kind) {
		case "const":
		case "complex":
		case "var":
			return [];
		case "neg":
			return [node.operand];
		case "pow":
			return [node.base, node.exponent];
		case "call":
			return node.args;
		case "add":
		case "sub":
		case "mul":
		case "div":
			return [node.left, node.right];
	}
}

/** A node rebuilt over its rewritten children, or itself when none changed. */
function rebuild(node: SymbolicNode, children: readonly SymbolicNode[], replacements: ReadonlyMap<string, SymbolicNode>): SymbolicNode {
	switch (node.kind) {
		case "const":
		case "complex":
			return node;
		case "var":
			return replacements.get(node.name) ?? node;
		case "neg":
			return children[0] === node.operand ? node : { kind: "neg", operand: children[0] };
		case "pow":
			return children[0] === node.base && children[1] === node.exponent ? node : { kind: "pow", base: children[0], exponent: children[1] };
		case "call":
			return children.every((child, i) => child === node.args[i]) ? node : { kind: "call", name: node.name, args: children };
		case "add":
		case "sub":
		case "mul":
		case "div":
			return children[0] === node.left && children[1] === node.right ? node : { kind: node.kind, left: children[0], right: children[1] };
	}
}

/**
 * A complex literal in a symbolic expression.
 *
 * Collapses to an ordinary real constant when the imaginary part is zero, so
 * `(1+i)*(1-i)` reads as `2` rather than `2+0i`. That collapse is why callers
 * should build complex values through here rather than as an object literal.
 *
 * @param value - The exact complex value.
 * @returns A complex node, or a `const` node when the value is really real.
 */
export function complexNode(value: Complex): SymbolicNode {
	if (value.im.n === 0n) return { kind: "const", value: value.re };
	return { kind: "complex", value };
}
