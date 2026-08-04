/**
 * Partial-fraction decomposition, and the integration built on it.
 *
 * The law that carries the weight here is that a decomposition must add back up
 * to what it came from. Recombining the pieces over the original denominator
 * and comparing to the original numerator catches a wrong coefficient far more
 * reliably than reading the output, and it holds exactly rather than to
 * tolerance because the arithmetic is exact.
 */
import { describe, expect, test } from "@jest/globals";
import {
	partialFractions,
	apartSymbolic,
	asRationalFunction,
	coefficientsToNode,
	multiplyCoefficients,
	powerCoefficients,
	APART_MAX_DEGREE,
} from "@solve-js/symbolic/PartialFractions";
import { integrate } from "@solve-js/symbolic/Integral";
import { differentiate } from "@solve-js/symbolic/Derivative";
import { simplifySymbolic, formatSymbolic, varNode, constNode, type SymbolicNode } from "@solve-js/symbolic";
import { type Rational, rational, RATIONAL_ZERO, rationalAdd, rationalSub, isRationalZero } from "@solve-js/symbolic/Rational";
import { evaluateNumerically, seededInts } from "@tools/symbolicTestUtils";

/** Ascending coefficients from integers, so `[1, 2]` is `1 + 2x`. */
function coeffs(values: number[]): Rational[] {
	return values.map(value => rational(BigInt(value)));
}

/** Adds two ascending coefficient lists. */
function add(a: readonly Rational[], b: readonly Rational[]): Rational[] {
	const result: Rational[] = [];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		result.push(rationalAdd(a[i] ?? RATIONAL_ZERO, b[i] ?? RATIONAL_ZERO));
	}
	return result;
}

/**
 * Recombines a decomposition over the original denominator.
 *
 * Each piece contributes its numerator times the denominator divided by its own
 * base to the right power, which is the same identity the solver set up. Doing
 * it independently here is the point: if both got it wrong the same way the
 * check would be worthless, so this multiplies out rather than reusing the
 * solver's own columns.
 */
function recombine(numerator: number[], denominator: number[]): { rebuilt: Rational[]; expected: Rational[] } {
	const decomposition = partialFractions(coeffs(numerator), coeffs(denominator), "x");
	if (decomposition === null) throw new Error("expected a decomposition");

	let total = multiplyCoefficients(decomposition.polynomial, coeffs(denominator));
	for (const term of decomposition.terms) {
		const divisor = powerCoefficients(term.base, term.power);
		const cofactor = dividedBy(coeffs(denominator), divisor);
		total = add(total, multiplyCoefficients(term.numerator, cofactor));
	}
	return { rebuilt: total, expected: coeffs(numerator) };
}

/** Exact division of ascending coefficient lists, for the recombination above. */
function dividedBy(dividend: readonly Rational[], divisor: readonly Rational[]): Rational[] {
	const remainder = [...dividend];
	const divisorDegree = divisor.length - 1;
	const quotient: Rational[] = new Array(Math.max(0, dividend.length - divisorDegree)).fill(RATIONAL_ZERO);
	for (let degree = remainder.length - 1; degree >= divisorDegree; degree--) {
		if (isRationalZero(remainder[degree])) continue;
		const offset = degree - divisorDegree;
		const factor = divideRational(remainder[degree], divisor[divisorDegree]);
		quotient[offset] = factor;
		for (let i = 0; i <= divisorDegree; i++) {
			remainder[offset + i] = rationalSub(remainder[offset + i], multiplyRational(factor, divisor[i]));
		}
	}
	return quotient;
}

/** Rational division, kept local so this spec does not lean on the module it is checking. */
function divideRational(a: Rational, b: Rational): Rational {
	return rational(a.n * b.d, a.d * b.n);
}

/** Rational multiplication, kept local for the same reason. */
function multiplyRational(a: Rational, b: Rational): Rational {
	return rational(a.n * b.n, a.d * b.d);
}

