/**
 * Property-based verification of the computer algebra system.
 *
 * Symbolic algebra is the one area where a wrong answer looks exactly like a
 * right one: `factor(x^2+5x+6)` returning `(x+1)*(x+6)` reads as plausibly as
 * the truth. Pinning a hand-written expected string per case only ever proves
 * the engine still does what it did the day the string was copied out of it.
 *
 * So nothing here compares against the engine's own output. Every expectation
 * is computed twice by two independent routes and required to agree:
 *
 *  1. The engine is handed an expression whose value at any point this file
 *     already knows, because this file BUILT the expression from ingredients
 *     it chose (the factors of a product, the roots of a polynomial, the
 *     quotient of a rational function).
 *  2. The engine's answer is walked by {@link evaluateSymbolic} below, a small
 *     complex-arithmetic interpreter written here rather than imported, and
 *     the two numbers are compared at several randomly chosen points.
 *
 * An algebraic identity that holds symbolically holds at every point, so a
 * disagreement at even one point is a real defect and not a rounding artefact.
 * The random points are drawn from a seeded generator so a failure reproduces.
 *
 * The complex interpreter is not decoration: a quadratic with negative
 * discriminant, and every quartic, hands back roots that are genuinely complex,
 * and checking those roots against the polynomial needs complex arithmetic.
 */
import { describe, expect, test } from "@jest/globals";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";
import { formatSymbolic, type SymbolicNode } from "@solve-js/symbolic";
import { newTrackedEngine } from "@tools/trackedEngine";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

// ── A complex number, and the arithmetic the interpreter needs ──────────────

interface Cpx {
	readonly re: number;
	readonly im: number;
}

const cpx = (re: number, im = 0): Cpx => ({ re, im });
const add = (a: Cpx, b: Cpx): Cpx => cpx(a.re + b.re, a.im + b.im);
const sub = (a: Cpx, b: Cpx): Cpx => cpx(a.re - b.re, a.im - b.im);
const mul = (a: Cpx, b: Cpx): Cpx => cpx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: Cpx, b: Cpx): Cpx => {
	const norm = b.re * b.re + b.im * b.im;
	return cpx((a.re * b.re + a.im * b.im) / norm, (a.im * b.re - a.re * b.im) / norm);
};
const magnitude = (a: Cpx): number => Math.hypot(a.re, a.im);
const cexp = (a: Cpx): Cpx => cpx(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));
const clog = (a: Cpx): Cpx => cpx(Math.log(magnitude(a)), Math.atan2(a.im, a.re));
const isRealValued = (a: Cpx): boolean => Math.abs(a.im) < 1e-12;
const cpow = (base: Cpx, exponent: Cpx): Cpx => {
	if (base.re === 0 && base.im === 0) return exponent.re === 0 && exponent.im === 0 ? cpx(1) : cpx(0);
	// A real base with an integer exponent goes through Math.pow so that a
	// negative base does not detour through a branch cut and pick up a spurious
	// imaginary part: (-2)^3 is -8, not 8*exp(i*pi).
	if (isRealValued(base) && isRealValued(exponent) && Number.isInteger(exponent.re)) return cpx(Math.pow(base.re, exponent.re));
	return cexp(mul(exponent, clog(base)));
};

/**
 * Evaluates a symbolic tree numerically, independently of the engine.
 *
 * Deliberately hand-written and deliberately total: an unknown function name or
 * an unbound variable throws rather than guessing, so a test can never silently
 * pass by evaluating something it did not understand.
 *
 * @param node - The tree the engine produced.
 * @param env - A value for every free variable in it.
 * @returns The tree's value at that point.
 */
function evaluateSymbolic(node: SymbolicNode, env: Readonly<Record<string, Cpx>>): Cpx {
	switch (node.kind) {
		case "const":
			return cpx(Number(node.value.n) / Number(node.value.d));
		case "complex":
			return cpx(Number(node.value.re.n) / Number(node.value.re.d), Number(node.value.im.n) / Number(node.value.im.d));
		case "var": {
			const bound = env[node.name];
			if (!bound) throw new Error(`the verifier has no value for the variable "${node.name}"`);
			return bound;
		}
		case "add":
			return add(evaluateSymbolic(node.left, env), evaluateSymbolic(node.right, env));
		case "sub":
			return sub(evaluateSymbolic(node.left, env), evaluateSymbolic(node.right, env));
		case "mul":
			return mul(evaluateSymbolic(node.left, env), evaluateSymbolic(node.right, env));
		case "div":
			return div(evaluateSymbolic(node.left, env), evaluateSymbolic(node.right, env));
		case "neg": {
			const inner = evaluateSymbolic(node.operand, env);
			return cpx(-inner.re, -inner.im);
		}
		case "pow":
			return cpow(evaluateSymbolic(node.base, env), evaluateSymbolic(node.exponent, env));
		case "call": {
			const args = node.args.map(arg => evaluateSymbolic(arg, env));
			const [first] = args;
			switch (node.name) {
				case "sqrt":
					return isRealValued(first) && first.re >= 0 ? cpx(Math.sqrt(first.re)) : cpow(first, cpx(0.5));
				// The real cube root, which is what the engine means by cbrt: the
				// principal complex root of a negative real would be complex, and
				// cbrt(-8) here has to be -2 for a depressed-cubic root to check out.
				case "cbrt":
					return isRealValued(first) ? cpx(Math.cbrt(first.re)) : cpow(first, cpx(1 / 3));
				case "exp":
					return cexp(first);
				case "log":
					return clog(first);
				case "sin":
					return isRealValued(first) ? cpx(Math.sin(first.re)) : div(sub(cexp(mul(cpx(0, 1), first)), cexp(mul(cpx(0, -1), first))), cpx(0, 2));
				case "cos":
					return isRealValued(first) ? cpx(Math.cos(first.re)) : div(add(cexp(mul(cpx(0, 1), first)), cexp(mul(cpx(0, -1), first))), cpx(2));
				case "tan":
					return cpx(Math.tan(first.re));
				case "atan":
					return cpx(Math.atan(first.re));
				case "abs":
					return cpx(magnitude(first));
				case "sign":
					return cpx(Math.sign(first.re));
				case "sinh":
					return cpx(Math.sinh(first.re));
				case "cosh":
					return cpx(Math.cosh(first.re));
				case "tanh":
					return cpx(Math.tanh(first.re));
				case "pow":
					return cpow(args[0], args[1]);
				default:
					throw new Error(`the verifier has no reading for the function "${node.name}"`);
			}
		}
	}
}

