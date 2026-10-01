import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import {
	callNode,
	constNode,
	dividesByZero,
	formatRational,
	formatSymbolic,
	nodeCount,
	rational,
	simplifySymbolic,
	substituteAll,
	symbolicKey,
	varNode,
	type SymbolicNode,
} from "@solve-js/symbolic";
import { absorbNegation, reshapeQuotient } from "@solve-js/symbolic/Simplify";
import { leadsWithPower } from "@solve-js/symbolic/SymbolicFormat";
import { evaluateConstant } from "@solve-js/symbolic/NumericEvaluate";
import { valueToSymbolic } from "@solve-js/vm/SymbolicOps";
import { ValueType, numberValue, numberValueRational, type Value } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Found bug: a formula was printed in a form that reads back as a different
 * formula, or that cannot be read back at all.
 *
 * - `solve(salary/1200 * rate = net, rate)` printed `net/(1/1200salary)`,
 *   which reads as one over 1200 salaries, and `-1/1200rate*salary/-1` was left
 *   with its two minus signs. A fraction in front of a term now goes after it
 *   as a division (`salary/1200`), and the simplifier cancels a double negative,
 *   turns `x/(1/y)` into `x*y`, moves a fractional coefficient out of a
 *   denominator, and folds `/-1` (`absorbNegation`, `reshapeQuotient`).
 * - The engine reads a leading minus as part of the operand after it, so
 *   `-x^2` is `(-x)^2`; the printer wrote `-(x^2)` as `-x^2`. A minus before a
 *   power is now bracketed (`leadsWithPower`).
 * - A coefficient was juxtaposed with text it cannot stand beside: `0.5` with
 *   `-2*(...)` became a subtraction, `5` with `sin(x)` did not parse, `0` with
 *   `x` was a hexadecimal literal, and `3` with `2^x` read as thirty-two.
 * - A fraction in a denominator, under a power or after a `*` lost its
 *   grouping (`x/1/3`, `2/3^2`), and three numbers joined by two slashes
 *   (`x^2/3/27`) read as a date.
 * - An exact fraction the arithmetic computed (`x*(1/3)`) joined a formula as
 *   its double and printed as the rounded `0.3333333333x`; a tiny one, such as
 *   1/735134400, printed as `1.4e-9`.
 *
 * The proof is a round trip: over thousands of generated formulas, the printed
 * text read back through the arrow has the formula's value at a sample point.
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

const x = varNode("x"), y = varNode("y");
const c = (n: number, d = 1): SymbolicNode => constNode(rational(BigInt(n), BigInt(d)));
const mul = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "mul", left, right });
const div = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "div", left, right });
const neg = (operand: SymbolicNode): SymbolicNode => ({ kind: "neg", operand });
const pow = (base: SymbolicNode, exponent: SymbolicNode): SymbolicNode => ({ kind: "pow", base, exponent });

/** The sample point every round trip is read at. */
const POINT: ReadonlyMap<string, SymbolicNode> = new Map([
	["x", c(13, 10)],
	["y", c(-7, 10)],
	["z", c(21, 10)],
]);

/** A tree's value at {@link POINT}, or null when it has none there. */
function valueAt(node: SymbolicNode, point: ReadonlyMap<string, SymbolicNode> = POINT): number | null {
	try {
		const v = evaluateConstant(substituteAll(node, point));
		return v === null || !Number.isFinite(v) ? null : v;
	} catch {
		return null;
	}
}

/** Every subtree of a tree, the tree included. */
function subtrees(node: SymbolicNode): SymbolicNode[] {
	switch (node.kind) {
		case "add":
		case "sub":
		case "mul":
		case "div":
			return [node, ...subtrees(node.left), ...subtrees(node.right)];
		case "neg":
			return [node, ...subtrees(node.operand)];
		case "pow":
			return [node, ...subtrees(node.base), ...subtrees(node.exponent)];
		case "call":
			return [node, ...node.args.flatMap(subtrees)];
		default:
			return [node];
	}
}

/** A seeded xorshift, so a failing formula can be found again. */
function generator(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state % 1000;
	};
}

