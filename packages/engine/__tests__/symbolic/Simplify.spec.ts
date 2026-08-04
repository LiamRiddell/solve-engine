/**
 * The bounded simplifier, and the invariant that governs it.
 *
 * The property test at the bottom is why this file exists. `Simplify.ts`
 * promises that simplification never expands, never factors, always terminates
 * and is idempotent, and that promise is load-bearing: `binaryOp()` calls it
 * once per symbolic arithmetic operation, so a rule that grew a tree would
 * compound across a long chain. Asserting node count never increases is what
 * turns that promise from a comment into something a machine checks.
 */
import { describe, expect, test } from "@jest/globals";
import {
	simplifySymbolic,
	formatSymbolic,
	symbolicKey,
	nodeCount,
	constNode,
	varNode,
	powNode,
	callNode,
	type SymbolicNode,
} from "@solve-js/symbolic";
import { rational } from "@solve-js/symbolic/Rational";
import { SYMBOLIC_MAX_NODES } from "@solve-js/symbolic/SymbolicNode";

const x = varNode("x");
const y = varNode("y");

/** Simplifies and renders. */
function simplified(node: SymbolicNode): string {
	return formatSymbolic(simplifySymbolic(node));
}

describe("pow", () => {
	test("anything to the zero is one, and to the one is itself", () => {
		expect(simplified(powNode(x, constNode(0)))).toBe("1");
		expect(simplified(powNode(x, constNode(1)))).toBe("x");
	});

	test("one to any power is one", () => {
		expect(simplified(powNode(constNode(1), x))).toBe("1");
	});

	test("zero to a positive power is zero", () => {
		expect(simplified(powNode(constNode(0), constNode(3)))).toBe("0");
	});

	test("constant folding with an integer exponent, including a negative one", () => {
		expect(simplified(powNode(constNode(2), constNode(10)))).toBe("1024");
		expect(simplified(powNode(constNode(2), constNode(-2)))).toBe("0.25");
		expect(simplified(powNode(constNode(rational(2n, 3n)), constNode(3)))).toBe("8/27");
	});

	test("a power is never expanded into repeated multiplication", () => {
		// This is what keeps a polynomial in its compact form. `x^2` staying
		// `x^2` rather than becoming `x*x` is the whole reason the invariant
		// exists.
		const result = simplifySymbolic(powNode(x, constNode(2)));
		expect(result.kind).toBe("pow");
		expect(formatSymbolic(result)).toBe("x^2");
	});

	test("nested integer powers combine, since that is always sound", () => {
		expect(simplified(powNode(powNode(x, constNode(2)), constNode(3)))).toBe("x^6");
	});

	test("nested powers do NOT combine when an exponent is not an integer", () => {
		// (x^(1/2))^2 is only x for a non-negative x, so combining here would be
		// unsound and the shape is left alone.
		const node = powNode(powNode(x, constNode(rational(1n, 2n))), constNode(2));
		expect(simplifySymbolic(node).kind).toBe("pow");
	});
});

describe("call folding is conservative", () => {
	test("an exact root folds", () => {
		expect(simplified(callNode("sqrt", [constNode(4)]))).toBe("2");
		expect(simplified(callNode("sqrt", [constNode(rational(9n, 16n))]))).toBe("0.75");
	});

	test("an inexact root does NOT fold, because there is no rational answer", () => {
		// Folding here to 1.414... is how a system advertising exact arithmetic
		// starts lying.
		expect(simplified(callNode("sqrt", [constNode(2)]))).toBe("sqrt(2)");
		expect(simplified(callNode("sqrt", [constNode(3)]))).toBe("sqrt(3)");
	});

	test("the rounding family folds exactly, including for negatives", () => {
		const half = constNode(rational(-3n, 2n));
		expect(simplified(callNode("floor", [half]))).toBe("-2");
		expect(simplified(callNode("ceil", [half]))).toBe("-1");
		expect(simplified(callNode("trunc", [half]))).toBe("-1");
		expect(simplified(callNode("round", [half]))).toBe("-1");
		expect(simplified(callNode("abs", [half]))).toBe("1.5");
		expect(simplified(callNode("sign", [half]))).toBe("-1");
	});

	test("factorial folds for a small non-negative integer only", () => {
		expect(simplified(callNode("fact", [constNode(5)]))).toBe("120");
		expect(simplified(callNode("fact", [constNode(-1)]))).toBe("fact(-1)");
		expect(simplified(callNode("fact", [constNode(rational(1n, 2n))]))).toBe("fact(0.5)");
	});

	test("the exact values at the points where these functions are rational", () => {
		expect(simplified(callNode("sin", [constNode(0)]))).toBe("0");
		expect(simplified(callNode("cos", [constNode(0)]))).toBe("1");
		expect(simplified(callNode("exp", [constNode(0)]))).toBe("1");
		expect(simplified(callNode("log", [constNode(1)]))).toBe("0");
	});

	test("those same functions stay symbolic where their value is irrational", () => {
		expect(simplified(callNode("sin", [constNode(1)]))).toBe("sin(1)");
		expect(simplified(callNode("log", [constNode(2)]))).toBe("log(2)");
		expect(simplified(callNode("exp", [constNode(1)]))).toBe("exp(1)");
	});

	test("an unknown function is carried through untouched", () => {
		expect(simplified(callNode("mystery", [constNode(3)]))).toBe("mystery(3)");
	});
});