// ── Seeded randomness, so a failure is reproducible ────────────────────────

/** Mulberry32: tiny, fast, and identical run to run for a given seed. */
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A small non-zero integer, the coefficients this file builds polynomials from. */
function smallInt(random: () => number, limit = 5): number {
	const magnitude = 1 + Math.floor(random() * limit);
	return random() < 0.5 ? -magnitude : magnitude;
}

// ── Engine plumbing ────────────────────────────────────────────────────────

/**
 * Evaluates one line and returns the symbolic tree it produced.
 *
 * A verb that folded to a plain number (every unknown having cancelled) is
 * reported as a constant tree rather than as a failure, since `cancel((x-1)/(x-1))`
 * legitimately answers 1.
 */
function symbolicResult(engine: ExpressionEngine, source: string): SymbolicNode {
	const value = engine.evaluateLine(1, source);
	if (value.type === ValueType.Symbolic) return value.value as SymbolicNode;
	if (value.type === ValueType.Number) return { kind: "const", value: { n: BigInt(Math.round(value.toNumber() * 1e9)), d: 1000000000n } };
	throw new Error(`"${source}" produced ${ValueType[value.type]} rather than an algebraic result: ${String(value.value)}`);
}

/** Every cell of a matrix result, in reading order. */
function matrixCells(matrix: MatrixData): (number | boolean | SymbolicNode)[] {
	const out: (number | boolean | SymbolicNode)[] = [];
	for (let row = 0; row < matrix.rows; row++) {
		for (let column = 0; column < matrix.cols; column++) out.push(matrix.data[row + column * matrix.rows]);
	}
	return out;
}

/** The roots `solve` returned, as complex numbers, whether it answered with one root or a row of them. */
function solvedRoots(engine: ExpressionEngine, equation: string): Cpx[] {
	const value = engine.evaluateLine(1, equation);
	if (value.type === ValueType.Matrix) {
		return matrixCells(value.value as MatrixData).map(cell => (typeof cell === "number" ? cpx(cell) : evaluateSymbolic(cell as SymbolicNode, {})));
	}
	if (value.type === ValueType.Number) return [cpx(value.toNumber())];
	if (value.type === ValueType.Symbolic) return [evaluateSymbolic(value.value as SymbolicNode, {})];
	throw new Error(`"${equation}" produced ${ValueType[value.type]}: ${String(value.value)}`);
}

/** Writes a coefficient list (highest power first) as source text the engine can read. */
function polynomialSource(coefficients: readonly number[], variable = "x"): string {
	const degree = coefficients.length - 1;
	const terms: string[] = [];
	coefficients.forEach((coefficient, index) => {
		if (coefficient === 0) return;
		const power = degree - index;
		const body = power === 0 ? `${Math.abs(coefficient)}` : power === 1 ? `${Math.abs(coefficient)}*${variable}` : `${Math.abs(coefficient)}*${variable}^${power}`;
		terms.push(`${coefficient < 0 ? "-" : terms.length === 0 ? "" : "+"}${body}`);
	});
	return terms.length === 0 ? "0" : terms.join("");
}

/** Horner evaluation of a coefficient list (highest power first). The truth this file compares against. */
function polynomialAt(coefficients: readonly number[], point: Cpx): Cpx {
	let accumulator = cpx(0);
	for (const coefficient of coefficients) accumulator = add(mul(accumulator, point), cpx(coefficient));
	return accumulator;
}

/** Multiplies two coefficient lists (highest power first). */
function polynomialMultiply(left: readonly number[], right: readonly number[]): number[] {
	const product = new Array<number>(left.length + right.length - 1).fill(0);
	for (let i = 0; i < left.length; i++) {
		for (let j = 0; j < right.length; j++) product[i + j] += left[i] * right[j];
	}
	return product;
}

/** Points spread across the real line, avoiding the small integers a generated polynomial is most likely to vanish at. */
function samplePoints(random: () => number, count: number): number[] {
	const points: number[] = [];
	for (let i = 0; i < count; i++) points.push((random() * 8 - 4) * 1.0173 + 0.2711);
	return points;
}

/** Fails unless two numbers agree to a relative tolerance, which is what an algebraic identity guarantees. */
function expectAgreement(actual: number, expected: number, context: string): void {
	const tolerance = 1e-7 * Math.max(1, Math.abs(expected));
	if (!(Math.abs(actual - expected) <= tolerance)) {
		throw new Error(`${context}: expected ${expected} but the engine's answer evaluates to ${actual}`);
	}
}

// ── expand ─────────────────────────────────────────────────────────────────

describe("expand agrees numerically with the product it was given", () => {
	test("100 random products of linear and quadratic factors", () => {
		const random = seededRandom(0x5eed01);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 100; trial++) {
			// Built from factors this test chose, so the product's value at any
			// point is known here without asking the engine anything.
			const factorCount = 2 + Math.floor(random() * 2);
			const factors: number[][] = [];
			for (let i = 0; i < factorCount; i++) {
				factors.push(random() < 0.75 ? [smallInt(random), smallInt(random)] : [smallInt(random, 3), smallInt(random), smallInt(random)]);
			}
			const source = factors.map(factor => `(${polynomialSource(factor)})`).join("*");
			const expanded = symbolicResult(engine, `expand(${source})`);
			for (const point of samplePoints(random, 4)) {
				const truth = factors.reduce((acc, factor) => mul(acc, polynomialAt(factor, cpx(point))), cpx(1));
				const actual = evaluateSymbolic(expanded, { x: cpx(point) });
				expectAgreement(actual.re, truth.re, `expand(${source}) at x=${point}`);
			}
		}
		engine.clear();
	});

	test("expanding a power agrees with repeated multiplication", () => {
		const random = seededRandom(0x5eed02);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const base = [smallInt(random, 3), smallInt(random, 6)];
			const exponent = 2 + Math.floor(random() * 5);
			const source = `expand((${polynomialSource(base)})^${exponent})`;
			const expanded = symbolicResult(engine, source);
			for (const point of samplePoints(random, 3)) {
				const linear = polynomialAt(base, cpx(point));
				let truth = cpx(1);
				for (let i = 0; i < exponent; i++) truth = mul(truth, linear);
				expectAgreement(evaluateSymbolic(expanded, { x: cpx(point) }).re, truth.re, `${source} at x=${point}`);
			}
		}
		engine.clear();
	});

	test("a two-variable product expands to the same surface", () => {
		const random = seededRandom(0x5eed03);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 30; trial++) {
			const a = smallInt(random);
			const b = smallInt(random);
			const source = `expand((x+${a >= 0 ? a : `(${a})`})*(y+${b >= 0 ? b : `(${b})`})*(x+y))`;
			const expanded = symbolicResult(engine, source);
			for (let sample = 0; sample < 3; sample++) {
				const x = random() * 6 - 3;
				const y = random() * 6 - 3;
				const truth = (x + a) * (y + b) * (x + y);
				expectAgreement(evaluateSymbolic(expanded, { x: cpx(x), y: cpx(y) }).re, truth, `${source} at x=${x}, y=${y}`);
			}
		}
		engine.clear();
	});
});

