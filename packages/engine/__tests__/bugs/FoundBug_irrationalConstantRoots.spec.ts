import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatSymbolic, rational, rationalFromNumber, type Rational } from "@solve-js/symbolic";
import { FACTOR_MAX_ROOT_CANDIDATES, rationalRoots, searchRationalRoots } from "@solve-js/symbolic/Factor";
import { extractRationalRoots, realSurdQuadraticRoots, solveForVariable } from "@solve-js/symbolic/Solve";
import { constNode, varNode } from "@solve-js/symbolic/SymbolicNode";
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `solve(x^2 = pi, x)` and `solve(x^2 = e, x)` were refused with
 * "This polynomial's coefficients have too many divisors to search for
 * rational roots." Pi reaches the solver as the sixteen-digit fraction of its
 * double, `3141592653589793/10^15`, and the rational-root search, which lists
 * the divisors of the leading and trailing coefficients by trial division,
 * cannot list those within its bounds; it threw, and the throw ended the
 * solve. The search is a refinement, not the method: a factor whose rational
 * roots cannot be searched now goes to the numerical root finder, which finds
 * every root of it at once, so `x^2 = pi` answers ±1.7724538509 the way the
 * casus irreducibilis does. The closed form would be the square root of that
 * sixteen-digit fraction, exact only for the rounded constant.
 *
 * While there, a real surd root lost a factor to its own coefficient:
 * `x^2 = 3.14159` was `0.002*sqrt(3141590)/2` and `3x^2 = 1` was
 * `2*sqrt(3)/6`. The division by `2a` is now folded into the radicand, as the
 * complex case already did.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** The real roots a solve answered, as numbers, low to high. */
function realRoots(value: Value): number[] {
	if (value.type === ValueType.Number) return [value.toNumber()];
	expect(value.type).toBe(ValueType.Matrix);
	const cells = (value.value as { data: unknown[] }).data;
	return cells.filter((cell): cell is number => typeof cell === "number");
}

const r = (n: number | bigint, d: number | bigint = 1): Rational => rational(BigInt(n), BigInt(d));
const PI = rationalFromNumber(Math.PI);

