import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { rational, rationalFromNumber, type Rational } from "@solve-js/symbolic";
import { FACTOR_MAX_ROOT_CANDIDATES, quadraticRationalRoots, rationalRoots, readableContent, rootsToFactorBy, searchRationalRoots } from "@solve-js/symbolic/Factor";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `factor(x^2 - pi)` was refused with "This polynomial's
 * coefficients have too many divisors to search for rational roots."
 *
 * `factor` works over the fractions: `factor(x^2 - 2)` is `x^2-2`, since no
 * fraction is a square root of 2, and that is the answer rather than a
 * failure. Pi reaches it as the sixteen-digit fraction of its double, whose
 * divisors the rational-root search cannot list within its bounds, so the
 * search threw. A quadratic needs no search: it has a rational root exactly
 * when its discriminant is the square of a fraction, which is one exact square
 * root to test. `x^2 - pi` has the discriminant `4pi`, not a square, so it is
 * irreducible over the fractions and comes back as written, as `x^2 - 2` does.
 *
 * Pulling out its content wrote pi's sixteen digits into the answer
 * (`factor(x^2 + pi*x)` was `1e-15x*(1000000000000000x+3141592653589793)`), so
 * a content too long to be anything but a long fraction's noise is left in
 * place. A cubic or higher over pi still has no search to fall back on and is
 * refused, in plainer words that name why and point to `solve`.
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

const r = (n: number | bigint, d: number | bigint = 1): Rational => rational(BigInt(n), BigInt(d));
const PI = rationalFromNumber(Math.PI);
/** Ten to the power `n`, as a bigint (the `**` operator on bigints is not in the test library target). */
const ten = (n: number): bigint => BigInt(`1${"0".repeat(n)}`);
const MINUS_PI: Rational = { n: -PI.n, d: PI.d };

const CUBIC_REFUSAL = "THROWS This polynomial cannot be factored: a number in it is too long as a fraction (as pi and e are) to try every fraction that could be a root. solve finds its roots as decimals.";

describe("the lines that exposed it", () => {
	test("x^2 - pi is irreducible over the fractions, as x^2 - 2 is", () => {
		expect(shown("factor(x^2 - pi)")).toBe("x^2-3.1415926536");
		expect(shown("factor(x^2 - 2)")).toBe("x^2-2");
		expect(shown("factor(x^2 - e)")).toBe("x^2-2.7182818285");
		expect(shown("factor(x^2 - tau)")).toBe("x^2-6.2831853072");
		expect(shown("factor(x^2 - 2x - pi)")).toBe("x^2-2x-3.1415926536");
	});

	test("a common factor still comes out, with pi left as written", () => {
		expect(shown("factor(x^2 + pi*x)")).toBe("x*(x+3.1415926536)");
		expect(shown("factor(x^3 - pi*x)")).toBe("x*(x^2-3.1415926536)");
		expect(shown("factor(x^2*y - pi*y)")).toBe("y*(x^2-3.1415926536)");
		expect(shown("factor((x-pi)^2)")).toBe("(x-3.1415926536)^2");
	});

	test("what already factored is unchanged", () => {
		expect(shown("factor(x^2 - 4)")).toBe("(x-2)*(x+2)");
		expect(shown("factor(4x^2 - 1)")).toBe("4(x-0.5)*(x+0.5)");
		expect(shown("factor(x^2 - 3.14159)")).toBe("0.00001(100000x^2-314159)");
		expect(shown("factor(x^2 - 1/3)")).toBe("(3x^2-1)/3");
		expect(shown("factor(x^2 + 2x + 1)")).toBe("(x+1)^2");
	});

	test("a cubic over pi is refused in words that say why, and solve answers it", () => {
		expect(shown("factor(x^3 - pi)")).toBe(CUBIC_REFUSAL);
		expect(shown("factor(x^4 - pi)")).toBe(CUBIC_REFUSAL);
		expect(shown("solve(x^3 = pi, x)")).toBe("[-0.7322959438-1.2683737808i, -0.7322959438+1.2683737808i, 1.46]");
	});

	test("a quadratic with too many candidates is decided rather than refused", () => {
		expect(shown("factor(720720x^2 + x + 720720)")).toBe("720720x^2+x+720720");
		expect(shown("factor(735134400x^2 - 25626846353)")).toBe("735134400x^2-25626846353");
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "factor(x^2 - pi)"))).toBe("x^2-3.1415926536");
		expect(both(["factor(x^2 - pi)", "factor(x^3 - pi*x)"])).toEqual(["x^2-3.1415926536", "x*(x^2-3.1415926536)"]);
		expect(both(["factor(x^3 - pi)"])[0]).toMatch(/^THREW: This polynomial cannot be factored/);
	});
});