/** A random formula over x, y and z, with small fractions, every operator, powers and four functions. */
function randomFormula(depth: number, next: () => number, names: readonly string[] = ["x", "y", "z"]): SymbolicNode {
	if (depth === 0 || next() % 5 === 0) {
		if (next() % 3 === 0) return varNode(names[next() % names.length]);
		return c((next() % 11) - 5, 1 + (next() % 4));
	}
	const kinds = ["add", "sub", "mul", "div", "neg", "pow", "call"] as const;
	const kind = kinds[next() % kinds.length];
	if (kind === "neg") return neg(randomFormula(depth - 1, next, names));
	if (kind === "pow") {
		const exponent = next() % 4 === 0 ? randomFormula(0, next, names) : c((next() % 7) - 3, 1 + (next() % 2));
		return pow(randomFormula(depth - 1, next, names), exponent);
	}
	if (kind === "call") return callNode(["sqrt", "abs", "sin", "exp"][next() % 4], [randomFormula(depth - 1, next, names)]);
	return { kind, left: randomFormula(depth - 1, next, names), right: randomFormula(depth - 1, next, names) };
}

/** The value of printed text read back through the arrow, at {@link POINT}. */
function readBack(engine: ExpressionEngine, text: string, point?: ReadonlyMap<string, SymbolicNode>): number | null {
	const v: Value = engine.evaluateExpression(`${text} =>`);
	if (v.type === ValueType.Symbolic) return valueAt(v.value as SymbolicNode, point);
	if (v.type === ValueType.Number) return v.value as number;
	return null;
}

/** Whether two values agree to a part in a million. */
function close(a: number, b: number): boolean {
	return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
}

describe("the lines that exposed it", () => {
	test("the solved formulas read as written by hand", () => {
		expect(shown("solve(salary/1200 * rate = net, rate)")).toBe("1200*net/salary");
		expect(shown("solve(net = salary * 1200, salary)")).toBe("net/1200");
		expect(shown("solve(net = rate*salary/1200, salary)")).toBe("1200*net/rate");
		expect(shown("solve(-x*salary/1200 = 5, salary)")).toBe("-6000/x");
		expect(shown("solve((salary / 12) * rate / 100 = net, rate)")).toBe("1200*net/salary");
	});

	test("the trivial forms are simplified", () => {
		expect(shown("-1/1200*rate*salary/-1 =>")).toBe("rate*salary/1200");
		expect(shown("x/(1/y) =>")).toBe("x*y");
		expect(shown("x/(y/z) =>")).toBe("x*z/y");
		expect(shown("x/-1 =>")).toBe("-x");
		expect(shown("-x/-y =>")).toBe("x/y");
		expect(shown("-(-x) =>")).toBe("x");
		expect(shown("x*-1/-1 =>")).toBe("x");
	});

	test("a fraction is written after the term, so it cannot read as one over the product", () => {
		expect(shown("x*(1/3) =>")).toBe("x/3");
		expect(shown("1/3x =>")).toBe("x/3");
		expect(shown("2/3x =>")).toBe("2x/3");
		expect(shown("integral(x^2, x)")).toBe("x^3/3");
		expect(shown("taylor(exp(x), x=0, 4)")).toBe("x^4/24+x^3/6+0.5x^2+x+1");
	});

	test("a minus before a power is bracketed, since -x^2 reads as (-x)^2", () => {
		expect(shown("-(x^2) =>")).toBe("-(x^2)");
		expect(shown("-x^2 =>")).toBe("(-x)^2");
		expect(both(["x = 3", "-x^2", "-(x^2)"])).toEqual(["3", "9", "-9"]);
	});

	test("each display reads back as itself", () => {
		for (const line of ["1200*net/salary", "x^3/3", "2x/3", "-(x^2)", "x*z/y", "rate*salary/1200"]) {
			expect(shown(`${line} =>`)).toBe(line);
		}
	});
});