// ── factor ─────────────────────────────────────────────────────────────────

describe("factor agrees numerically with the polynomial it was given", () => {
	test("100 random polynomials built from known roots", () => {
		const random = seededRandom(0x5eed11);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 100; trial++) {
			// Building from roots guarantees the input really does factor over the
			// rationals, so a failure here is the factoriser being wrong rather
			// than it declining an irreducible input.
			const rootCount = 2 + Math.floor(random() * 2);
			let coefficients = [1];
			for (let i = 0; i < rootCount; i++) coefficients = polynomialMultiply(coefficients, [1, smallInt(random, 4)]);
			const source = polynomialSource(coefficients);
			const factored = symbolicResult(engine, `factor(${source})`);
			for (const point of samplePoints(random, 4)) {
				const truth = polynomialAt(coefficients, cpx(point));
				expectAgreement(evaluateSymbolic(factored, { x: cpx(point) }).re, truth.re, `factor(${source}) at x=${point}`);
			}
		}
		engine.clear();
	});

	test("a polynomial with an integer content and a leading coefficient still factors to itself", () => {
		const random = seededRandom(0x5eed12);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const scale = smallInt(random, 6);
			let coefficients = [scale];
			for (let i = 0; i < 2; i++) coefficients = polynomialMultiply(coefficients, [smallInt(random, 3), smallInt(random, 4)]);
			const source = polynomialSource(coefficients);
			const factored = symbolicResult(engine, `factor(${source})`);
			for (const point of samplePoints(random, 3)) {
				expectAgreement(evaluateSymbolic(factored, { x: cpx(point) }).re, polynomialAt(coefficients, cpx(point)).re, `factor(${source}) at x=${point}`);
			}
		}
		engine.clear();
	});

	test("an irreducible quadratic comes back unchanged rather than wrongly split", () => {
		// x^2+1 has no real roots, so any factorisation into real linear factors
		// would be false. Numeric agreement alone cannot catch that, since a wrong
		// factorisation would still have to agree at every point to fool it, but
		// asserting the shape is unchanged pins the decline itself.
		const engine = newTrackedEngine();
		expect(formatSymbolic(symbolicResult(engine, "factor(x^2+1)"))).toBe("x^2+1");
		expect(formatSymbolic(symbolicResult(engine, "factor(x^2+x+1)"))).toBe("x^2+x+1");
		engine.clear();
	});
});

// ── cancel ─────────────────────────────────────────────────────────────────

describe("cancel preserves the value of the quotient", () => {
	test("60 quotients built as (quotient x divisor) over divisor", () => {
		const random = seededRandom(0x5eed21);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 60; trial++) {
			// The numerator is manufactured as divisor*quotient, so the reduced form
			// is known here: it is `quotient`, and the test can check the engine
			// against that rather than against its own previous output.
			const divisor = [1, smallInt(random, 4)];
			const quotient = [smallInt(random, 3), smallInt(random, 5), smallInt(random, 5)];
			const numerator = polynomialMultiply(divisor, quotient);
			const source = `cancel((${polynomialSource(numerator)})/(${polynomialSource(divisor)}))`;
			const reduced = symbolicResult(engine, source);
			for (const point of samplePoints(random, 4)) {
				expectAgreement(evaluateSymbolic(reduced, { x: cpx(point) }).re, polynomialAt(quotient, cpx(point)).re, `${source} at x=${point}`);
			}
		}
		engine.clear();
	});

	test("a quotient that does not divide evenly keeps its value at every point", () => {
		const random = seededRandom(0x5eed22);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const numerator = [smallInt(random, 3), smallInt(random, 5), smallInt(random, 5)];
			const denominator = [1, smallInt(random, 4), smallInt(random, 4)];
			const source = `cancel((${polynomialSource(numerator)})/(${polynomialSource(denominator)}))`;
			const reduced = symbolicResult(engine, source);
			for (const point of samplePoints(random, 4)) {
				const bottom = polynomialAt(denominator, cpx(point));
				if (Math.abs(bottom.re) < 1e-3) continue;
				const truth = div(polynomialAt(numerator, cpx(point)), bottom);
				expectAgreement(evaluateSymbolic(reduced, { x: cpx(point) }).re, truth.re, `${source} at x=${point}`);
			}
		}
		engine.clear();
	});
});

// ── apart ──────────────────────────────────────────────────────────────────

describe("apart preserves the value of the rational function", () => {
	test("60 proper and improper rational functions with distinct linear poles", () => {
		const random = seededRandom(0x5eed31);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 60; trial++) {
			// Distinct roots keep the denominator square-free, which is the family
			// the partial-fraction rules are stated for. The identity being checked
			// holds everywhere except at the poles themselves.
			let first = smallInt(random, 5);
			let second = smallInt(random, 5);
			while (second === first) second = smallInt(random, 5);
			const denominator = polynomialMultiply([1, first], [1, second]);
			const numerator = [smallInt(random, 4), smallInt(random, 6)];
			const source = `apart((${polynomialSource(numerator)})/(${polynomialSource(denominator)}))`;
			const decomposed = symbolicResult(engine, source);
			for (const point of samplePoints(random, 5)) {
				const bottom = polynomialAt(denominator, cpx(point));
				if (Math.abs(bottom.re) < 1e-2) continue;
				const truth = div(polynomialAt(numerator, cpx(point)), bottom);
				expectAgreement(evaluateSymbolic(decomposed, { x: cpx(point) }).re, truth.re, `${source} at x=${point}`);
			}
		}
		engine.clear();
	});

	test("a repeated linear pole decomposes without changing the value", () => {
		const random = seededRandom(0x5eed32);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 30; trial++) {
			const root = smallInt(random, 4);
			const denominator = polynomialMultiply([1, root], [1, root]);
			const numerator = [smallInt(random, 4), smallInt(random, 6)];
			const source = `apart((${polynomialSource(numerator)})/(${polynomialSource(denominator)}))`;
			const decomposed = symbolicResult(engine, source);
			for (const point of samplePoints(random, 4)) {
				const bottom = polynomialAt(denominator, cpx(point));
				if (Math.abs(bottom.re) < 1e-2) continue;
				expectAgreement(
					evaluateSymbolic(decomposed, { x: cpx(point) }).re,
					div(polynomialAt(numerator, cpx(point)), bottom).re,
					`${source} at x=${point}`,
				);
			}
		}
		engine.clear();
	});
});