describe("the parts: quadraticRationalRoots", () => {
	test("ordinary: a square discriminant gives two rational roots, low to high", () => {
		expect(quadraticRationalRoots([r(1), r(0), r(-4)])).toEqual([r(-2), r(2)]);
		expect(quadraticRationalRoots([r(2), r(-3), r(1)])).toEqual([r(1, 2), r(1)]);
		expect(quadraticRationalRoots([r(4), r(0), r(-1)])).toEqual([r(-1, 2), r(1, 2)]);
	});

	test("boundary: a zero discriminant is one root, a negative or non-square one none", () => {
		expect(quadraticRationalRoots([r(1), r(2), r(1)])).toEqual([r(-1)]);
		expect(quadraticRationalRoots([r(1), r(0), r(1)])).toEqual([]);
		expect(quadraticRationalRoots([r(1), r(0), r(-2)])).toEqual([]);
		expect(quadraticRationalRoots([r(1), r(0), r(0)])).toEqual([r(0)]);
	});

	test("hostile: pi's sixteen-digit fraction, a zero leading term and the wrong length", () => {
		expect(quadraticRationalRoots([r(1), r(0), MINUS_PI])).toEqual([]);
		// pi squared as an exact fraction is a square, so its difference is decided too.
		const piSquared: Rational = { n: -(PI.n * PI.n), d: PI.d * PI.d };
		expect(quadraticRationalRoots([r(1), r(0), piSquared])).toEqual([MINUS_PI, PI]);
		expect(quadraticRationalRoots([r(0), r(1), r(1)])).toEqual([]);
		expect(quadraticRationalRoots([r(1), r(1)])).toEqual([]);
		expect(quadraticRationalRoots([])).toEqual([]);
		const started = performance.now();
		expect(quadraticRationalRoots([r(ten(300)), r(7), r(-(ten(300)))])).toEqual([]);
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});

describe("the parts: rootsToFactorBy", () => {
	test("ordinary: a searchable polynomial is searched, in the search's order", () => {
		expect(rootsToFactorBy([r(1), r(0), r(-4)])).toEqual(rationalRoots([r(1), r(0), r(-4)]));
		expect(rootsToFactorBy([r(1), r(0), r(0), r(-1)])).toEqual(rationalRoots([r(1), r(0), r(0), r(-1)]));
	});

	test("boundary: a quadratic out of the search's reach goes to its discriminant", () => {
		expect(searchRationalRoots([r(1), r(0), MINUS_PI])).toBe("too-many-divisors");
		expect(rootsToFactorBy([r(1), r(0), MINUS_PI])).toEqual([]);
		expect(searchRationalRoots([r(720720), r(1), r(720720)])).toBe("too-many-candidates");
		expect(rootsToFactorBy([r(720720), r(1), r(720720)])).toEqual([]);
	});

	test("hostile: a cubic out of reach is refused by code, either way it is out of reach", () => {
		expect(() => rootsToFactorBy([r(1), r(0), r(0), MINUS_PI])).toThrow(/too long as a fraction/);
		// 720720 has 240 divisors, so the candidates are past the limit.
		expect(240 * 240).toBeGreaterThan(FACTOR_MAX_ROOT_CANDIDATES);
		expect(() => rootsToFactorBy([r(720720), r(0), r(1), r(720720)])).toThrow(/too many divisors to try/);
		try {
			rootsToFactorBy([r(1), r(0), r(0), MINUS_PI]);
		} catch (e) {
			expect((e as { code?: string }).code).toBe("SYMBOLIC_FACTOR_LIMIT_EXCEEDED");
		}
	});
});

describe("the parts: readableContent", () => {
	test("ordinary: a short content is pulled out as it was", () => {
		expect(readableContent(r(2))).toEqual(r(2));
		expect(readableContent(r(1, 100000))).toEqual(r(1, 100000));
		expect(readableContent(r(-3, 7))).toEqual(r(-3, 7));
	});

	test("boundary: ten digits either side is the line", () => {
		expect(readableContent(r(1, ten(10)))).toEqual(r(1, ten(10)));
		expect(readableContent(r(1, ten(10) + 1n))).toEqual(r(1));
		expect(readableContent(r(ten(10)))).toEqual(r(ten(10)));
		expect(readableContent(r(-(ten(10)) - 1n))).toEqual(r(1));
	});

	test("hostile: pi's content, and a content of hundreds of digits, stay in place", () => {
		expect(readableContent(r(1, ten(15)))).toEqual(r(1));
		expect(readableContent(r(ten(400), 3))).toEqual(r(1));
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`factor(${word}^2 - pi)`, `factor(x^2 - pi * ${word})`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a huge multiple, a 34-digit coefficient and the degree ceiling are answered in time", () => {
		for (const line of ["factor(x^2 - 1e300 * pi)", "factor(1234567890123456789012345678901234x^2 - pi)", "factor(x^12 - pi)", "factor(x^13 - pi)", "factor(x^12 + pi*x^11 + e*x)"]) {
			expectHonestLine(line, { budgetMs: 5_000 });
		}
	});

	test("a look-alike of pi is a second unknown", () => {
		expectHonestLine("factor(x^2 - ℼ)");
		expect(shown("factor(x^2 - рi)")).not.toBe("x^2-3.1415926536");
	});

	test.each(fill("factor(x^2 - pi) X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the factor: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around it is read as text", () => {
		expectHonestLine("<i>factor(x^2 - pi)</i>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo of the constant is a second unknown, factored as one", () => {
		expect(shown("factor(x^2 - pie)")).toBe("x^2-pie");
	});

	test("pi squared in floating point is not quite pi times pi, so it is not a perfect square", () => {
		// (x-pi)^2 expands exactly and factors back; pi^2 rounded to a double does not.
		expect(shown("factor(x^2 - 2*pi*x + pi^2)")).toBe("x^2-6.2831853072x+9.8696044011");
	});

	test("the constant from the line above, and a check over the answer", () => {
		expectHonestDocument("r = pi\nfactor(x^2 - r)");
		expectHonestDocument("f = factor(x^2 - pi)\ncheck 1 == 1");
		expectHonestDocument("factor(x^3 - pi)\nsolve(x^3 = pi, x)");
	});

	test("a unit beside it is refused, not factored", () => {
		expectHonestLine("factor(x^2 - pi km)");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("factor(x^2 - (X) * pi)", NUMERIC_EDGES))("a numeric edge times pi: %s", (line) => {
		expectHonestLine(line, { budgetMs: 5_000, allowNaN: line.includes("0/0") });
	});

	test("zero, negative zero and a negative multiple of pi", () => {
		expect(shown("factor(x^2 - 0 * pi)")).toBe("x^2");
		expect(shown("factor(x^2 + pi)")).toBe("x^2+3.1415926536");
		expect(shown("factor(x^2 - -0 * pi)")).toBe("x^2");
	});

	test("the largest and smallest doubles times pi", () => {
		expectHonestLine(`factor(x^2 - ${Number.MAX_VALUE} * pi)`, { budgetMs: 5_000 });
		expectHonestLine(`factor(x^2 - ${Number.MIN_VALUE} * pi)`, { budgetMs: 5_000 });
		expectHonestLine("factor(x^2 - 2^53 * pi)", { budgetMs: 5_000 });
	});

	test("a CRLF line through both passes", () => {
		expect(both(["factor(x^2 - pi)\r", ""])[0]).toBe("x^2-3.1415926536");
	});
});
