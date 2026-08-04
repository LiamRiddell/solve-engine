/**
 * Polynomial division, greatest common divisors, and rational cancellation.
 *
 * The division identity is the property that matters: for any pair, the
 * quotient and remainder must satisfy `a = b*q + r` with `r` of lower degree.
 * That single law catches almost every way long division can be got wrong, and
 * it holds exactly here because the coefficients are exact. In floating point
 * the Euclidean algorithm has to decide whether a remainder is zero, and that
 * question has no reliable answer.
 */
import { describe, expect, test } from "@jest/globals";
import {
	polynomialDivide,
	coefficientGcd,
	polynomialGcd,
	cancelRational,
	cancelSymbolic,
	squareFreePart,
	evaluateCoefficients,
	isZeroPolynomial,
} from "@solve-js/symbolic/Gcd";
import { toPolynomial, fromPolynomial, polyCoefficients, expandSymbolic } from "@solve-js/symbolic/Polynomial";
import { simplifySymbolic, formatSymbolic, constNode, varNode, type SymbolicNode } from "@solve-js/symbolic";
import { type Rational, rational, RATIONAL_ZERO, rationalAdd, rationalMul, isRationalZero } from "@solve-js/symbolic/Rational";
import { poly, seededInts } from "@tools/symbolicTestUtils";

/** Ascending coefficients from integers, so `[1, 2]` is `1 + 2x`. */
function coeffs(values: number[]): Rational[] {
	return values.map(v => rational(BigInt(v)));
}

/** Renders ascending coefficients as an expression, for readable assertions. */
function render(values: readonly Rational[]): string {
	const terms = new Map<string, Rational>();
	values.forEach((coefficient, power) => {
		if (isRationalZero(coefficient)) return;
		terms.set(power === 0 ? "" : power === 1 ? "x" : `x^${power}`, coefficient);
	});
	return formatSymbolic(fromPolynomial({ terms, vars: terms.size > 0 ? ["x"] : [] }));
}

/** Multiplies two ascending coefficient lists. */
function multiply(a: readonly Rational[], b: readonly Rational[]): Rational[] {
	const result: Rational[] = new Array(Math.max(0, a.length + b.length - 1)).fill(RATIONAL_ZERO);
	a.forEach((left, i) => b.forEach((right, j) => {
		result[i + j] = rationalAdd(result[i + j], rationalMul(left, right));
	}));
	return result;
}

describe("polynomialDivide", () => {
	test("an exact division leaves no remainder", () => {
		// (x^2 - 1) / (x - 1) = x + 1
		const { quotient, remainder } = polynomialDivide(coeffs([-1, 0, 1]), coeffs([-1, 1]));
		expect(render(quotient)).toBe("x+1");
		expect(isZeroPolynomial(remainder)).toBe(true);
	});

	test("a division with a remainder", () => {
		// (x^2 + 1) / (x - 1) = x + 1 remainder 2
		const { quotient, remainder } = polynomialDivide(coeffs([1, 0, 1]), coeffs([-1, 1]));
		expect(render(quotient)).toBe("x+1");
		expect(render(remainder)).toBe("2");
	});

	test("dividing by a higher degree gives a zero quotient", () => {
		const { quotient, remainder } = polynomialDivide(coeffs([1, 1]), coeffs([0, 0, 1]));
		expect(isZeroPolynomial(quotient)).toBe(true);
		expect(render(remainder)).toBe("x+1");
	});

	test("dividing by the zero polynomial is a caller error", () => {
		expect(() => polynomialDivide(coeffs([1]), [])).toThrow(/zero polynomial/i);
	});

	test("the division identity holds over generated pairs", () => {
		const nextInt = seededInts(31337);
		let checked = 0;
		for (let i = 0; i < 200; i++) {
			const a = coeffs(Array.from({ length: 1 + (i % 5) }, () => nextInt(6)));
			const b = coeffs(Array.from({ length: 1 + (i % 3) }, () => nextInt(6)));
			if (isZeroPolynomial(b)) continue;

			const { quotient, remainder } = polynomialDivide(a, b);
			// a must equal b*q + r, exactly.
			const rebuilt = multiply(b, quotient);
			const withRemainder = rebuilt.slice();
			remainder.forEach((coefficient, power) => {
				while (withRemainder.length <= power) withRemainder.push(RATIONAL_ZERO);
				withRemainder[power] = rationalAdd(withRemainder[power], coefficient);
			});
			expect(render(withRemainder)).toBe(render(a));

			// And the remainder must be of strictly lower degree than the divisor.
			const divisorDegree = b.length - 1 - [...b].reverse().findIndex(c => !isRationalZero(c));
			if (remainder.length > 0) expect(remainder.length - 1).toBeLessThan(divisorDegree);
			checked++;
		}
		expect(checked).toBeGreaterThan(150);
	});
});

