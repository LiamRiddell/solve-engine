/**
 * The numeric root search behind `solve` for an equation that is not a
 * polynomial.
 *
 * The functions here are plain JavaScript rather than symbolic trees, so every
 * expected root is known independently of the engine: `Math.cos(x) = x` is the
 * Dottie number, `2^x = 10` is `Math.log2(10)`. What the search must never do
 * is report a value that is not a root, so the pole, jump and underflow cases
 * matter as much as the ones that find something.
 */
import { describe, expect, test } from "@jest/globals";
import { findRealRoots, solveNumerically, NUMERIC_ROOTS_MAX, NUMERIC_SEARCH_LIMIT } from "@solve-js/symbolic/NumericSolve";
import { callNode, constNode, varNode, powNode } from "@solve-js/symbolic";

const zero = (): number => 0;

describe("finding crossings", () => {
	test("a single crossing is found to full precision", () => {
		const outcome = findRealRoots(Math.cos, x => x);
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(outcome.roots).toHaveLength(1);
		// The Dottie number, the fixed point of cosine.
		expect(outcome.roots[0]).toBeCloseTo(0.7390851332151607, 14);
	});

	test("several crossings come back in ascending order", () => {
		const outcome = findRealRoots(Math.exp, x => x + 2);
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(outcome.roots).toHaveLength(2);
		expect(outcome.roots[0]).toBeLessThan(outcome.roots[1]);
		for (const root of outcome.roots) expect(Math.abs(Math.exp(root) - root - 2)).toBeLessThan(1e-12);
	});

	test("a root far from zero is still reached in the default range", () => {
		const outcome = findRealRoots(Math.log, () => 12);
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(outcome.roots[0]).toBeCloseTo(Math.exp(12), 6);
	});

	test("a root that is a whole number comes back as that whole number", () => {
		// Bisection can stop a hair either side of 3; 3 itself is an exact root.
		const outcome = findRealRoots(x => Math.pow(2, x), () => 8);
		expect(outcome).toMatchObject({ kind: "roots", roots: [3] });
	});

	test("a root at zero is never negative zero", () => {
		const outcome = findRealRoots(Math.sin, zero, { lower: -1, upper: 1 });
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(Object.is(outcome.roots[0], -0)).toBe(false);
		expect(outcome.roots).toEqual([0]);
	});
});

describe("never reporting a non-root", () => {
	test("a pole changes sign without being a root, and is dropped", () => {
		expect(findRealRoots(x => 1 / x, zero).kind).toBe("none");
	});

	test("a jump changes sign without being a root, and is dropped", () => {
		expect(findRealRoots(x => Math.floor(x), () => 0.5, { lower: 0, upper: 3 }).kind).toBe("none");
	});

	test("the pole in tan is dropped while its genuine roots are kept", () => {
		const outcome = findRealRoots(Math.tan, () => 1, { lower: 0, upper: 3 });
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		// pi/4 is a root; pi/2 is a pole where tan jumps from +inf to -inf.
		expect(outcome.roots).toHaveLength(1);
		expect(outcome.roots[0]).toBeCloseTo(Math.PI / 4, 12);
	});

	test("a side that underflows to exactly zero is not taken for a root", () => {
		// exp(x) is never zero, but every double below about -745 rounds it to 0.
		const outcome = findRealRoots(Math.exp, zero);
		expect(outcome.kind).toBe("flat");
		if (outcome.kind !== "flat") return;
		expect(outcome.from).toBe(-NUMERIC_SEARCH_LIMIT);
		expect(outcome.to).toBeLessThan(-700);
	});

	test("a gap in the domain inside a bracket is not bisected across", () => {
		// log(x) - 1 is NaN left of zero and has its one root at e.
		const outcome = findRealRoots(Math.log, () => 1);
		expect(outcome).toMatchObject({ kind: "roots" });
		if (outcome.kind !== "roots") return;
		expect(outcome.roots).toHaveLength(1);
		expect(outcome.roots[0]).toBeCloseTo(Math.E, 12);
	});
});

describe("what the search declines", () => {
	test("more roots than it lists is declined rather than cut off", () => {
		const outcome = findRealRoots(Math.sin, () => 0.5);
		expect(outcome.kind).toBe("tooMany");
		expect(NUMERIC_ROOTS_MAX).toBe(10);
	});

	test("a stated range narrows a periodic equation to what can be listed", () => {
		const outcome = findRealRoots(Math.sin, () => 0.5, { lower: 0, upper: 10 });
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		const expected = [Math.PI / 6, (5 * Math.PI) / 6, Math.PI / 6 + 2 * Math.PI, (5 * Math.PI) / 6 + 2 * Math.PI];
		expect(outcome.roots).toHaveLength(expected.length);
		outcome.roots.forEach((root, i) => expect(root).toBeCloseTo(expected[i], 12));
	});

	test("nothing in the range is reported as nothing found, with the range", () => {
		expect(findRealRoots(Math.sin, () => 2)).toMatchObject({ kind: "none", stated: false, range: { lower: -NUMERIC_SEARCH_LIMIT, upper: NUMERIC_SEARCH_LIMIT } });
	});

	test("a root outside a stated range is not looked for", () => {
		expect(findRealRoots(Math.log, () => 2, { lower: 0, upper: 5 }).kind).toBe("none");
	});

	test("a touching root is found only when a sample lands on it", () => {
		// cos(x) = 1 touches at 0 without crossing. A range centred on it samples
		// 0 exactly; one that is not centred steps over it.
		expect(findRealRoots(Math.cos, () => 1, { lower: -1, upper: 1 })).toMatchObject({ kind: "roots", roots: [0] });
		expect(findRealRoots(Math.cos, () => 1, { lower: -1, upper: 2 }).kind).toBe("none");
	});

	test("an end of a stated range is sampled exactly", () => {
		expect(findRealRoots(x => x, () => 2, { lower: 0, upper: 2 })).toMatchObject({ kind: "roots", roots: [2] });
	});

	test("a root at an end the reader could only write approximately is still found", () => {
		// sin(Math.PI) is 1.2e-16, not 0, so the curve crosses just past the end.
		const outcome = findRealRoots(Math.sin, zero, { lower: 0, upper: Math.PI });
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(outcome.roots).toHaveLength(2);
		expect(outcome.roots[0]).toBe(0);
		expect(outcome.roots[1]).toBeCloseTo(Math.PI, 14);
	});
});

describe("from a symbolic equation", () => {
	const x = varNode("x");

	test("both sides are compiled and searched", () => {
		const outcome = solveNumerically(powNode(constNode(2), x), constNode(10), "x");
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(outcome.roots[0]).toBeCloseTo(Math.log2(10), 12);
	});

	test("a second unknown is a refusal with the reason, not a search", () => {
		const outcome = solveNumerically(callNode("cos", [x]), varNode("a"), "x");
		expect(outcome.kind).toBe("unsupported");
		if (outcome.kind !== "unsupported") return;
		expect(outcome.reason).toMatch(/"a"/);
	});

	test("a function with no numeric form is a refusal", () => {
		expect(solveNumerically(callNode("mystery", [x]), constNode(1), "x").kind).toBe("unsupported");
	});
});
