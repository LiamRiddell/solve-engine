/**
 * Factoring in more than one variable.
 *
 * This is a pattern set rather than an algorithm, so the tests come in two
 * halves. The first pins each pattern to the shape it is meant to recognise.
 * The second is the one that matters: expanding a factorization must give back
 * exactly what was factored. A pattern that fires on the wrong shape, or builds
 * the wrong second factor for a sum of cubes, fails that check no matter how
 * plausible its output looks.
 */
import { describe, expect, test } from "@jest/globals";
import { factorSymbolic } from "@solve-js/symbolic/Factor";
import { expandSymbolic } from "@solve-js/symbolic/Polynomial";
import { simplifySymbolic, formatSymbolic, varNode, constNode, powNode, type SymbolicNode } from "@solve-js/symbolic";
import { seededInts } from "@tools/symbolicTestUtils";

/** Builds `a*b`. */
function mul(a: SymbolicNode, b: SymbolicNode): SymbolicNode {
	return { kind: "mul", left: a, right: b };
}

/** Builds `a+b`. */
function add(a: SymbolicNode, b: SymbolicNode): SymbolicNode {
	return { kind: "add", left: a, right: b };
}

/** Builds `a-b`. */
function sub(a: SymbolicNode, b: SymbolicNode): SymbolicNode {
	return { kind: "sub", left: a, right: b };
}

/** `n*name^power`, the building block of every case below. */
function term(coefficient: number, name: string, exponent = 1): SymbolicNode {
	const variable = exponent === 1 ? varNode(name) : powNode(varNode(name), constNode(exponent));
	return coefficient === 1 ? variable : mul(constNode(coefficient), variable);
}

/** Factors an expression and renders the result. */
function factored(node: SymbolicNode): string {
	return formatSymbolic(factorSymbolic(simplifySymbolic(node)));
}

/** Asserts a factorization multiplies back to what it came from. */
function expectRoundTrips(node: SymbolicNode): void {
	const original = simplifySymbolic(node);
	const result = factorSymbolic(original);
	expect(formatSymbolic(expandSymbolic(result))).toBe(formatSymbolic(expandSymbolic(original)));
}

describe("difference of squares", () => {
	test("the plain case", () => {
		expect(factored(sub(term(1, "x", 2), term(1, "y", 2)))).toBe("(x-y)*(x+y)");
	});

	test("with square coefficients", () => {
		expect(factored(sub(term(4, "x", 2), term(9, "y", 2)))).toBe("(2x-3y)*(2x+3y)");
	});

	test("a coefficient that is not a perfect square declines", () => {
		// 2x^2-y^2 factors only as (sqrt(2)x-y)(sqrt(2)x+y), which is not over the
		// rationals, so leaving it alone is the correct answer.
		expect(factored(sub(term(2, "x", 2), term(1, "y", 2)))).toBe("2x^2-y^2");
	});

	test("an odd exponent declines", () => {
		expect(factored(sub(term(1, "x", 3), term(1, "y", 2)))).toBe("x^3-y^2");
	});

	test("a sum of squares is irreducible over the rationals", () => {
		expect(factored(add(term(1, "x", 2), term(1, "y", 2)))).toBe("x^2+y^2");
	});

	test("a common monomial comes out first", () => {
		// x^2 y - y^3 = y(x^2-y^2) = y(x-y)(x+y)
		expect(factored(sub(mul(term(1, "x", 2), varNode("y")), term(1, "y", 3)))).toBe("y*(x-y)*(x+y)");
	});
});

describe("sums and differences of cubes", () => {
	test("a sum of cubes", () => {
		expect(factored(add(term(1, "x", 3), term(1, "y", 3)))).toBe("(x+y)*(x^2-x*y+y^2)");
	});

	test("a difference of cubes", () => {
		expect(factored(sub(term(1, "x", 3), term(1, "y", 3)))).toBe("(x-y)*(x^2+x*y+y^2)");
	});

	test("with cube coefficients", () => {
		// x^3 - 8y^3 = (x-2y)(x^2+2xy+4y^2)
		expect(factored(sub(term(1, "x", 3), term(8, "y", 3)))).toBe("(x-2y)*(x^2+2x*y+4y^2)");
	});

	test("a sixth power matches as squares first, which is correct but not complete", () => {
		// Both patterns apply. Squares wins, and the result is a real
		// factorization even though each half factors again.
		expect(factored(sub(term(1, "x", 6), term(1, "y", 6)))).toBe("(x^3-y^3)*(x^3+y^3)");
	});
});

