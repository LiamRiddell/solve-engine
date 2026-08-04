/**
 * Polynomial factoring over the rationals.
 *
 * The property test at the bottom is the one that matters most: it checks that
 * multiplying the factors back out reproduces the input, over many generated
 * polynomials. A wrong factorization is the failure mode here, and it is far
 * more likely to be caught by that round trip than by any list of hand-written
 * cases.
 */
import { describe, expect, test } from "@jest/globals";
import { factorSymbolic, rationalRoots, FACTOR_MAX_DEGREE } from "@solve-js/symbolic/Factor";
import { expandSymbolic } from "@solve-js/symbolic/Polynomial";
import { simplifySymbolic, formatSymbolic, symbolicKey, constNode, varNode, type SymbolicNode } from "@solve-js/symbolic";
import { rational } from "@solve-js/symbolic/Rational";

/** Parses nothing; builds the tree for a univariate polynomial from descending integer coefficients. */
function poly(descending: number[], variable = "x"): SymbolicNode {
	let result: SymbolicNode = constNode(0);
	const degree = descending.length - 1;
	descending.forEach((coeff, index) => {
		if (coeff === 0) return;
		const power = degree - index;
		let term: SymbolicNode = constNode(coeff);
		if (power === 1) term = { kind: "mul", left: term, right: varNode(variable) };
		else if (power > 1) {
			term = { kind: "mul", left: term, right: { kind: "pow", base: varNode(variable), exponent: constNode(power) } };
		}
		result = { kind: "add", left: result, right: term };
	});
	return simplifySymbolic(result);
}

/** Factors and renders, the way a user sees it. */
function factored(descending: number[]): string {
	return formatSymbolic(simplifySymbolic(factorSymbolic(poly(descending))));
}

describe("factorSymbolic — the strategies, separately", () => {
	test("difference of squares", () => {
		expect(factored([1, 0, -4])).toBe("(x-2)*(x+2)");
	});

	test("a monic quadratic with two rational roots", () => {
		expect(factored([1, 3, 2])).toBe("(x+1)*(x+2)");
	});

	test("a common monomial factor comes out front", () => {
		expect(factored([2, 4, 0])).toBe("2x*(x+2)");
	});

	test("difference of cubes leaves an irreducible quadratic behind", () => {
		expect(factored([1, 0, 0, -1])).toBe("(x-1)*(x^2+x+1)");
	});

	test("a repeated root becomes one factor with a power", () => {
		expect(factored([1, -2, 1])).toBe("(x-1)^2");
	});

	test("a non-monic leading coefficient", () => {
		// 2x^2 + 5x + 2 = (x+2)(2x+1); the 2 stays inside the surviving factor.
		expect(expandSymbolic(factorSymbolic(poly([2, 5, 2])))).toEqual(expandSymbolic(poly([2, 5, 2])));
	});
});

describe("factorSymbolic — what it correctly refuses to do", () => {
	test("x^2-2 is irreducible over the rationals, so it is returned unchanged", () => {
		// It factors over the REALS as (x-sqrt2)(x+sqrt2). Emitting that would be
		// answering a different question than the one this module answers.
		expect(factored([1, 0, -2])).toBe("x^2-2");
	});

	test("x^2+1 is irreducible over the rationals, for a different reason", () => {
		// This one has no real roots at all. Complex numbers are out of scope, so
		// there is nothing to say beyond leaving it alone.
		expect(factored([1, 0, 1])).toBe("x^2+1");
	});

	test("a non-polynomial is returned unchanged rather than erroring", () => {
		const node: SymbolicNode = { kind: "call", name: "sin", args: [varNode("x")] };
		expect(symbolicKey(factorSymbolic(node))).toBe(symbolicKey(node));
	});

	test("a rational function is returned unchanged", () => {
		const node: SymbolicNode = { kind: "div", left: varNode("x"), right: varNode("y") };
		expect(symbolicKey(factorSymbolic(node))).toBe(symbolicKey(node));
	});

	test("beyond the degree ceiling it declines rather than grinding", () => {
		const tooLarge = new Array(FACTOR_MAX_DEGREE + 2).fill(0);
		tooLarge[0] = 1;
		tooLarge[tooLarge.length - 1] = -1;
		expect(symbolicKey(factorSymbolic(poly(tooLarge)))).toBe(symbolicKey(poly(tooLarge)));
	});
});

describe("rationalRoots", () => {
	test("finds both roots of a hand-computed quadratic", () => {
		const roots = rationalRoots([rational(1n), rational(0n), rational(-4n)]);
		const rendered = roots.map(r => `${r.n}/${r.d}`).sort();
		expect(rendered).toEqual(["-2/1", "2/1"]);
	});

	test("finds a non-integer root", () => {
		// 2x - 1 has the root 1/2, which only a p/q search finds.
		const roots = rationalRoots([rational(2n), rational(-1n)]);
		expect(roots.map(r => `${r.n}/${r.d}`)).toEqual(["1/2"]);
	});

	test("reports nothing for a polynomial with no rational root", () => {
		expect(rationalRoots([rational(1n), rational(0n), rational(-2n)])).toEqual([]);
	});

	test("a highly-composite coefficient hits the candidate cap rather than hanging", () => {
		// 720720 alone has 240 divisors, and the candidate set is the product of
		// two such sets. This is the termination test: it must return promptly,
		// by erroring rather than by searching.
		const start = Date.now();
		expect(() => rationalRoots([rational(720720n), rational(0n), rational(720720n)])).toThrow(
			/too many candidate rational roots|too many divisors/i,
		);
		expect(Date.now() - start).toBeLessThan(5000);
	});
});

describe("factorSymbolic — round trip property", () => {
	test("expanding a factorization reproduces the original, over generated polynomials", () => {
		// A deliberately simple seeded generator: reproducibility matters more
		// than statistical quality, and a failure here should be replayable.
		let seed = 20260804;
		const nextInt = (span: number): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return (seed % (2 * span + 1)) - span;
		};

		for (let iteration = 0; iteration < 200; iteration++) {
			const degree = 1 + (iteration % 6);
			const coefficients: number[] = [];
			for (let i = 0; i <= degree; i++) coefficients.push(nextInt(6));
			// A zero leading coefficient would silently lower the degree.
			if (coefficients[0] === 0) coefficients[0] = 1;

			const original = poly(coefficients);
			const roundTripped = expandSymbolic(factorSymbolic(original));
			expect(symbolicKey(roundTripped)).toBe(symbolicKey(expandSymbolic(original)));
		}
	});
});
