/**
 * Adaptive Gauss-Kronrod quadrature, checked against integrals whose values are
 * known in closed form, and against the integrands it must refuse.
 */
import { describe, expect, test } from "@jest/globals";
import { integrateNumerically, QUADRATURE_RELATIVE_TOLERANCE } from "@solve-js/symbolic/Quadrature";

/** Integrates and returns the value, failing the test when the run declined. */
function value(f: (x: number) => number, a: number, b: number): number {
	const result = integrateNumerically(f, a, b);
	if (!result.ok) throw new Error(`declined: ${result.kind}`);
	return result.value;
}

describe("integrals with known values", () => {
	test("a polynomial is integrated to rounding", () => {
		expect(value(x => x * x, 0, 3)).toBeCloseTo(9, 13);
	});

	test("sine over half a turn is two", () => {
		expect(value(Math.sin, 0, Math.PI)).toBeCloseTo(2, 13);
	});

	test("the Gaussian over a wide range is the square root of pi", () => {
		expect(value(x => Math.exp(-x * x), -10, 10)).toBeCloseTo(Math.sqrt(Math.PI), 12);
	});

	test("exp(x^2), which has no elementary antiderivative, matches its tabulated value", () => {
		// The integral of e^(x^2) from 0 to 1, (sqrt(pi)/2) * erfi(1).
		expect(value(x => Math.exp(x * x), 0, 1)).toBeCloseTo(1.4626517459071815, 12);
	});

	test("a jump is integrated as the areas either side of it", () => {
		expect(value(Math.floor, 0, 3)).toBeCloseTo(3, 9);
	});

	test("the error it reports is within the tolerance it promises", () => {
		const result = integrateNumerically(x => Math.exp(x * x), 0, 1);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.error).toBeLessThanOrEqual(QUADRATURE_RELATIVE_TOLERANCE * Math.abs(result.value));
		expect(Math.abs(result.value - 1.4626517459071815)).toBeLessThanOrEqual(Math.max(result.error, 1e-15));
	});

	test("reversed bounds negate the result, and equal bounds give zero", () => {
		expect(value(x => x * x, 3, 0)).toBeCloseTo(-9, 13);
		expect(value(x => x * x, 2, 2)).toBe(0);
	});
});

describe("what it refuses", () => {
	test("an integrand that becomes infinite inside the range is reported with where", () => {
		const result = integrateNumerically(x => 1 / (x * x), -1, 1);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const where = result.kind === "nonfinite" ? result.at : result.near;
		expect(Math.abs(where)).toBeLessThan(1e-9);
	});

	test("a sample with no value can be repaired by the caller", () => {
		// -0.125 is the centre of one of the eight starting pieces of [-1, 1], so
		// it is sampled; the integrand is 1 everywhere else.
		const asked: number[] = [];
		const result = integrateNumerically(x => (x === -0.125 ? Number.NaN : 1), -1, 1, {
			atNonFinite: x => {
				asked.push(x);
				return 1;
			},
		});
		expect(asked).toEqual([-0.125]);
		expect(result).toMatchObject({ ok: true });
		if (result.ok) expect(result.value).toBeCloseTo(2, 13);
	});

	test("a sample the caller cannot repair ends the run with that point", () => {
		const result = integrateNumerically(x => (x === -0.125 ? Number.NaN : 1), -1, 1, { atNonFinite: () => null });
		expect(result).toEqual({ ok: false, kind: "nonfinite", at: -0.125 });
	});
});