describe("perfect-square trinomials", () => {
	test("a positive middle term", () => {
		const node = add(add(term(1, "x", 2), mul(constNode(2), mul(varNode("x"), varNode("y")))), term(1, "y", 2));
		expect(factored(node)).toBe("(x+y)^2");
	});

	test("a negative middle term", () => {
		const node = add(sub(term(1, "x", 2), mul(constNode(2), mul(varNode("x"), varNode("y")))), term(1, "y", 2));
		expect(factored(node)).toBe("(x-y)^2");
	});

	test("a middle term of the wrong size declines", () => {
		// x^2+3xy+y^2 is not a perfect square and does not factor over the
		// rationals at all.
		const node = add(add(term(1, "x", 2), mul(constNode(3), mul(varNode("x"), varNode("y")))), term(1, "y", 2));
		expect(factored(node)).toBe("x^2+3x*y+y^2");
	});

	test("a middle term over the wrong monomial declines", () => {
		const node = add(add(term(1, "x", 2), mul(constNode(2), term(1, "y", 2))), term(1, "y", 2));
		expect(factored(node)).toBe("x^2+3y^2");
	});
});

describe("grouping", () => {
	test("four terms in two variables", () => {
		// ax+ay+bx+by = (a+b)(x+y)
		const node = add(
			add(mul(varNode("a"), varNode("x")), mul(varNode("a"), varNode("y"))),
			add(mul(varNode("b"), varNode("x")), mul(varNode("b"), varNode("y"))),
		);
		expect(factored(node)).toBe("(a+b)*(x+y)");
	});

	test("a group with a constant term", () => {
		// xy+x+y+1 = (x+1)(y+1)
		const node = add(add(mul(varNode("x"), varNode("y")), varNode("x")), add(varNode("y"), constNode(1)));
		expect(factored(node)).toBe("(x+1)*(y+1)");
	});

	test("four terms that do not group are left alone", () => {
		const node = add(add(term(1, "x", 2), varNode("y")), add(varNode("x"), term(1, "y", 3)));
		expect(factored(node)).toBe("y^3+x^2+x+y");
	});
});

describe("every factorization multiplies back to its input", () => {
	test("over the hand-written cases", () => {
		const cases: SymbolicNode[] = [
			sub(term(1, "x", 2), term(1, "y", 2)),
			sub(term(4, "x", 2), term(9, "y", 2)),
			add(term(1, "x", 3), term(1, "y", 3)),
			sub(term(1, "x", 3), term(8, "y", 3)),
			add(add(term(1, "x", 2), mul(constNode(2), mul(varNode("x"), varNode("y")))), term(1, "y", 2)),
			add(sub(term(1, "x", 2), mul(constNode(2), mul(varNode("x"), varNode("y")))), term(1, "y", 2)),
			add(
				add(mul(varNode("a"), varNode("x")), mul(varNode("a"), varNode("y"))),
				add(mul(varNode("b"), varNode("x")), mul(varNode("b"), varNode("y"))),
			),
			sub(mul(term(1, "x", 2), varNode("y")), term(1, "y", 3)),
		];
		for (const node of cases) expectRoundTrips(node);
	});

	test("over generated products that are meant to group", () => {
		const nextInt = seededInts(31415);
		let checked = 0;
		for (let i = 0; i < 60; i++) {
			// (a*x + b*y)(c*u + d*v) expanded, which is four terms and should group
			// back whenever the coefficients allow it.
			const [a, b, c, d] = [nextInt(4) || 1, nextInt(4) || 1, nextInt(4) || 1, nextInt(4) || 1];
			const left = add(mul(constNode(a), varNode("x")), mul(constNode(b), varNode("y")));
			const right = add(mul(constNode(c), varNode("u")), mul(constNode(d), varNode("v")));
			expectRoundTrips(expandSymbolic(mul(left, right)));
			checked++;
		}
		expect(checked).toBe(60);
	});

	test("over generated squares and differences of squares", () => {
		const nextInt = seededInts(27182);
		for (let i = 0; i < 60; i++) {
			const a = Math.abs(nextInt(5)) + 1;
			const b = Math.abs(nextInt(5)) + 1;
			const left = add(mul(constNode(a), varNode("x")), mul(constNode(b), varNode("y")));
			const rightMinus = sub(mul(constNode(a), varNode("x")), mul(constNode(b), varNode("y")));
			expectRoundTrips(expandSymbolic(mul(left, left)));
			expectRoundTrips(expandSymbolic(mul(left, rightMinus)));
		}
	});
});