describe("the parts: absorbNegation", () => {
	test("ordinary: a negative coefficient or an inner minus takes the sign", () => {
		expect(absorbNegation(c(-3), 0)).toEqual(c(3));
		expect(absorbNegation(neg(x), 0)).toEqual(x);
		expect(absorbNegation(mul(c(-2), x), 0)).toEqual(mul(c(2), x));
		expect(absorbNegation(div(neg(x), y), 0)).toEqual(div(x, y));
		expect(absorbNegation(div(x, c(-4)), 0)).toEqual(div(x, c(4)));
		expect(absorbNegation(mul(mul(c(-1, 1200), x), y), 0)).toEqual(mul(mul(c(1, 1200), x), y));
	});

	test("boundary: nothing to cancel is null, never a minus pushed into a positive coefficient", () => {
		expect(absorbNegation(c(3), 0)).toBeNull();
		expect(absorbNegation(c(0), 0)).toBeNull();
		expect(absorbNegation(x, 0)).toBeNull();
		expect(absorbNegation(mul(c(2), x), 0)).toBeNull();
		expect(absorbNegation({ kind: "add", left: x, right: c(-1) }, 0)).toBeNull();
		expect(absorbNegation(pow(c(-2), x), 0)).toBeNull();
		expect(absorbNegation(callNode("abs", [neg(x)]), 0)).toBeNull();
	});

	test("hostile: a sign buried deeper than the search reaches is left alone, in time", () => {
		let deep: SymbolicNode = neg(x);
		for (let i = 0; i < 5_000; i++) deep = mul(deep, y);
		expect(absorbNegation(deep, 0)).toBeNull();
		let shallow: SymbolicNode = neg(x);
		for (let i = 0; i < 3; i++) shallow = mul(shallow, y);
		expect(absorbNegation(shallow, 0)).not.toBeNull();
	});
});

describe("the parts: reshapeQuotient", () => {
	test("ordinary: each rewrite keeps the value", () => {
		expect(reshapeQuotient(x, c(-3))).toEqual(mul(c(-1, 3), x));
		expect(reshapeQuotient(neg(x), c(-3))).toEqual(div(x, c(3)));
		expect(reshapeQuotient(x, neg(y))).toEqual(neg(div(x, y)));
		expect(reshapeQuotient(neg(x), neg(y))).toEqual(div(x, y));
		expect(reshapeQuotient(x, div(c(1), y))).toEqual(div(mul(x, y), c(1)));
		expect(reshapeQuotient(x, mul(c(1, 1200), y))).toEqual(div(mul(c(1200), x), y));
		expect(reshapeQuotient(x, mul(y, c(2, 3)))).toEqual(div(mul(c(3, 2), x), y));
		for (const [l, r] of [[x, c(-3)], [neg(x), neg(y)], [x, div(y, varNode("z"))], [x, mul(c(1, 1200), y)]] as const) {
			const reshaped = reshapeQuotient(l, r)!;
			expect(valueAt(reshaped)).toBeCloseTo(valueAt(div(l, r))!, 12);
			expect(nodeCount(reshaped)).toBeLessThanOrEqual(nodeCount(div(l, r)));
		}
	});

	test("boundary: a plain denominator is left as it is", () => {
		expect(reshapeQuotient(x, c(3))).toBeNull();
		expect(reshapeQuotient(x, y)).toBeNull();
		expect(reshapeQuotient(x, mul(c(2), y))).toBeNull();
		expect(reshapeQuotient(x, pow(y, c(2)))).toBeNull();
		expect(reshapeQuotient(x, { kind: "add", left: y, right: c(1) })).toBeNull();
		expect(reshapeQuotient(x, mul(y, x))).toBeNull();
	});

	test("hostile: a prototype word as the names changes nothing", () => {
		for (const word of PROTOTYPE_WORDS) {
			const w = varNode(word);
			expect(reshapeQuotient(w, div(c(1), w))).toEqual(div(mul(w, w), c(1)));
		}
	});
});