/** Asserts a decomposition of `numerator/denominator` adds back up to the original. */
function expectRecombines(numerator: number[], denominator: number[]): void {
	const { rebuilt, expected } = recombine(numerator, denominator);
	for (let i = 0; i < Math.max(rebuilt.length, expected.length); i++) {
		const left = rebuilt[i] ?? RATIONAL_ZERO;
		const right = expected[i] ?? RATIONAL_ZERO;
		expect(isRationalZero(rationalSub(left, right))).toBe(true);
	}
}

/** Renders `apart` of a quotient built from ascending coefficient lists. */
function apart(numerator: number[], denominator: number[]): string {
	const node: SymbolicNode = {
		kind: "div",
		left: coefficientsToNode(coeffs(numerator), "x"),
		right: coefficientsToNode(coeffs(denominator), "x"),
	};
	return formatSymbolic(apartSymbolic(node));
}

describe("partialFractions", () => {
	test("distinct linear factors", () => {
		// (3x+5)/(x^2-1) = 4/(x-1) - 1/(x+1)
		expect(apart([5, 3], [-1, 0, 1])).toBe("4/(x-1)-1/(x+1)");
		expectRecombines([5, 3], [-1, 0, 1]);
	});

	test("a repeated factor gets one piece per power", () => {
		// 1/(x(x+1)^2)
		expect(apart([1], [0, 1, 2, 1])).toBe("1/x-1/(x+1)-1/(x+1)^2");
		expectRecombines([1], [0, 1, 2, 1]);
	});

	test("a power of the variable itself is split off", () => {
		// The rational-root theorem finds nothing when the constant term is zero,
		// so x^3-x has to have its factor of x removed before factoring.
		expect(apart([1, 0, 1], [0, -1, 0, 1])).toBe("-1/x+1/(x-1)+1/(x+1)");
		expectRecombines([1, 0, 1], [0, -1, 0, 1]);
	});

	test("an improper fraction keeps its polynomial part", () => {
		// (x^3+1)/(x^2-1) = x + 1/(x-1), after the shared factor of (x+1) cancels.
		expect(apart([1, 0, 0, 1], [-1, 0, 1])).toBe("x+1/(x-1)");
	});

	test("an irreducible quadratic denominator is left whole", () => {
		expect(apart([3, 2], [1, 1, 1])).toBe("(2x+3)/(x^2+x+1)");
	});

	test("a fraction that reduces to a polynomial has no fraction part at all", () => {
		// (x^2-1)/(x-1) is x+1, so there is nothing to decompose.
		const decomposition = partialFractions(coeffs([-1, 0, 1]), coeffs([-1, 1]), "x");
		expect(decomposition).not.toBeNull();
		expect(decomposition!.terms).toEqual([]);
	});

	test("a constant denominator is not a rational function", () => {
		expect(partialFractions(coeffs([1, 1]), coeffs([3]), "x")).toBeNull();
	});

	test("a denominator above the degree ceiling declines rather than solving a large system", () => {
		const denominator = new Array(APART_MAX_DEGREE + 2).fill(0).map((_, i) => (i === 0 ? -1 : i === APART_MAX_DEGREE + 1 ? 1 : 0));
		expect(partialFractions(coeffs([1]), coeffs(denominator), "x")).toBeNull();
	});

	test("a non-quotient is returned unchanged", () => {
		expect(formatSymbolic(apartSymbolic(varNode("x")))).toBe("x");
		expect(asRationalFunction(varNode("x"))).toBeNull();
	});

	test("two unknowns are refused rather than decomposed in one of them", () => {
		const node: SymbolicNode = { kind: "div", left: varNode("y"), right: { kind: "sub", left: varNode("x"), right: constNode(1) } };
		expect(asRationalFunction(node)).toBeNull();
	});

	test("every generated decomposition adds back up to what it came from", () => {
		const nextInt = seededInts(90210);
		let checked = 0;
		for (let i = 0; i < 80; i++) {
			// Built as a product of linear factors, so the denominator is guaranteed
			// to factor and the decomposition is guaranteed to exist.
			const roots = [nextInt(4), nextInt(4), nextInt(4)].slice(0, 2 + (i % 2));
			let denominator = coeffs([1]);
			for (const root of roots) denominator = multiplyCoefficients(denominator, coeffs([-root, 1]));

			const numerator = [nextInt(5), nextInt(5)];
			if (numerator.every(value => value === 0)) continue;
			const decomposition = partialFractions(numerator.map(v => rational(BigInt(v))), denominator, "x");
			if (decomposition === null) continue;

			expectRecombines(numerator, denominator.map(value => Number(value.n) / Number(value.d)));
			checked++;
		}
		expect(checked).toBeGreaterThan(40);
	});
});