// ── solve ──────────────────────────────────────────────────────────────────

describe("every root solve returns satisfies the equation it came from", () => {
	test("120 random quadratics, real and complex discriminant alike", () => {
		const random = seededRandom(0x5eed41);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 120; trial++) {
			const coefficients = [smallInt(random, 4), smallInt(random, 8), smallInt(random, 8)];
			const source = `solve(${polynomialSource(coefficients)}=0, x)`;
			const roots = solvedRoots(engine, source);
			expect(roots.length).toBeGreaterThan(0);
			for (const root of roots) {
				const residual = magnitude(polynomialAt(coefficients, root));
				const scale = Math.max(1, magnitude(root) ** 2);
				if (!(residual <= 1e-8 * scale)) throw new Error(`${source}: root ${root.re}+${root.im}i leaves a residual of ${residual}`);
			}
		}
		engine.clear();
	});

	test("80 cubics built from known integer roots return exactly those roots", () => {
		const random = seededRandom(0x5eed42);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 80; trial++) {
			// Distinct roots, so the expected set is unambiguous and a dropped or
			// duplicated root is visible rather than being written off as a
			// multiplicity convention.
			const chosen: number[] = [];
			while (chosen.length < 3) {
				const candidate = smallInt(random, 5);
				if (!chosen.includes(candidate)) chosen.push(candidate);
			}
			let coefficients = [1];
			for (const root of chosen) coefficients = polynomialMultiply(coefficients, [1, -root]);
			const source = `solve(${polynomialSource(coefficients)}=0, x)`;
			const roots = solvedRoots(engine, source);
			const found = roots.map(root => root.re).sort((a, b) => a - b);
			const expectedRoots = [...chosen].sort((a, b) => a - b);
			expect(found.length).toBe(expectedRoots.length);
			found.forEach((value, index) => {
				expect(value).toBeCloseTo(expectedRoots[index], 6);
			});
			for (const root of roots) expect(Math.abs(root.im)).toBeLessThan(1e-9);
		}
		engine.clear();
	});

	test("a linear equation solves to the one value that satisfies it", () => {
		const random = seededRandom(0x5eed43);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 60; trial++) {
			const slope = smallInt(random, 9);
			const intercept = smallInt(random, 9);
			const target = smallInt(random, 9);
			const source = `solve(${slope}*x+${intercept >= 0 ? intercept : `(${intercept})`}=${target}, x)`;
			const roots = solvedRoots(engine, source);
			expect(roots.length).toBe(1);
			expect(roots[0].re).toBeCloseTo((target - intercept) / slope, 8);
		}
		engine.clear();
	});

	test("every root a biquadratic yields satisfies it, across 40 random ones", () => {
		const random = seededRandom(0x5eed44);
		const engine = newTrackedEngine();
		let answered = 0;
		for (let trial = 0; trial < 40; trial++) {
			const p = smallInt(random, 6);
			const q = smallInt(random, 6);
			const coefficients = [1, 0, p, 0, q];
			const source = `solve(${polynomialSource(coefficients)}=0, x)`;
			// A quartic whose roots have no exact closed form answers with a
			// sentence rather than a row of roots, so the property under test is
			// "whatever roots do come back are genuine", not "roots come back".
			const value = engine.evaluateLine(1, source);
			if (value.type === ValueType.String) continue;
			answered++;
			for (const root of solvedRoots(engine, source)) {
				const residual = magnitude(polynomialAt(coefficients, root));
				const scale = Math.max(1, magnitude(root) ** 4);
				if (!(residual <= 1e-7 * scale)) throw new Error(`${source}: root ${root.re}+${root.im}i leaves a residual of ${residual}`);
			}
		}
		// A guard on the guard: if a change ever made every quartic decline, the
		// loop above would pass while checking nothing at all.
		expect(answered).toBeGreaterThan(20);
		engine.clear();
	});

	test("a quartic with four exact complex roots returns all four", () => {
		// x^4+4 is the Sophie Germain identity, (x^2-2x+2)*(x^2+2x+2), so the four
		// roots are exactly (+/-1) +/- i. Re-derived here rather than read off the
		// engine: x^2 = -2i gives x = 1-i and -1+i, and x^2 = 2i gives 1+i, -1-i.
		const engine = newTrackedEngine();
		const roots = solvedRoots(engine, "solve(x^4+4=0, x)");
		expect(roots.length).toBe(4);
		const asText = roots.map(root => `${Math.round(root.re)},${Math.round(root.im)}`).sort();
		expect(asText).toEqual(["-1,-1", "-1,1", "1,-1", "1,1"]);
		engine.clear();
	});

	test("a repeated root is reported once rather than twice", () => {
		const engine = newTrackedEngine();
		// (x-3)^2 has the single distinct root 3. Reporting it once is the
		// convention; what must never happen is two slightly different values.
		const roots = solvedRoots(engine, "solve(x^2-6x+9=0, x)");
		expect(roots.length).toBe(1);
		expect(roots[0].re).toBeCloseTo(3, 9);
		engine.clear();
	});

	test("an equation with no solution and one true for every x are told apart", () => {
		const engine = newTrackedEngine();
		const impossible = engine.evaluateLine(1, "solve(0*x=1, x)");
		expect(impossible.type).toBe(ValueType.String);
		expect(String(impossible.value)).toMatch(/no solution/i);
		const always = engine.evaluateLine(2, "solve(0*x=0, x)");
		expect(always.type).toBe(ValueType.String);
		expect(String(always.value)).toMatch(/every value/i);
		engine.clear();
	});

	test("a non-polynomial equation is declined rather than answered approximately", () => {
		// A wrong root is indistinguishable from a right one once it is used, so
		// declining is the only safe answer for a shape the solver has no method for.
		const engine = newTrackedEngine();
		for (const source of ["solve(sin(x)=0, x)", "solve(exp(x)=1, x)", "solve(1/x=2, x)"]) {
			const value = engine.evaluateLine(1, source);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("SYMBOLIC_SOLVE_UNSUPPORTED");
		}
		engine.clear();
	});
});

// ── solve, verified for completeness as well as correctness ────────────────