describe("the parts: leadsWithPower", () => {
	test("ordinary: an operand raised to a power", () => {
		for (const text of ["x^2", "2^x", "sqrt(x)^2", "(x+1)^2", "x1^2", "rate^(1/2)", "0.5^x"]) expect({ text, leads: leadsWithPower(text) }).toEqual({ text, leads: true });
	});

	test("boundary: a power that belongs to a later operand, or none at all", () => {
		for (const text of ["", "x", "2x^2", "x*y^2", "-x^2", "x+y^2", "(x+1)*2", "sqrt(x^2)", "2(x+1)^2", "^2"]) {
			expect({ text, leads: leadsWithPower(text) }).toEqual({ text, leads: false });
		}
	});

	test("hostile: an unclosed bracket and a long text are answered in time", () => {
		expect(leadsWithPower("(x+1^2")).toBe(false);
		expect(leadsWithPower("sqrt(x^2")).toBe(false);
		expect(leadsWithPower(`${"(".repeat(10_000)}x${")".repeat(10_000)}^2`)).toBe(true);
		expect(leadsWithPower("x".repeat(100_000))).toBe(false);
	});
});

describe("the parts: formatSymbolic on shapes the simplifier never builds", () => {
	test("a fraction is bracketed in a denominator, under a power and after a product", () => {
		expect(formatSymbolic(div(x, c(1, 3)))).toBe("x/(1/3)");
		expect(formatSymbolic(pow(c(2, 3), c(2)))).toBe("(2/3)^2");
		expect(formatSymbolic(pow(x, c(1, 2)))).toBe("x^0.5");
		expect(formatSymbolic(pow(x, c(1, 3)))).toBe("x^(1/3)");
		expect(formatSymbolic(div(mul(x, c(-1, 3)), c(27)))).toBe("-x/3/27");
		expect(formatSymbolic(div(div(c(1), c(3)), c(27)))).toBe("1/3/27".replace("1/3/27", "(1/3)/27"));
	});

	test("a minus or a product in a denominator is bracketed", () => {
		expect(formatSymbolic(div(x, neg(mul(y, x))))).toBe("x/(-y*x)");
		expect(formatSymbolic(div(x, c(-3)))).toBe("x/(-3)");
		expect(formatSymbolic(div(x, mul(c(2), y)))).toBe("x/(2y)");
	});

	test("three numbers over each other are kept from reading as a date", () => {
		expect(formatSymbolic(div(div(pow(x, c(2)), c(3)), c(27)))).toBe("(x^2/3)/27");
		expect(shown("(x^2/3)/27 =>")).toBe("(x^2/3)/27");
	});

	test("a coefficient stands beside only what it can", () => {
		expect(formatSymbolic(mul(c(0), x))).toBe("0*x");
		expect(formatSymbolic(mul(c(5), callNode("sin", [x])))).toBe("5*sin(x)");
		expect(formatSymbolic(mul(c(3), pow(c(2), x)))).toBe("3*2^x");
		expect(formatSymbolic(mul(c(1, 2), mul(c(-2), x)))).toBe("0.5*-2x");
		expect(formatSymbolic(mul(c(2), { kind: "add", left: x, right: c(1) }))).toBe("2(x+1)");
		expect(formatSymbolic(mul(c(-1), pow(x, c(2))))).toBe("-(x^2)");
	});

	test("a leading minus on a power is bracketed, in a sum and alone", () => {
		expect(formatSymbolic(neg(pow(x, c(2))))).toBe("-(x^2)");
		expect(formatSymbolic({ kind: "add", left: neg(pow(x, c(2))), right: c(1) })).toBe("-(x^2)+1");
		expect(formatSymbolic({ kind: "sub", left: c(1), right: pow(x, c(2)) })).toBe("1-x^2");
		expect(formatSymbolic(neg(mul(pow(x, c(2)), y)))).toBe("-(x^2*y)");
	});

	test("a tiny fraction keeps ten significant figures", () => {
		expect(formatRational(rational(1n, 735134400n))).toBe("1.360295478e-9");
		expect(formatRational(rational(1n, 1200n))).toBe("1/1200");
		expect(formatRational(rational(1n, 3n))).toBe("1/3");
		expect(formatRational(rational(10_000_001n, 3n))).toBe("3333333.6666666665");
	});
});

describe("the parts: valueToSymbolic keeps an exact fraction", () => {
	test("ordinary: a fraction the arithmetic held joins as itself", () => {
		expect(valueToSymbolic(numberValueRational(1 / 3, rational(1n, 3n)))).toEqual(c(1, 3));
		expect(valueToSymbolic(numberValueRational(-1 / 1200, rational(-1n, 1200n)))).toEqual(c(-1, 1200));
	});

	test("boundary: a plain number joins by its written decimal", () => {
		expect(valueToSymbolic(numberValue(0.1))).toEqual(c(1, 10));
		expect(valueToSymbolic(numberValue(-0))).toEqual(c(0));
		expect(valueToSymbolic(numberValue(Number.NaN))).toBeNull();
	});
});

