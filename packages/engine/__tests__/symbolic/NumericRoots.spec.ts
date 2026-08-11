/**
 * The simultaneous numerical root finder.
 *
 * Two properties carry the weight here, and neither is "the numbers look
 * right". Every root returned is substituted back over the complex plane and
 * has to leave a residual at the level of rounding, and the roots as a set have
 * to be as many as the polynomial has. The second is the one the old
 * sign-change scan failed: it could only see roots on the real line, so a
 * quintic with one real root and two conjugate pairs came back with one number
 * and no indication that four were missing.
 */
import { describe, expect, test } from "@jest/globals";
import { approximateRoots, type ApproximateRoot } from "@solve-js/symbolic/NumericRoots";
import { rational, type Rational } from "@solve-js/symbolic/Rational";

/** Descending exact coefficients from plain integers. */
function coefficients(descending: number[]): Rational[] {
	return descending.map(value => rational(BigInt(value)));
}

/** Horner evaluation over the complex plane, the independent check every case here uses. */
function evaluateAt(descending: readonly number[], root: ApproximateRoot): { re: number; im: number } {
	let re = 0;
	let im = 0;
	for (const coefficient of descending) {
		const nextRe = re * root.re - im * root.im + coefficient;
		im = re * root.im + im * root.re;
		re = nextRe;
	}
	return { re, im };
}

/** The magnitude Horner's method reaches, which is the scale a residual means anything against. */
function evaluationScale(descending: readonly number[], root: ApproximateRoot): number {
	const radius = Math.hypot(root.re, root.im);
	let total = 0;
	for (const coefficient of descending) total = total * radius + Math.abs(coefficient);
	return Math.max(1, total);
}

/** Solves and fails loudly rather than returning null into an assertion that would read as a length mismatch. */
function rootsOf(descending: number[]): ApproximateRoot[] {
	const roots = approximateRoots(coefficients(descending));
	if (roots === null) throw new Error(`approximateRoots declined [${descending.join(", ")}]`);
	return roots;
}

/** Asserts every root satisfies the polynomial. */
function expectAllSatisfy(descending: number[], roots: readonly ApproximateRoot[]): void {
	for (const root of roots) {
		const value = evaluateAt(descending, root);
		const residual = Math.hypot(value.re, value.im);
		if (!(residual <= 1e-10 * evaluationScale(descending, root))) {
			throw new Error(`root ${root.re}+${root.im}i of [${descending.join(", ")}] leaves a residual of ${residual}`);
		}
	}
}

describe("approximateRoots finds all of them", () => {
	const cases: { name: string; descending: number[]; distinct: number }[] = [
		{ name: "the four primitive fifth roots of unity", descending: [1, 1, 1, 1, 1], distinct: 4 },
		{ name: "a quintic with one real root and two conjugate pairs", descending: [1, 0, 0, 0, 1, 1], distinct: 5 },
		{ name: "a quartic with no real roots", descending: [1, 0, 0, 1, 1], distinct: 4 },
		{ name: "a sextic", descending: [1, 0, 0, 0, 0, 1, -3], distinct: 6 },
		{ name: "a degree-eight polynomial", descending: [1, 0, 0, 0, 0, 0, 0, 2, -5], distinct: 8 },
		{ name: "one with widely spread real roots", descending: [1, -111, 1110, -1000, 0], distinct: 4 },
	];

	test.each(cases)("$name: every root satisfies the polynomial", ({ descending }) => {
		expectAllSatisfy(descending, rootsOf(descending));
	});

	test.each(cases)("$name: there are $distinct of them", ({ descending, distinct }) => {
		expect(rootsOf(descending)).toHaveLength(distinct);
	});

	test("a repeated root is reported once, because the input is made square-free first", () => {
		// (x^2+1)^2 = x^4+2x^2+1 has two distinct roots, each doubled. Dividing by
		// gcd(p, p') removes the repetition exactly, which is what keeps the
		// iteration away from the multiple root it would only locate to about the
		// square root of machine epsilon.
		const roots = rootsOf([1, 0, 2, 0, 1]);
		expect(roots).toHaveLength(2);
		expectAllSatisfy([1, 0, 2, 0, 1], roots);
	});

	test("a triple root likewise, where clustering the output would not have separated it", () => {
		// (x-2)^3 expanded. Read as three near-equal estimates, these would be a
		// cluster 6e-6 wide, which no tolerance can tell from three genuinely
		// distinct roots.
		const roots = rootsOf([1, -6, 12, -8]);
		expect(roots).toHaveLength(1);
		expect(roots[0].re).toBeCloseTo(2, 9);
	});

	test("a root on the real line has an imaginary part of exactly zero", () => {
		// Not "small". A residual imaginary part on a real root reaches the display
		// and makes an ordinary answer read as a complex one.
		const roots = rootsOf([1, 0, 0, 0, 1, 1]);
		expect(roots.filter(root => root.im === 0)).toHaveLength(1);
	});

	test("a purely imaginary root has a real part of exactly zero", () => {
		// x^4+1 shifted so the roots are ±i and ±2i: (x^2+1)(x^2+4).
		const roots = rootsOf([1, 0, 5, 0, 4]);
		expect(roots.every(root => root.re === 0)).toBe(true);
	});

	test("conjugate pairs come back exactly conjugate", () => {
		// The root set of a real polynomial is closed under conjugation, so a pair
		// whose halves differ in their last bit is an artefact of the iteration.
		// Averaging them is both the better estimate and the reason the ordering
		// below is stable.
		const roots = rootsOf([1, 0, 0, 0, 0, -1]);
		const negative = roots.filter(root => root.im < 0);
		expect(negative).toHaveLength(2);
		for (const root of negative) {
			expect(roots.some(other => other.re === root.re && other.im === -root.im)).toBe(true);
		}
	});

	test("the same input gives the same output, in the same order", () => {
		// Roots reach a document as a row, and a row that reshuffles between two
		// identical keystrokes reads as the answer changing.
		expect(rootsOf([1, 0, 0, 0, 1, 1])).toEqual(rootsOf([1, 0, 0, 0, 1, 1]));
	});

	test("roots come back in ascending order", () => {
		const roots = rootsOf([1, 0, 0, 0, 0, 0, 0, 2, -5]);
		for (let i = 1; i < roots.length; i++) {
			expect(roots[i].re > roots[i - 1].re || (roots[i].re === roots[i - 1].re && roots[i].im > roots[i - 1].im)).toBe(true);
		}
	});

	test("a coefficient with no finite double value is declined rather than guessed at", () => {
		// The caller turns this into a stated shortfall. Returning whatever the
		// iteration made of an Infinity would be a list of roots for a polynomial
		// nobody wrote.
		// Built by multiplication rather than `**`, which the test target lowers to
		// Math.pow and which throws on a bigint. See `Rational.ts`'s own note.
		let enormous = 1n;
		for (let i = 0; i < 400; i++) enormous *= 10n;
		const beyondDouble: Rational[] = [rational(1n), rational(0n), rational(0n), rational(0n), rational(0n), { n: enormous, d: 1n }];
		expect(approximateRoots(beyondDouble)).toBeNull();
	});

	test("a constant is answered with no roots rather than declined", () => {
		expect(approximateRoots(coefficients([7]))).toEqual([]);
	});
});