describe("the lines that exposed it", () => {
	test("x^2 = pi and x^2 = e are solved, to the root of the constant", () => {
		expect(shown("solve(x^2 = pi, x)")).toBe("[-1.77, 1.77]");
		expect(shown("solve(x^2 = e, x)")).toBe("[-1.65, 1.65]");
		const pi = realRoots(newTrackedEngine().evaluateExpression("solve(x^2 = pi, x)"));
		expect(pi[0]).toBeCloseTo(-Math.sqrt(Math.PI), 12);
		expect(pi[1]).toBeCloseTo(Math.sqrt(Math.PI), 12);
		const e = realRoots(newTrackedEngine().evaluateExpression("solve(x^2 = e, x)"));
		expect(e[1]).toBeCloseTo(Math.sqrt(Math.E), 12);
	});

	test("the shape matches x^2 = 2: a row of roots, lower first", () => {
		expect(shown("solve(x^2 = 2, x)")).toBe("[-sqrt(2), sqrt(2)]");
		expect(shown("solve(x^2 = π, x)")).toBe("[-1.77, 1.77]");
		expect(shown("solve(2x^2 = e, x)")).toBe("[-1.17, 1.17]");
	});

	test("a cubic over pi gives all three roots, the complex pair included", () => {
		expect(shown("solve(x^3 = pi, x)")).toBe("[-0.7322959438-1.2683737808i, -0.7322959438+1.2683737808i, 1.46]");
		expect(realRoots(newTrackedEngine().evaluateExpression("solve(x^3 = pi, x)"))[0]).toBeCloseTo(Math.cbrt(Math.PI), 10);
	});

	test("a short decimal keeps its exact square root, now with the division folded in", () => {
		expect(shown("solve(x^2 = 3.14159, x)")).toBe("[-0.001*sqrt(3141590), 0.001*sqrt(3141590)]");
		expect(shown("solve(3x^2 = 1, x)")).toBe("[-sqrt(3)/3, sqrt(3)/3]");
		expect(shown("solve(x^2 = 1/3, x)")).toBe("[-sqrt(3)/3, sqrt(3)/3]");
		expect(shown("solve(x^2 + x = 0.7, x)")).toBe("[-0.5-0.1*sqrt(95), -0.5+0.1*sqrt(95)]");
	});

	test("an equation over pi beside a rational root keeps the rational one exact", () => {
		expect(shown("solve((x-1)*(x^2 - pi) = 0, x)")).toBe("[-1.77, 1, 1.77]");
		expect(shown("solve(x^2 = -pi, x)")).toBe("[-1.7724538509i, 1.7724538509i]");
		expect(shown("solve(x^2 + pi*x + 1 = 0, x)")).toBe("[-2.78, -0.36]");
	});

	test("through the three entry points", () => {
		const single = newTrackedEngine().evaluateLine(1, "solve(x^2 = pi, x)");
		expect(formatValue(single)).toBe("= [-1.77, 1.77]");
		expect(both(["x^2 = pi", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "[-1.77, 1.77]"]);
		expect(both(["a = pi", "x^2 = a", "x =>"])).toEqual(["3.14", 'x stored as an equation: solve with "x =>"', "[-1.77, 1.77]"]);
		expect(both(["solve(x^2 = e, x)"])).toEqual(["[-1.65, 1.65]"]);
	});

	test("a range keeps the roots inside it", () => {
		expect(shown("solve(x^2 = pi, x, 0, 10)")).toBe("1.77");
	});
});

describe("the parts: searchRationalRoots", () => {
	test("ordinary: the rational roots, as rationalRoots gives them", () => {
		expect(searchRationalRoots([r(1), r(0), r(-4)])).toEqual(rationalRoots([r(1), r(0), r(-4)]));
		const halves = searchRationalRoots([r(2), r(-3), r(1)]);
		expect(halves).toHaveLength(2);
		expect(halves).toEqual(expect.arrayContaining([r(1, 2), r(1)]));
	});

	test("boundary: nothing to search, a line and a zero constant term", () => {
		expect(searchRationalRoots([])).toEqual([]);
		expect(searchRationalRoots([r(5)])).toEqual([]);
		expect(searchRationalRoots([r(2), r(-3)])).toEqual([r(3, 2)]);
		expect(searchRationalRoots([r(1), r(0), r(0)])).toEqual([]);
	});

	test("hostile: a coefficient too long to factor is named, not thrown", () => {
		expect(searchRationalRoots([r(1), r(0), { n: -PI.n, d: PI.d }])).toBe("too-many-divisors");
		// Two highly composite coefficients: 720720 has 240 divisors, so the
		// candidates are 240 * 240, past the limit.
		expect(240 * 240).toBeGreaterThan(FACTOR_MAX_ROOT_CANDIDATES);
		expect(searchRationalRoots([r(720720), r(1), r(720720)])).toBe("too-many-candidates");
		// rationalRoots, for the callers with no other way, still refuses by name.
		expect(() => rationalRoots([r(1), r(0), { n: -PI.n, d: PI.d }])).toThrow(/too many divisors/);
		expect(() => rationalRoots([r(720720), r(1), r(720720)])).toThrow(/too many candidate/);
	});
});

describe("the parts: extractRationalRoots", () => {
	test("ordinary: a searched factor reports searched", () => {
		const out = extractRationalRoots([r(1), r(0), r(-4)]);
		expect(out).toEqual({ roots: [r(-2), r(2)], remaining: [r(1)], searched: true });
	});

	test("boundary: a factor of x comes out before the search", () => {
		const out = extractRationalRoots([r(1), r(0), r(0)]);
		expect(out.roots).toEqual([r(0)]);
		expect(out.searched).toBe(true);
	});

	test("hostile: a coefficient of sixteen digits leaves the factor whole and unsearched", () => {
		const out = extractRationalRoots([r(1), r(0), { n: -PI.n, d: PI.d }]);
		expect(out.roots).toEqual([]);
		expect(out.remaining).toHaveLength(3);
		expect(out.searched).toBe(false);
		// A root divided out first is kept, and only what is left is unsearched:
		// x^3 - pi*x is x times x^2 - pi.
		const mixed = extractRationalRoots([r(1), r(0), { n: -PI.n, d: PI.d }, r(0)]);
		expect(mixed).toEqual({ roots: [r(0)], remaining: [r(1), r(0), { n: -PI.n, d: PI.d }], searched: false });
	});
});

describe("the parts: realSurdQuadraticRoots", () => {
	test("ordinary: a centre of zero is a pair of opposite surds", () => {
		expect(realSurdQuadraticRoots(r(0), r(2)).map(formatSymbolic)).toEqual(["-sqrt(2)", "sqrt(2)"]);
		expect(realSurdQuadraticRoots(r(0), r(1, 3)).map(formatSymbolic)).toEqual(["-sqrt(3)/3", "sqrt(3)/3"]);
	});

	test("boundary: a centre off zero is added to and taken from", () => {
		expect(realSurdQuadraticRoots(r(-1, 2), r(95, 100)).map(formatSymbolic)).toEqual(["-0.5-0.1*sqrt(95)", "-0.5+0.1*sqrt(95)"]);
		expect(realSurdQuadraticRoots(r(3), r(5)).map(formatSymbolic)).toEqual(["3-sqrt(5)", "3+sqrt(5)"]);
	});

	test("hostile: a spread with large parts is answered in time", () => {
		const started = performance.now();
		const roots = realSurdQuadraticRoots(r(0), r(99991n * 99989n, 7n));
		expect(roots).toHaveLength(2);
		expect(performance.now() - started).toBeLessThan(2_000);
	});
});

describe("the parts: solveForVariable over an irrational constant", () => {
	test("the roots are approximate, two of them, and nothing is reported missing", () => {
		const outcome = solveForVariable({ kind: "pow", base: varNode("x"), exponent: constNode(r(2)) }, constNode(PI), "x");
		expect(outcome.kind).toBe("roots");
		if (outcome.kind !== "roots") return;
		expect(outcome.exact).toEqual([]);
		expect(outcome.approximate.map((root) => root.re)).toEqual([expect.closeTo(-Math.sqrt(Math.PI), 12), expect.closeTo(Math.sqrt(Math.PI), 12)]);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`solve(${word}^2 = pi, ${word})`, `solve(x^2 = pi * ${word}, x)`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a prototype word as the unknown is solved like any other name", () => {
		expect(shown("solve(constructor^2 = pi, constructor)")).toBe("[-1.77, 1.77]");
	});

	test("a huge constant multiple, a 34-digit coefficient and a degree at the ceiling are answered in time", () => {
		for (const line of ["solve(x^2 = 1e300 * pi, x)", "solve(x^2 = 1234567890123456789012345678901234 * pi, x)", "solve(x^8 = pi, x)", "solve(x^8 + pi*x^7 + e*x = 1, x)"]) {
			expectHonestLine(line, { budgetMs: 5_000 });
		}
		expect(shown("solve(x^9 = pi, x)")).toBe("Cannot solve this equation: degree 9 is above the supported maximum of 8.");
	});

	test("a look-alike of pi is an unknown, so the equation has two", () => {
		// The double-struck pi and a Cyrillic р followed by a Latin i.
		expectHonestLine("solve(x^2 = ℼ, x)");
		expect(shown("solve(x^2 = рi, x)")).not.toMatch(/^\[-1\.77/);
	});

	test.each(fill("solve(x^2 = pi, x) X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the solve: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around the solve is read as text", () => {
		expectHonestLine("<b>solve(x^2 = pi, x)</b>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo of the constant is an unknown, never pi", () => {
		expect(shown("solve(x^2 = pie, x)")).toMatch(/^Cannot solve this equation/);
	});

	test("a unit on the constant side is refused by name", () => {
		expect(shown("solve(x^2 = pi km, x)")).toMatch(/km/);
	});

	test("the constant from the line above, a check of the answer and a what-if through it", () => {
		expect(both(["r = pi", "x^2 = r", "x =>"])[2]).toBe("[-1.77, 1.77]");
		expectHonestDocument("r = pi\nx^2 = r\nx =>\ncheck sqrt(r) > 1.7");
		expectHonestDocument("r = pi\ny = sqrt(r)\nline 2 with r = e");
	});

	// Found while testing this: `tau` and `phi` inside `solve` were refused as
	// though they were live values ("solve's expression must be synchronous").
	// Fixed with FoundBug_constantInAHeldExpression.spec.ts.
	test("tau inside solve is a value, as pi is", () => {
		expect(shown("solve(x^2 = tau, x)")).toBe("[-2.51, 2.51]");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("solve(x^2 = (X) * pi, x)", NUMERIC_EDGES))("a numeric edge times pi: %s", (line) => {
		expectHonestLine(line, { budgetMs: 5_000, allowNaN: line.includes("0/0") });
	});

	test("zero, negative zero and a negative multiple of pi", () => {
		expect(shown("solve(x^2 = 0 * pi, x)")).toBe("0");
		expect(shown("solve(x^2 = -0 * pi, x)")).toBe("0");
		expect(shown("solve(x^2 = -2 * pi, x)")).toBe("[-2.5066282746i, 2.5066282746i]");
	});

	test("the largest and smallest doubles times pi are answered or refused honestly", () => {
		expectHonestLine(`solve(x^2 = ${Number.MAX_VALUE} * pi, x)`, { budgetMs: 5_000 });
		expectHonestLine(`solve(x^2 = ${Number.MIN_VALUE} * pi, x)`, { budgetMs: 5_000 });
		expectHonestLine("solve(x^2 = 2^53 * pi, x)", { budgetMs: 5_000 });
	});

	test("a cubic near the largest double the numerical method cannot settle says so, in time", () => {
		const started = performance.now();
		expect(shown("solve(x^3 = e + 1e308, x)")).toBe("Only 0 of this equation's 3 roots could be found: a degree-3 factor of it has coefficients too long to solve exactly, and the numerical method did not converge on it.");
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	test("an infinite side is refused by name", () => {
		expect(shown("solve(x^2 = pi / 0, x)")).toBe("An equation side has no exact value to solve with.");
	});

	test("a CRLF line and a trailing newline through both passes", () => {
		expect(both(["x^2 = pi\r", "x =>\r", ""])[1]).toBe("[-1.77, 1.77]");
	});
});