describe("the round trip: every printed formula reads back as itself", () => {
	test.each([7, 99, 4242])("over generated formulas, seed %i, raw and simplified", (seed) => {
		const engine = newTrackedEngine();
		const next = generator(seed);
		const wrong: string[] = [];
		let checked = 0;
		for (let i = 0; i < 2_500; i++) {
			const tree = randomFormula(1 + (i % 7), next);
			const want = valueAt(tree);
			// A formula with no value at the point, or a piece that has none
			// (a division by zero, a negative under a square root), says nothing
			// about the printer.
			if (want === null || Math.abs(want) > 1e6 || dividesByZero(tree) || !subtrees(tree).every((t) => valueAt(t) !== null)) continue;
			let simplified: SymbolicNode;
			try {
				simplified = simplifySymbolic(tree);
			} catch {
				continue;
			}
			// The simplifier's own promises hold over the same formulas.
			expect(symbolicKey(simplifySymbolic(simplified))).toBe(symbolicKey(simplified));
			expect(nodeCount(simplified)).toBeLessThanOrEqual(nodeCount(tree) + 1);
			for (const node of [tree, simplified]) {
				const text = formatSymbolic(node);
				let got: number | null;
				try {
					got = readBack(engine, text);
				} catch (e) {
					wrong.push(`${text} threw ${(e as Error).message}`);
					continue;
				}
				checked++;
				if (got === null || !close(got, want)) wrong.push(`${text} is ${String(got)}, the formula ${want}`);
			}
		}
		expect(wrong).toEqual([]);
		expect(checked).toBeGreaterThan(3_000);
	});

	test("a second sample point, so a reading that agrees at one point by chance is caught", () => {
		const engine = newTrackedEngine();
		const next = generator(31337);
		const point: ReadonlyMap<string, SymbolicNode> = new Map([["x", c(-17, 10)], ["y", c(23, 10)], ["z", c(3, 10)]]);
		let checked = 0;
		for (let i = 0; i < 1_500; i++) {
			const tree = randomFormula(1 + (i % 6), next);
			const want = valueAt(tree, point);
			if (want === null || Math.abs(want) > 1e6 || dividesByZero(tree) || !subtrees(tree).every((t) => valueAt(t, point) !== null)) continue;
			let simplified: SymbolicNode;
			try {
				simplified = simplifySymbolic(tree);
			} catch {
				continue;
			}
			const got = readBack(engine, formatSymbolic(simplified), point);
			expect({ text: formatSymbolic(simplified), close: got !== null && close(got, want) }).toEqual({ text: formatSymbolic(simplified), close: true });
			checked++;
		}
		expect(checked).toBeGreaterThan(700);
	});
});

describe("the round trip over unknowns named like units", () => {
	// `b` is the bit, `m` the metre and `k` a thousand after a number, so a
	// coefficient beside one of them (`2b`) read back as an amount. The printer
	// writes them after a `*` (FoundBug_unitNamedUnknown.spec.ts).
	test.each([2024, 77])("over generated formulas in b, m and k, seed %i, raw and simplified", (seed) => {
		const engine = newTrackedEngine();
		const next = generator(seed);
		const point: ReadonlyMap<string, SymbolicNode> = new Map([["b", c(13, 10)], ["m", c(-7, 10)], ["k", c(21, 10)]]);
		const wrong: string[] = [];
		let checked = 0;
		for (let i = 0; i < 1_500; i++) {
			const tree = randomFormula(1 + (i % 6), next, ["b", "m", "k"]);
			const want = valueAt(tree, point);
			if (want === null || Math.abs(want) > 1e6 || dividesByZero(tree) || !subtrees(tree).every((t) => valueAt(t, point) !== null)) continue;
			let simplified: SymbolicNode;
			try {
				simplified = simplifySymbolic(tree);
			} catch {
				continue;
			}
			for (const node of [tree, simplified]) {
				const text = formatSymbolic(node);
				let got: number | null;
				try {
					got = readBack(engine, text, point);
				} catch (e) {
					wrong.push(`${text} threw ${(e as Error).message}`);
					continue;
				}
				checked++;
				if (got === null || !close(got, want)) wrong.push(`${text} is ${String(got)}, the formula ${want}`);
			}
		}
		expect(wrong).toEqual([]);
		expect(checked).toBeGreaterThan(1_000);
	});
});

