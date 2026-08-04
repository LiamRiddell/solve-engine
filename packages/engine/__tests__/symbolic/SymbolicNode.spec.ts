/**
 * The expression tree's own utilities: structural keys, equality, size, free
 * variables and substitution.
 *
 * These are small, but three of them are load-bearing in ways worth pinning.
 * `symbolicKey` is the equality test the whole system relies on, `nodeCount` is
 * what makes the size guard reachable, and `substitute` is what Taylor
 * expansion uses to evaluate a derivative at a point.
 */
import { describe, expect, test } from "@jest/globals";
import {
	symbolicKey,
	nodesEqual,
	nodeCount,
	freeVariables,
	substitute,
	constNode,
	varNode,
	powNode,
	callNode,
	formatSymbolic,
	simplifySymbolic,
	type SymbolicNode,
} from "@solve-js/symbolic";
import { rational } from "@solve-js/symbolic/Rational";

const x = varNode("x");
const y = varNode("y");

describe("symbolicKey", () => {
	test("identical trees produce identical keys", () => {
		const a: SymbolicNode = { kind: "add", left: x, right: constNode(1) };
		const b: SymbolicNode = { kind: "add", left: varNode("x"), right: constNode(1) };
		expect(symbolicKey(a)).toBe(symbolicKey(b));
	});

	test("structurally different trees produce different keys, including operand order", () => {
		const a: SymbolicNode = { kind: "sub", left: x, right: y };
		const b: SymbolicNode = { kind: "sub", left: y, right: x };
		expect(symbolicKey(a)).not.toBe(symbolicKey(b));
	});

	test("a key distinguishes the operator, not just the operands", () => {
		expect(symbolicKey({ kind: "add", left: x, right: y })).not.toBe(symbolicKey({ kind: "mul", left: x, right: y }));
	});

	test("equal constants written differently key identically, since rationals normalize", () => {
		expect(symbolicKey(constNode(rational(2n, 4n)))).toBe(symbolicKey(constNode(0.5)));
	});

	test("a key is usable as a Map key, which is what memoization needs", () => {
		const seen = new Map<string, number>();
		seen.set(symbolicKey(powNode(x, constNode(2))), 1);
		expect(seen.get(symbolicKey(powNode(varNode("x"), constNode(2))))).toBe(1);
	});
});

describe("nodesEqual", () => {
	test("agrees with symbolicKey across the node kinds", () => {
		const trees: SymbolicNode[] = [
			constNode(3),
			x,
			{ kind: "add", left: x, right: y },
			{ kind: "neg", operand: x },
			powNode(x, constNode(2)),
			callNode("sqrt", [x]),
			{ kind: "div", left: x, right: y },
		];
		for (const a of trees) {
			for (const b of trees) {
				expect(nodesEqual(a, b)).toBe(symbolicKey(a) === symbolicKey(b));
			}
		}
	});

	test("a call compares its name and every argument", () => {
		expect(nodesEqual(callNode("sqrt", [x]), callNode("sin", [x]))).toBe(false);
		expect(nodesEqual(callNode("atan2", [x, y]), callNode("atan2", [x, y]))).toBe(true);
		expect(nodesEqual(callNode("atan2", [x, y]), callNode("atan2", [y, x]))).toBe(false);
	});
});

describe("nodeCount", () => {
	test("counts every node", () => {
		expect(nodeCount(x)).toBe(1);
		expect(nodeCount({ kind: "add", left: x, right: constNode(1) })).toBe(3);
		expect(nodeCount(powNode({ kind: "add", left: x, right: y }, constNode(2)))).toBe(5);
	});

	test("the limit stops the walk early, which is what makes the size guard cheap", () => {
		let deep: SymbolicNode = x;
		for (let i = 0; i < 50; i++) deep = { kind: "add", left: deep, right: constNode(1) };
		expect(nodeCount(deep, 10)).toBeLessThanOrEqual(11);
	});

	test("a deeply nested tree does not overflow the stack", () => {
		// Recursive counting blew the native stack here, which made the
		// SYMBOLIC_NODE_LIMIT_EXCEEDED guard unreachable for exactly the trees it
		// was meant to catch: the caller crashed instead of being told.
		let deep: SymbolicNode = x;
		for (let i = 0; i < 50_000; i++) deep = { kind: "add", left: deep, right: constNode(1) };
		expect(() => nodeCount(deep)).not.toThrow();
		expect(nodeCount(deep)).toBe(100_001);
	});
});

describe("freeVariables", () => {
	test("collects across every node kind", () => {
		const node: SymbolicNode = {
			kind: "add",
			left: callNode("sqrt", [x]),
			right: powNode(y, { kind: "neg", operand: varNode("n") }),
		};
		expect([...freeVariables(node)].sort()).toEqual(["n", "x", "y"]);
	});

	test("a constant expression has none", () => {
		expect(freeVariables(constNode(5)).size).toBe(0);
	});

	test("a repeated variable is reported once", () => {
		expect([...freeVariables({ kind: "mul", left: x, right: x })]).toEqual(["x"]);
	});
});

describe("substitute", () => {
	test("replaces every occurrence", () => {
		const node: SymbolicNode = { kind: "add", left: powNode(x, constNode(2)), right: x };
		expect(formatSymbolic(simplifySymbolic(substitute(node, "x", constNode(3))))).toBe("12");
	});

	test("leaves other variables alone", () => {
		const node: SymbolicNode = { kind: "add", left: x, right: y };
		expect(formatSymbolic(substitute(node, "x", constNode(1)))).toBe("1+y");
	});

	test("reaches inside a call's arguments", () => {
		expect(formatSymbolic(substitute(callNode("sqrt", [x]), "x", constNode(4)))).toBe("sqrt(4)");
	});

	test("substituting an expression rather than a constant", () => {
		const node = powNode(x, constNode(2));
		const replaced = substitute(node, "x", { kind: "add", left: y, right: constNode(1) });
		expect(formatSymbolic(replaced)).toBe("(y+1)^2");
	});

	test("does not modify the input tree", () => {
		const node: SymbolicNode = { kind: "add", left: x, right: constNode(1) };
		const before = symbolicKey(node);
		substitute(node, "x", constNode(9));
		expect(symbolicKey(node)).toBe(before);
	});

	test("substituting a name that is not present changes nothing", () => {
		const node: SymbolicNode = { kind: "add", left: x, right: constNode(1) };
		expect(symbolicKey(substitute(node, "z", constNode(9)))).toBe(symbolicKey(node));
	});
});