/**
 * The half of solving that residual checking alone cannot see.
 *
 * A root that satisfies the equation is a correct root, and a list of correct
 * roots can still be the wrong answer: `solve(x^5-1=0, x)` once returned `1`,
 * which is a perfectly good root and one fifth of the truth, with nothing in
 * the output to say so. So each case here is checked twice. Every root goes
 * back into the polynomial over the complex plane and must leave a residual at
 * the level of rounding, and then the roots as a set have to multiply back up
 * to the polynomial they came from, which they can only do if none is missing.
 *
 * The reconstruction is what makes "the root count equals the degree with
 * multiplicity" an assertion rather than a hope. The solver reports a repeated
 * root once, so the count of distinct roots is not the degree and comparing
 * them would be wrong; instead every way of distributing the degree across the
 * roots reported is tried, and one of them has to rebuild the polynomial.
 */
describe("solve accounts for every root, not just the ones it finds easily", () => {
	/** Every way of writing `total` as `parts` positive whole numbers. */
	function multiplicityAssignments(total: number, parts: number): number[][] {
		if (parts < 1 || total < parts) return [];
		if (parts === 1) return [[total]];
		const out: number[][] = [];
		for (let first = 1; first <= total - (parts - 1); first++) {
			for (const rest of multiplicityAssignments(total - first, parts - 1)) out.push([first, ...rest]);
		}
		return out;
	}

	/** Multiplies `(x - root)` into a descending coefficient list. */
	function timesLinearFactor(descending: readonly Cpx[], root: Cpx): Cpx[] {
		const product: Cpx[] = new Array(descending.length + 1).fill(null).map(() => cpx(0));
		for (let i = 0; i < descending.length; i++) {
			product[i] = add(product[i], descending[i]);
			product[i + 1] = sub(product[i + 1], mul(descending[i], root));
		}
		return product;
	}

	/**
	 * Whether the roots, under some assignment of multiplicities, multiply back
	 * up to the polynomial.
	 *
	 * The multiplicities are searched rather than asked for, because the solver
	 * does not report them and the point of the check is not to trust it about
	 * anything. There are at most a handful of assignments at these degrees.
	 */
	function rootsRebuild(coefficients: readonly number[], roots: readonly Cpx[]): boolean {
		const degree = coefficients.length - 1;
		const largest = Math.max(1, ...coefficients.map(Math.abs));
		for (const multiplicities of multiplicityAssignments(degree, roots.length)) {
			let product: Cpx[] = [cpx(coefficients[0])];
			roots.forEach((root, index) => {
				for (let k = 0; k < multiplicities[index]; k++) product = timesLinearFactor(product, root);
			});
			const agrees = product.every((value, index) => magnitude(sub(value, cpx(coefficients[index]))) <= 1e-6 * largest);
			if (agrees) return true;
		}
		return false;
	}

	/** Fails unless a root leaves the polynomial at the level of rounding rather than merely small. */
	function expectRootSatisfies(coefficients: readonly number[], root: Cpx, context: string): void {
		const residual = magnitude(polynomialAt(coefficients, root));
		// The scale Horner's method itself reaches, which is what a residual has
		// to be judged against: for a degree-eight polynomial with coefficients in
		// the hundreds, a "small" absolute residual means nothing on its own.
		let scale = 0;
		for (const coefficient of coefficients) scale = scale * magnitude(root) + Math.abs(coefficient);
		if (!(residual <= 1e-8 * Math.max(1, scale))) {
			throw new Error(`${context}: root ${root.re}+${root.im}i leaves a residual of ${residual}`);
		}
	}

	const cases: { source: string; coefficients: number[]; distinct: number }[] = [
		// The reported defect. Every one of these five roots is exact:
		// x(x-1)(x+1)(x-i)(x+i). It used to answer [-1.00, -1, 0, 1.00, 1],
		// naming -1 and 1 twice each and both complex roots not at all.
		{ source: "solve(x^5-x=0, x)", coefficients: [1, 0, 0, 0, -1, 0], distinct: 5 },
		// Answered `1` and nothing else, with no sign that four roots were missing.
		{ source: "solve(x^5-1=0, x)", coefficients: [1, 0, 0, 0, 0, -1], distinct: 5 },
		// Answered [-1.0000000000000002, 7.07e-17, 1] for three exact roots.
		{ source: "solve(x^3-x=0, x)", coefficients: [1, 0, -1, 0], distinct: 3 },
		// Answered "no real solutions" while x^4+1, x^4+4 and x^4-x^2+1 all
		// returned four complex roots.
		{ source: "solve(x^4-2x^2+3=0, x)", coefficients: [1, 0, -2, 0, 3], distinct: 4 },
		{ source: "solve(x^2-2=0, x)", coefficients: [1, 0, -2], distinct: 2 },
		// A genuine double root, which is one solution reported once.
		{ source: "solve(x^2-4x+4=0, x)", coefficients: [1, -4, 4], distinct: 1 },
		// No closed form at all, so the whole answer comes from the numerical path.
		{ source: "solve(x^5+x+1=0, x)", coefficients: [1, 0, 0, 0, 1, 1], distinct: 5 },
		{ source: "solve(x^4+1=0, x)", coefficients: [1, 0, 0, 0, 1], distinct: 4 },
		{ source: "solve(x^4+4=0, x)", coefficients: [1, 0, 0, 0, 4], distinct: 4 },
		{ source: "solve(x^4-x^2+1=0, x)", coefficients: [1, 0, -1, 0, 1], distinct: 4 },
		{ source: "solve(x^6-1=0, x)", coefficients: [1, 0, 0, 0, 0, 0, -1], distinct: 6 },
		{ source: "solve(x^8-1=0, x)", coefficients: [1, 0, 0, 0, 0, 0, 0, 0, -1], distinct: 8 },
		// A repeated irrational root, reported once like any other repeat.
		{ source: "solve(x^4-4x^2+4=0, x)", coefficients: [1, 0, -4, 0, 4], distinct: 2 },
		{ source: "solve(x^3-2=0, x)", coefficients: [1, 0, 0, -2], distinct: 3 },
	];

	test.each(cases)("$source returns roots that all satisfy it", ({ source, coefficients }) => {
		const engine = newTrackedEngine();
		for (const root of solvedRoots(engine, source)) expectRootSatisfies(coefficients, root, source);
		engine.clear();
	});

	test.each(cases)("$source reports $distinct distinct roots", ({ source, distinct }) => {
		const engine = newTrackedEngine();
		expect(solvedRoots(engine, source)).toHaveLength(distinct);
		engine.clear();
	});

	test.each(cases)("$source returns roots that multiply back up to it", ({ source, coefficients }) => {
		const engine = newTrackedEngine();
		const roots = solvedRoots(engine, source);
		if (!rootsRebuild(coefficients, roots)) {
			throw new Error(`${source}: ${roots.length} roots do not reconstruct a degree-${coefficients.length - 1} polynomial`);
		}
		engine.clear();
	});

	test("x^5-x is answered exactly, with no numerical method involved at all", () => {
		// Every root of x(x-1)(x+1)(x^2+1) is exact, so nothing here may arrive as
		// a decimal that is nearly right. Compared without tolerance on purpose:
		// -1.0000000000004656 is what the defect looked like.
		const engine = newTrackedEngine();
		const roots = solvedRoots(engine, "solve(x^5-x=0, x)");
		const asText = roots.map(root => `${root.re},${root.im}`).sort();
		expect(asText).toEqual(["-1,0", "0,-1", "0,1", "0,0", "1,0"].sort());
		engine.clear();
	});

	test("x^3-x is answered exactly too, rather than losing the zero to rounding", () => {
		const engine = newTrackedEngine();
		expect(solvedRoots(engine, "solve(x^3-x=0, x)").map(root => root.re).sort((a, b) => a - b)).toEqual([-1, 0, 1]);
		engine.clear();
	});

	test("a determinant of whole numbers is a whole number", () => {
		// The same class of defect one subsystem over: [1,2,3;4,5,6;7,8,9] is
		// singular, and elimination in doubles answered 6.661338147750939e-16.
		// An integer matrix has an integer determinant, so anything else is the
		// method showing through the answer.
		const engine = newTrackedEngine();
		expect(engine.evaluateLine(1, "det([1,2,3;4,5,6;7,8,9])").toNumber()).toBe(0);
		expect(engine.evaluateLine(2, "det([2,0;0,3])").toNumber()).toBe(6);
		expect(engine.evaluateLine(3, "det([1,2,3;4,5,7;7,8,9])").toNumber()).toBe(6);
		expect(engine.evaluateLine(4, "det([0,1;1,0])").toNumber()).toBe(-1);
		engine.clear();
	});

	test("120 random integer polynomials of degree 2 to 6 are solved completely", () => {
		const random = seededRandom(0x5eed45);
		const engine = newTrackedEngine();
		let checked = 0;
		for (let trial = 0; trial < 120; trial++) {
			const degree = 2 + Math.floor(random() * 5);
			const coefficients = [smallInt(random, 4)];
			for (let i = 0; i < degree; i++) coefficients.push(Math.floor(random() * 11) - 5);
			const source = `solve(${polynomialSource(coefficients)}=0, x)`;

			const roots = solvedRoots(engine, source);
			for (const root of roots) expectRootSatisfies(coefficients, root, source);
			if (!rootsRebuild(coefficients, roots)) {
				throw new Error(`${source}: ${roots.length} roots do not reconstruct a degree-${degree} polynomial`);
			}
			checked++;
		}
		// A guard on the guard: a change that made every case decline would leave
		// the loop above asserting nothing.
		expect(checked).toBe(120);
		engine.clear();
	});

	test.failing("a quintic that factors over the rationals is still solved numerically", () => {
		// x^5+x+1 is (x^2+x+1)(x^3-x^2+1), so two of its roots are exactly
		// -1/2 ± sqrt(3)/2 i and a third is a Cardano expression. The solver only
		// divides out **linear** rational factors, so it never sees the quadratic
		// one and answers the whole equation with decimals. Recorded rather than
		// fixed: searching for higher-degree rational factors is a different
		// algorithm (Zassenhaus or LLL), not a refinement of this one.
		const engine = newTrackedEngine();
		const value = engine.evaluateLine(1, "solve(x^5+x+1=0, x)");
		const cells = value.type === ValueType.Matrix ? matrixCells(value.value as MatrixData) : [];
		const printed = cells.map(cell => (typeof cell === "object" ? formatSymbolic(cell) : String(cell))).join(", ");
		expect(printed).toContain("sqrt(3)");
	});
});