describe("coefficientGcd", () => {
	test("a shared linear factor is found", () => {
		// x^2-1 and x^2-3x+2 share (x-1).
		expect(render(coefficientGcd(coeffs([-1, 0, 1]), coeffs([2, -3, 1])))).toBe("x-1");
	});

	test("coprime polynomials give one", () => {
		expect(render(coefficientGcd(coeffs([1, 0, 1]), coeffs([-1, 1])))).toBe("1");
	});

	test("the gcd of a polynomial with itself is that polynomial, made monic", () => {
		expect(render(coefficientGcd(coeffs([-2, 0, 2]), coeffs([-2, 0, 2])))).toBe("x^2-1");
	});

	test("the gcd with zero is the other polynomial", () => {
		expect(render(coefficientGcd(coeffs([-1, 1]), []))).toBe("x-1");
	});

	test("the gcd divides both inputs exactly", () => {
		const nextInt = seededInts(777);
		let checked = 0;
		for (let i = 0; i < 120; i++) {
			const a = coeffs(Array.from({ length: 2 + (i % 4) }, () => nextInt(5)));
			const b = coeffs(Array.from({ length: 2 + (i % 3) }, () => nextInt(5)));
			if (isZeroPolynomial(a) || isZeroPolynomial(b)) continue;

			const gcd = coefficientGcd(a, b);
			if (gcd.length === 0) continue;
			expect(isZeroPolynomial(polynomialDivide(a, gcd).remainder)).toBe(true);
			expect(isZeroPolynomial(polynomialDivide(b, gcd).remainder)).toBe(true);
			checked++;
		}
		expect(checked).toBeGreaterThan(80);
	});
});

describe("polynomialGcd declines what it cannot do", () => {
	test("more than one variable is refused rather than guessed", () => {
		const a = toPolynomial({ kind: "mul", left: varNode("x"), right: varNode("y") })!;
		const b = toPolynomial(varNode("x"))!;
		expect(polynomialGcd(a, b)).toBeNull();
	});
});

describe("cancelSymbolic", () => {
	const div = (a: SymbolicNode, b: SymbolicNode): SymbolicNode => ({ kind: "div", left: a, right: b });
	const show = (n: SymbolicNode) => formatSymbolic(simplifySymbolic(cancelSymbolic(n)));

	test("a shared factor cancels", () => {
		expect(show(div(poly([1, 0, -1]), poly([1, -1])))).toBe("x+1");
		expect(show(div(poly([1, 0, -4]), poly([1, 2])))).toBe("x-2");
		expect(show(div(poly([1, 0, 0, -1]), poly([1, -1])))).toBe("x^2+x+1");
	});

	test("a numeric factor is divided through as well", () => {
		// The gcd is monic, so it carries no numeric factor away with it. Without
		// the extra step this stops at `(2x+4)/2`.
		expect(show(div(poly([2, 4, 0]), poly([2, 0])))).toBe("x+2");
		expect(show(div(poly([6, 0, 0]), poly([3, 0])))).toBe("2x");
	});

	test("a constant denominator alone is left as written", () => {
		// Dividing through here would rewrite `x/3` as `1/3x`: the same number, and
		// a worse way to write it. The constant is only folded in as the last step
		// of a cancellation that already happened.
		expect(show(div(varNode("x"), constNode(3)))).toBe("x/3");
		expect(show(div(poly([2, 4]), poly([2])))).toBe("(2x+4)/2");
	});

	test("nothing shared means nothing changes", () => {
		expect(show(div(poly([1, 0, 1]), poly([1, -1])))).toBe("(x^2+1)/(x-1)");
		expect(show(div(constNode(1), varNode("x")))).toBe("1/x");
	});

	test("a rational function in two variables is left alone", () => {
		expect(show(div(varNode("vx"), varNode("sx")))).toBe("vx/sx");
	});

	test("a zero denominator is not divided through", () => {
		// The zero polynomial has an empty term map, which must not be mistaken
		// for a constant of one.
		expect(show(div(constNode(1), constNode(0)))).toBe("1/0");
	});

	test("cancelling then multiplying back reproduces the original", () => {
		// (x^4-1)/(x^2-1) is x^2+1, and (x^2+1)*(x^2-1) is x^4-1.
		const reduced = cancelSymbolic(div(poly([1, 0, 0, 0, -1]), poly([1, 0, -1])));
		// expandSymbolic, not simplifySymbolic: the simplifier never multiplies out
		// a product of sums, which is the invariant that keeps it from expanding.
		const rebuilt = expandSymbolic({ kind: "mul", left: reduced, right: poly([1, 0, -1]) });
		expect(formatSymbolic(rebuilt)).toBe(formatSymbolic(poly([1, 0, 0, 0, -1])));
	});
});

describe("cancelRational preserves value", () => {
	test("the reduced fraction agrees with the original at sample points", () => {
		const numerator = toPolynomial(poly([1, 0, 0, -1]))!;
		const denominator = toPolynomial(poly([1, -1]))!;
		const reduced = cancelRational(numerator, denominator)!;

		for (const point of [2, 3, -2, 0.5]) {
			const at = rational(BigInt(Math.round(point * 100)), 100n);
			const original = evaluateCoefficients(polyCoefficients(numerator, "x"), at);
			const originalDenominator = evaluateCoefficients(polyCoefficients(denominator, "x"), at);
			const reducedValue = evaluateCoefficients(polyCoefficients(reduced.numerator, "x"), at);
			const reducedDenominator = evaluateCoefficients(polyCoefficients(reduced.denominator, "x"), at);
			// a/b == c/d exactly when a*d == c*b, which avoids a division.
			expect(rationalMul(original, reducedDenominator)).toEqual(rationalMul(reducedValue, originalDenominator));
		}
	});
});

describe("squareFreePart", () => {
	test("a repeated factor is reduced to a single copy", () => {
		// (x-1)^2 = x^2-2x+1, whose square-free part is x-1.
		expect(render(squareFreePart(coeffs([1, -2, 1])))).toBe("x-1");
	});

	test("an already square-free polynomial is unchanged apart from being made monic", () => {
		expect(render(squareFreePart(coeffs([-1, 0, 1])))).toBe("x^2-1");
	});

	test("a cube reduces to its base", () => {
		// (x+1)^3 = x^3+3x^2+3x+1
		expect(render(squareFreePart(coeffs([1, 3, 3, 1])))).toBe("x+1");
	});
});