describe("the narrow division rules", () => {
	test("a common factor cancels", () => {
		const node: SymbolicNode = { kind: "div", left: { kind: "mul", left: varNode("sx"), right: varNode("tx") }, right: varNode("sx") };
		expect(simplified(node)).toBe("tx");
	});

	test("it cancels through a leading minus too, so a pair of roots renders alike", () => {
		const product: SymbolicNode = { kind: "mul", left: constNode(2), right: callNode("sqrt", [constNode(2)]) };
		const node: SymbolicNode = { kind: "div", left: { kind: "neg", operand: product }, right: constNode(2) };
		expect(simplified(node)).toBe("-sqrt(2)");
	});

	test("a reciprocal factor canonicalizes into a division", () => {
		const reciprocal: SymbolicNode = { kind: "div", left: constNode(1), right: varNode("sx") };
		expect(simplified({ kind: "mul", left: reciprocal, right: varNode("vx") })).toBe("vx/sx");
	});

	test("a constant denominator of zero is left unfolded rather than thrown", () => {
		// A Rational has no infinity, and failing the whole line over a
		// subexpression the user may never see would be worse than reporting
		// the shape as written.
		expect(simplified({ kind: "div", left: constNode(1), right: constNode(0) })).toBe("1/0");
	});
});

describe("adjacent constant factors gather", () => {
	test("c1*(c2*rest) folds", () => {
		// Differentiation builds exactly this shape, and without the rule the
		// second derivative of x^3 renders as 3*(2*x) rather than 6x.
		const inner: SymbolicNode = { kind: "mul", left: constNode(2), right: x };
		expect(simplified({ kind: "mul", left: constNode(3), right: inner })).toBe("6x");
	});

	test("the mirrored shape folds too", () => {
		const inner: SymbolicNode = { kind: "mul", left: constNode(2), right: x };
		expect(simplified({ kind: "mul", left: inner, right: constNode(3) })).toBe("6x");
	});
});

describe("the size ceiling", () => {
	test("a tree beyond SYMBOLIC_MAX_NODES is refused rather than walked", () => {
		let huge: SymbolicNode = x;
		for (let i = 0; i < SYMBOLIC_MAX_NODES; i++) {
			huge = { kind: "add", left: huge, right: constNode(1) };
		}
		expect(() => simplifySymbolic(huge)).toThrow(/too large/i);
	});
});

describe("the governing invariant, as a property", () => {
	/** Builds a random tree of bounded depth from a seeded generator. */
	function randomTree(depth: number, next: () => number): SymbolicNode {
		if (depth <= 0) {
			const pick = next() % 3;
			if (pick === 0) return constNode(rational(BigInt((next() % 11) - 5), BigInt((next() % 4) + 1)));
			return pick === 1 ? x : y;
		}
		const kinds = ["add", "sub", "mul", "div", "neg", "pow", "call"] as const;
		const kind = kinds[next() % kinds.length];
		if (kind === "neg") return { kind: "neg", operand: randomTree(depth - 1, next) };
		// `Number`, not `BigInt`: constNode takes `number | Rational`, and test
		// files are not covered by `npm run typecheck`, so passing a bigint here
		// silently built a const node with no numerator or denominator.
		if (kind === "pow") return powNode(randomTree(depth - 1, next), constNode(next() % 4));
		if (kind === "call") return callNode(["sqrt", "sin", "abs"][next() % 3], [randomTree(depth - 1, next)]);
		return { kind, left: randomTree(depth - 1, next), right: randomTree(depth - 1, next) };
	}

	test("stays idempotent and never meaningfully grows, over 500 generated trees", () => {
		let seed = 20260804;
		const next = (): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % 1000;
		};

		let checked = 0;
		for (let i = 0; i < 500; i++) {
			const tree = randomTree(1 + (i % 4), next);
			let once: SymbolicNode;
			try {
				once = simplifySymbolic(tree);
			} catch {
				// A generated tree may divide by zero or overflow a coefficient;
				// those are reported, not silently wrong, and are not what this
				// property is about.
				continue;
			}

			// Idempotent.
			expect(symbolicKey(simplifySymbolic(once))).toBe(symbolicKey(once));

			// Bounded growth. The only permitted extra node is an all-negative
			// sum, where canonical form has no positive term to lead with and a
			// leading neg replaces what was a negative constant.
			expect(nodeCount(once)).toBeLessThanOrEqual(nodeCount(tree) + 1);
			checked++;
		}
		// Guard against the loop silently skipping everything.
		expect(checked).toBeGreaterThan(300);
	});

	test("a product of sums is NOT multiplied out, which is what never expanding means", () => {
		// This is the direct check, rather than a proxy. Expanding is exactly
		// what `expand()` is for, and the simplifier must never do it on its own.
		const node: SymbolicNode = {
			kind: "mul",
			left: { kind: "add", left: x, right: constNode(1) },
			right: { kind: "add", left: x, right: constNode(2) },
		};
		expect(formatSymbolic(simplifySymbolic(node))).toBe("(x+1)*(x+2)");
	});

	test("a power is NOT turned into repeated multiplication", () => {
		expect(formatSymbolic(simplifySymbolic(powNode({ kind: "add", left: x, right: constNode(1) }, constNode(3))))).toBe("(x+1)^3");
	});

	test("a sum leads with a positive term when it has one, so the tree does not grow", () => {
		// Canonical ordering puts the highest degree first, but a leading
		// negative term would need a `neg` wrapper where the input had a `sub`,
		// growing the tree once per additive level. Leading with a positive term
		// avoids that and reads the way a person writes it.
		const node: SymbolicNode = { kind: "sub", left: constNode(5), right: y };
		const result = simplifySymbolic(node);
		expect(formatSymbolic(result)).toBe("5-y");
		expect(nodeCount(result)).toBeLessThanOrEqual(nodeCount(node));
	});

	test("an all-negative sum still renders correctly, since there is no positive term to lead with", () => {
		const node: SymbolicNode = { kind: "sub", left: { kind: "neg", operand: y }, right: constNode(5) };
		expect(formatSymbolic(simplifySymbolic(node))).toBe("-y-5");
	});
});