// ── derivatives ────────────────────────────────────────────────────────────

describe("der agrees with numerical differentiation", () => {
	/**
	 * The five-point central difference, whose error is O(h^4). The plain
	 * three-point rule is only O(h^2), which at h=1e-4 leaves an error near 1e-8
	 * and would force a tolerance loose enough to miss a genuinely wrong
	 * coefficient in the third or fourth decimal place.
	 */
	function numericalDerivative(f: (x: number) => number, at: number): number {
		const h = 1e-3 * Math.max(1, Math.abs(at));
		return (f(at - 2 * h) - 8 * f(at - h) + 8 * f(at + h) - f(at + 2 * h)) / (12 * h);
	}

	const cases: { source: string; f: (x: number) => number; domain: [number, number] }[] = [
		{ source: "x^5-3x^3+2x-7", f: x => x ** 5 - 3 * x ** 3 + 2 * x - 7, domain: [-3, 3] },
		{ source: "sin(x)", f: Math.sin, domain: [-3, 3] },
		{ source: "cos(x)*x", f: x => Math.cos(x) * x, domain: [-3, 3] },
		{ source: "sin(x)*cos(x)", f: x => Math.sin(x) * Math.cos(x), domain: [-3, 3] },
		{ source: "exp(x^2)", f: x => Math.exp(x * x), domain: [-1.2, 1.2] },
		{ source: "log(x)", f: Math.log, domain: [0.4, 6] },
		{ source: "tan(x)", f: Math.tan, domain: [-1.1, 1.1] },
		{ source: "sqrt(x)", f: Math.sqrt, domain: [0.3, 9] },
		{ source: "1/x", f: x => 1 / x, domain: [0.4, 6] },
		{ source: "sin(cos(x))", f: x => Math.sin(Math.cos(x)), domain: [-3, 3] },
		{ source: "exp(sin(x))", f: x => Math.exp(Math.sin(x)), domain: [-3, 3] },
		{ source: "x/(x^2+1)", f: x => x / (x * x + 1), domain: [-3, 3] },
		{ source: "(x^2+1)/(x-4)", f: x => (x * x + 1) / (x - 4), domain: [-3, 3] },
		{ source: "log(x^2+1)", f: x => Math.log(x * x + 1), domain: [-3, 3] },
		{ source: "sqrt(x^2+1)", f: x => Math.sqrt(x * x + 1), domain: [-3, 3] },
	];

	test.each(cases)("der($source, x) matches a five-point central difference", ({ source, f, domain }) => {
		const random = seededRandom(0x5eed51);
		const engine = newTrackedEngine();
		const derivative = symbolicResult(engine, `der(${source}, x)`);
		for (let sample = 0; sample < 8; sample++) {
			const at = domain[0] + random() * (domain[1] - domain[0]);
			const expected = numericalDerivative(f, at);
			const actual = evaluateSymbolic(derivative, { x: cpx(at) }).re;
			const tolerance = 1e-5 * Math.max(1, Math.abs(expected));
			if (!(Math.abs(actual - expected) <= tolerance)) {
				throw new Error(`der(${source}, x) at x=${at}: symbolic ${actual} vs numerical ${expected}`);
			}
		}
		engine.clear();
	});

	test("a second derivative matches differentiating twice", () => {
		const engine = newTrackedEngine();
		const once = formatSymbolic(symbolicResult(engine, "der(der(x^5-3x^3+2x, x), x)"));
		const directly = formatSymbolic(symbolicResult(engine, "der(x^5-3x^3+2x, x, 2)"));
		expect(directly).toBe(once);
		engine.clear();
	});

	test("differentiating a constant, and with respect to an absent variable, gives zero", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateLine(1, "der(5, x)").toNumber()).toBe(0);
		expect(engine.evaluateLine(2, "der(y^2, x)").toNumber()).toBe(0);
		engine.clear();
	});

	test("a partial derivative differentiates only the named variable", () => {
		const random = seededRandom(0x5eed52);
		const engine = newTrackedEngine();
		const byX = symbolicResult(engine, "der(x^2*y+y^3*x, x)");
		const byY = symbolicResult(engine, "der(x^2*y+y^3*x, y)");
		for (let sample = 0; sample < 6; sample++) {
			const x = random() * 4 - 2;
			const y = random() * 4 - 2;
			// d/dx = 2xy + y^3, d/dy = x^2 + 3y^2 x, both re-derived here by hand.
			expectAgreement(evaluateSymbolic(byX, { x: cpx(x), y: cpx(y) }).re, 2 * x * y + y ** 3, `d/dx at (${x},${y})`);
			expectAgreement(evaluateSymbolic(byY, { x: cpx(x), y: cpx(y) }).re, x * x + 3 * y * y * x, `d/dy at (${x},${y})`);
		}
		engine.clear();
	});

	test("a function with no known derivative is left unevaluated rather than guessed", () => {
		// Answering something plausible here would be worse than answering nothing:
		// x^x has a derivative, just not one this table knows.
		const engine = newTrackedEngine();
		expect(formatSymbolic(symbolicResult(engine, "der(x^x, x)"))).toBe("der(x^x, x)");
		engine.clear();
	});
});