describe("adversarial: security", () => {
	test("prototype words as the names round-trip and leave Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine();
			for (const word of PROTOTYPE_WORDS) {
				const w = varNode(word);
				const formula = div(mul(c(-1, 1200), w), neg(pow(w, c(2))));
				const text = formatSymbolic(simplifySymbolic(formula));
				expect(text).not.toMatch(/\[object|undefined|NaN/);
				expectHonestLine(`${text} =>`);
				const point = new Map([[word, c(3)]]);
				const got = readBack(engine, text, point);
				expect(got).toBeCloseTo(valueAt(formula, point)!, 9);
			}
		});
	});

	test("a formula as deep as the printer reaches prints without throwing", () => {
		let deep: SymbolicNode = x;
		for (let i = 0; i < 2_000; i++) deep = i % 2 === 0 ? neg(div(deep, c(-3))) : mul(c(1, 7), deep);
		const started = Date.now();
		const text = formatSymbolic(deep);
		expect(typeof text).toBe("string");
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(() => simplifySymbolic(deep)).not.toThrow();
	});

	test("a wide formula near the size guard simplifies and prints in time", () => {
		let wide: SymbolicNode = x;
		for (let i = 0; i < 600; i++) wide = { kind: "add", left: wide, right: div(neg(varNode(`v${i % 50}`)), c(-(i % 9) - 1)) };
		const started = Date.now();
		const text = formatSymbolic(simplifySymbolic(wide));
		expect(text.length).toBeGreaterThan(0);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test("a look-alike name prints as itself and reads back as its own unknown", () => {
		// A Cyrillic х in place of the Latin x.
		const cyrillic = varNode("х");
		const text = formatSymbolic(simplifySymbolic(div(cyrillic, mul(c(1, 1200), y))));
		expect(text).toBe("1200х/y");
		expect(shown(`${text} =>`)).toBe(text);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a solved formula pasted back into a note answers with the values above it", () => {
		const formula = shown("solve(salary/1200 * rate = net, rate)");
		expect(both(["salary = 60000", "net = 1000", formula])).toEqual(["60,000", "1,000", "20"]);
	});

	test("a stored formula with a fraction prints and answers alike on both passes", () => {
		expect(both(["y = x*(1/3)", "x = 9", "y"])).toEqual(["x/3", "9", "3"]);
		expect(both(["y = -x/-1200", "y =>"])).toEqual(["x/1200", "x/1200"]);
	});

	test("the factor and solve answers that read the printer are unchanged in value", () => {
		expect(shown("solve(a*x+b=0, x)")).toBe("-b/a");
		expect(shown("der(sqrt(x), x)")).toBe("1/(2*sqrt(x))");
		expect(shown("factor(x^2 - 1/735134400)")).toBe("1.360295478e-9(735134400x^2-1)");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero and a whole-number quotient print plainly", () => {
		expect(shown("x*0 =>")).toBe("0");
		expect(shown("x/-0.5 =>")).toBe("-2x");
		expect(shown("x/(2^53) =>")).toBe("x/9007199254740992");
		expect(shown("-(0x) =>")).toMatch(/^THROWS|^0$/);
	});

	test("the largest coefficient a double holds prints in full and reads back", () => {
		const text = shown("x*1e15 =>");
		expect(text).toBe("1000000000000000x");
		expect(shown(`${text} =>`)).toBe(text);
	});

	test("an empty and a whitespace-only line before the arrow still say what is missing", () => {
		expect(shown("=>")).toMatch(/^THROWS "=>" needs an expression/);
		expect(shown(" \t =>")).toMatch(/^THROWS "=>" needs an expression/);
	});
});