describe("integrating a rational function", () => {
	/** Integrates an expression given as a string-free tree, and renders it. */
	function integrated(numerator: number[], denominator: number[]): string {
		const node: SymbolicNode = {
			kind: "div",
			left: coefficientsToNode(coeffs(numerator), "x"),
			right: coefficientsToNode(coeffs(denominator), "x"),
		};
		const result = integrate(node, "x");
		if (!result.ok) throw new Error(result.reason);
		return formatSymbolic(result.value);
	}

	test("distinct linear factors give logarithms", () => {
		expect(integrated([5, 3], [-1, 0, 1])).toBe("4*log(x-1)-log(x+1)");
	});

	test("a repeated linear factor gives a power, not a logarithm", () => {
		expect(integrated([1], [1, -2, 1])).toBe("-1/(x-1)");
	});

	test("an irreducible quadratic gives an arctangent", () => {
		expect(integrated([1], [2, 2, 1])).toBe("atan(x+1)");
		expect(integrated([1], [4, 0, 1])).toBe("0.5*atan(x/2)");
	});

	test("a quadratic whose numerator is its own derivative gives only a logarithm", () => {
		// (x+1)/(x^2+2x+5): the arctangent part cancels exactly.
		expect(integrated([1, 1], [5, 2, 1])).toBe("0.5*log(x^2+2x+5)");
	});

	test("an improper fraction integrates its polynomial part too", () => {
		expect(integrated([0, 0, 1], [1, 0, 1])).toBe("x-atan(x)");
	});

	test("a repeated irreducible quadratic is declined with a reason", () => {
		// 1/(x^2+1)^2 needs a reduction formula, which this does not have.
		const result = integrate(
			{ kind: "div", left: constNode(1), right: coefficientsToNode(coeffs([1, 0, 2, 0, 1]), "x") },
			"x",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/reduction formula/i);
	});

	test("differentiating the antiderivative returns the integrand", () => {
		// The strongest check available: integration and differentiation are
		// inverses, and differentiation is the side that always succeeds.
		const cases: [number[], number[]][] = [
			[[5, 3], [-1, 0, 1]],
			[[1], [1, -2, 1]],
			[[1], [2, 2, 1]],
			[[0, 0, 1], [1, 0, 1]],
			[[1, 1], [5, 2, 1]],
		];
		for (const [numerator, denominator] of cases) {
			const integrand: SymbolicNode = {
				kind: "div",
				left: coefficientsToNode(coeffs(numerator), "x"),
				right: coefficientsToNode(coeffs(denominator), "x"),
			};
			const result = integrate(integrand, "x");
			expect(result.ok).toBe(true);
			if (!result.ok) continue;

			const derivative = simplifySymbolic(differentiate(result.value, "x"));
			for (const point of [0.3, 1.7, 2.9, -3.1]) {
				const expected = evaluateNumerically(integrand, { x: point });
				expect(evaluateNumerically(derivative, { x: point })).toBeCloseTo(expected, 9);
			}
		}
	});
});