// ── integrals ──────────────────────────────────────────────────────────────

describe("integral, differentiated again, returns the integrand", () => {
	const integrands = [
		"x^2",
		"3x^2+2x+1",
		"x^4-x",
		"1/x",
		"sin(x)",
		"cos(x)",
		"exp(x)",
		"1/(x^2)",
		"(3x+5)/(x^2-1)",
		"x^2/(x^2+1)",
		"1/(x-1)^2",
		"1/(x^2+2x+2)",
		"1/(x^2+1)",
	];

	test.each(integrands)("d/dx of integral(%s, x) is %s again", integrand => {
		const random = seededRandom(0x5eed61);
		const engine = newTrackedEngine();
		// Differentiating the engine's own antiderivative and comparing it back to
		// the integrand closes the loop: the derivative rules are checked
		// independently against numerical differentiation above, so an agreement
		// here is evidence about the integral rather than a circular restatement.
		const antiderivative = symbolicResult(engine, `integral(${integrand}, x)`);
		const roundTrip = symbolicResult(engine, `der(${formatSymbolic(antiderivative)}, x)`);
		const original = symbolicResult(engine, `${integrand} =>`);
		for (let sample = 0; sample < 8; sample++) {
			const at = 1.3 + random() * 4;
			const expected = evaluateSymbolic(original, { x: cpx(at) }).re;
			const actual = evaluateSymbolic(roundTrip, { x: cpx(at) }).re;
			expectAgreement(actual, expected, `d/dx integral(${integrand}) at x=${at}`);
		}
		engine.clear();
	});

	test("an integrand with no elementary antiderivative is refused rather than approximated", () => {
		const engine = newTrackedEngine();
		for (const source of ["integral(exp(x^2), x)", "integral(sin(x)/x, x)", "integral(exp(x)/x, x)"]) {
			const value = engine.evaluateLine(1, source);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("SYMBOLIC_INTEGRAL_UNSUPPORTED");
		}
		engine.clear();
	});
});

// ── taylor ─────────────────────────────────────────────────────────────────

describe("taylor approximates the function it expands", () => {
	const cases: { source: string; f: (x: number) => number; at: number; degree: number }[] = [
		{ source: "exp(x)", f: Math.exp, at: 0, degree: 6 },
		{ source: "sin(x)", f: Math.sin, at: 0, degree: 7 },
		{ source: "cos(x)", f: Math.cos, at: 0, degree: 6 },
		{ source: "1/(1-x)", f: x => 1 / (1 - x), at: 0, degree: 8 },
		{ source: "log(x)", f: Math.log, at: 1, degree: 6 },
	];

	test.each(cases)("taylor($source, x=$at, $degree) tracks the function nearby", ({ source, f, at, degree }) => {
		const engine = newTrackedEngine();
		const series = symbolicResult(engine, `taylor(${source}, x=${at}, ${degree})`);
		// Close to the expansion point a degree-n truncation is accurate to
		// O(offset^(n+1)), so a small offset is where a wrong coefficient shows up
		// as a gross disagreement rather than as ordinary truncation error.
		for (const offset of [-0.2, -0.05, 0.05, 0.2]) {
			const point = at + offset;
			const expected = f(point);
			const actual = evaluateSymbolic(series, { x: cpx(point) }).re;
			if (!(Math.abs(actual - expected) <= 1e-4 * Math.max(1, Math.abs(expected)))) {
				throw new Error(`taylor(${source}, x=${at}, ${degree}) at x=${point}: ${actual} vs ${expected}`);
			}
		}
		engine.clear();
	});
});

// ── a named unknown is an unknown ───────────────────────────────────────────

describe("naming a variable as a verb's unknown shadows the value the document gave it", () => {
	/**
	 * Evaluates `source` on a page that already defines `x` (and `y`), which is
	 * the whole point: a notepad is a document, and the line above is very
	 * often `:x = 5`.
	 */
	function onAPageDefining(source: string): ReturnType<ExpressionEngine["evaluateLine"]> {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":x = 5");
		engine.evaluateLine(2, ":y = 2");
		const value = engine.evaluateLine(3, source);
		engine.clear();
		return value;
	}

	test("der differentiates the expression rather than the number it evaluates to", () => {
		// With `:x = 5` above it, `x^2` was evaluated first and `der` was handed
		// 25, so it answered 0. A derivative of zero is a perfectly ordinary
		// answer, which is what made this the worst available outcome: nothing
		// about it looks wrong.
		const value = onAPageDefining("der(x^2, x)");
		expect(value.type).toBe(ValueType.Symbolic);
		expect(formatSymbolic(value.value as SymbolicNode)).toBe("2x");
	});

	test("solve solves the equation rather than checking whether the current value satisfies it", () => {
		const value = onAPageDefining("solve(x^2-4=0, x)");
		expect(value.type).toBe(ValueType.Matrix);
		const roots = matrixCells(value.value as MatrixData).map(cell => (typeof cell === "number" ? cell : Number.NaN));
		expect([...roots].sort((a, b) => a - b)).toEqual([-2, 2]);
		// The right-hand side needs the same treatment as the left: with x
		// bound only on the left this would be solving x^2-4 = 21.
		expect(onAPageDefining("solve(x^2=x+6, x)").type).toBe(ValueType.Matrix);
	});

	test("integral integrates the expression rather than a constant", () => {
		const antiderivative = onAPageDefining("integral(x^2, x)");
		expect(antiderivative.type).toBe(ValueType.Symbolic);
		// d/dx of x^3/3 is x^2, which is the check the integral block above
		// makes for every integrand; here what matters is that it is a
		// polynomial in x at all rather than the `25x` it used to be.
		expect(formatSymbolic(antiderivative.value as SymbolicNode)).toBe("1/3x^3");
	});

	test("taylor expands the function rather than the number", () => {
		const series = onAPageDefining("taylor(exp(x), x=0, 3)");
		expect(series.type).toBe(ValueType.Symbolic);
		// 1 + x + x^2/2 + x^3/6 at x=0.5, computed here: 1.6458333...
		expect(evaluateSymbolic(series.value as SymbolicNode, { x: cpx(0.5) }).re).toBeCloseTo(1 + 0.5 + 0.125 + 0.125 / 6, 9);
	});

	test("only the named unknown is shadowed, and only inside the verb", () => {
		// `y` is not the verb's argument, so it keeps the value the document
		// gave it: d/dx of x^2*y with y=2 is 4x, not 2xy.
		const partial = onAPageDefining("der(x^2*y, x)");
		expect(formatSymbolic(partial.value as SymbolicNode)).toBe("4x");
		// And the document variable itself is untouched by having been
		// shadowed, exactly as a function parameter leaves it untouched.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":x = 5");
		engine.evaluateLine(2, "der(x^2, x)");
		expect(engine.evaluateLine(3, "x + 1").toNumber()).toBe(6);
		engine.clear();
	});

	test("a verb on a page that defines nothing is unaffected", () => {
		// The shadow must not change the case that already worked.
		const engine = newTrackedEngine();
		expect(formatSymbolic(symbolicResult(engine, "der(x^2, x)"))).toBe("2x");
		expect(engine.evaluateLine(2, "der(5, x)").toNumber()).toBe(0);
		expect(engine.evaluateLine(3, "der(y^2, x)").toNumber()).toBe(0);
		engine.clear();
	});
});

// ── formatted output re-reads as the same number ───────────────────────────

describe("a printed algebraic answer re-reads as the value it printed", () => {
	/**
	 * The display string is the whole product as far as a user is concerned, and
	 * it is also what they paste onto the next line. A tree that is right but
	 * prints as text meaning something else is a wrong answer with extra steps,
	 * so every verb's output is fed back through the engine and compared against
	 * the tree it came from.
	 */
	const sources = [
		"der(sqrt(x), x)",
		"der(1/sqrt(x), x)",
		"der(x/sqrt(x+1), x)",
		"der(x^5-3x^3+2x-7, x)",
		"der(sin(x)*cos(x), x)",
		"der(x/(x^2+1), x)",
		"der(log(x^2+1), x)",
		"1/(2x) =>",
		"1/(x*y) =>",
		"1/(x/2) =>",
		"expand((x+1)^5)",
		"expand((2x-3)*(x^2+x-1))",
		"factor(x^3-x)",
		"factor(6x^2+11x+3)",
		"factor(x^4-1)",
		"cancel((x^2-4)/(x^2-x-2))",
		"apart(1/(x^2-1))",
		"apart((3x+5)/(x^2-1))",
		"apart(1/(x*(x+1)))",
		"integral(x^2, x)",
		"integral(1/x, x)",
		"integral((3x+5)/(x^2-1), x)",
		"taylor(exp(x), x=0, 3)",
	];

	test.each(sources)("%s prints text that evaluates to the same number", source => {
		const engine = newTrackedEngine();
		const tree = symbolicResult(engine, source);
		const printed = formatSymbolic(tree);
		const x = 1.7371;
		const y = 2.3313;
		const truth = evaluateSymbolic(tree, { x: cpx(x), y: cpx(y) });

		const rereader = newTrackedEngine();
		rereader.evaluateLine(1, `:x = ${x}`);
		rereader.evaluateLine(2, `:y = ${y}`);
		const reread = rereader.evaluateLine(3, printed);
		expect(reread.type).toBe(ValueType.Number);
		expectAgreement(reread.toNumber(), truth.re, `${source} printed as "${printed}"`);
		rereader.clear();
		engine.clear();
	});

	test("a quotient whose denominator is a product keeps its brackets", () => {
		// The regression this pins: `1/(2*sqrt(x))` once printed as `1/2*sqrt(x)`,
		// which reads back as `(1/2)*sqrt(x)`. At x=9 the tree is 1/6 and the text
		// said 1.5, a ninefold error in the only thing the user ever sees.
		const engine = newTrackedEngine();
		expect(formatSymbolic(symbolicResult(engine, "der(sqrt(x), x)"))).toBe("1/(2*sqrt(x))");
		expect(formatSymbolic(symbolicResult(engine, "1/(2x) =>"))).toBe("1/(2x)");
		expect(formatSymbolic(symbolicResult(engine, "1/(x*y) =>"))).toBe("1/(x*y)");
		expect(formatSymbolic(symbolicResult(engine, "a/(b/c) =>"))).toBe("a/(b/c)");
		engine.clear();
	});
});
