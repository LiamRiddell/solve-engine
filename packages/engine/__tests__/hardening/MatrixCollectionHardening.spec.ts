/**
 * Adversarial coverage for matrices, ranges, map/reduce, variables and
 * cross-line references.
 *
 * The linear-algebra half is checked by identity rather than by pinned output.
 * `A*inv(A)` is the identity for every invertible A, `det(A*B)` is
 * `det(A)*det(B)` for every pair, and transposing twice is a no-op: these hold
 * for randomly generated matrices, so they catch an elimination that is subtly
 * wrong in a way a handful of hand-picked 2x2 cases would sail past. The
 * matrices are generated from a seeded stream, so a failure reproduces exactly.
 *
 * The collection half attacks the boundaries instead, since that is where the
 * defects live: one-element collections, a collection whose element expression
 * is not the identity, an accumulator seeded explicitly versus implicitly, and
 * a range whose two ends coincide.
 *
 * Every expectation here is arithmetic this file works out for itself. Where a
 * reference value is written down it was derived by hand and the derivation is
 * in the comment, so a test failing means the engine changed rather than that
 * someone re-copied its output.
 */
import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";
import { formatSymbolic, type SymbolicNode } from "@solve-js/symbolic";
import { newTrackedEngine } from "@tools/trackedEngine";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mulberry32, so a random failure can be reproduced from its seed alone. */
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A matrix as ordinary nested rows, which is how this file does its own arithmetic. */
type Rows = number[][];

/** Reads a MatrixData back into row-major nested arrays, undoing the column-major storage. */
function toRows(matrix: MatrixData): Rows {
	const rows: Rows = [];
	for (let r = 0; r < matrix.rows; r++) {
		const row: number[] = [];
		for (let c = 0; c < matrix.cols; c++) row.push(matrix.data[r + c * matrix.rows] as number);
		rows.push(row);
	}
	return rows;
}

/** Writes nested rows as `[a, b; c, d]` source text. */
function toSource(rows: Rows): string {
	return `[${rows.map(row => row.map(cell => (cell < 0 ? `(${cell})` : String(cell))).join(", ")).join("; ")}]`;
}

/** The textbook matrix product, computed here rather than asked of the engine. */
function multiply(left: Rows, right: Rows): Rows {
	return left.map(row => right[0].map((_cell, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
}

/** Laplace expansion, deliberately a different algorithm from the elimination the engine uses. */
function determinant(rows: Rows): number {
	const size = rows.length;
	if (size === 1) return rows[0][0];
	if (size === 2) return rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0];
	let total = 0;
	for (let column = 0; column < size; column++) {
		const minor = rows.slice(1).map(row => row.filter((_cell, index) => index !== column));
		total += (column % 2 === 0 ? 1 : -1) * rows[0][column] * determinant(minor);
	}
	return total;
}

/** A square matrix of small integers, redrawn until it is comfortably far from singular. */
function invertibleMatrix(random: () => number, size: number): Rows {
	for (let attempt = 0; attempt < 200; attempt++) {
		const rows: Rows = [];
		for (let r = 0; r < size; r++) {
			const row: number[] = [];
			for (let c = 0; c < size; c++) row.push(Math.floor(random() * 19) - 9);
			rows.push(row);
		}
		if (Math.abs(determinant(rows)) >= 2) return rows;
	}
	throw new Error("could not draw a well-conditioned matrix");
}

/** Evaluates one expression on a throwaway engine and returns the raw Value. */
function evaluate(engine: ExpressionEngine, source: string) {
	const value = engine.evaluateLine(1, source);
	return value;
}

/** Evaluates one expression and insists it produced a matrix. */
function evaluateMatrix(engine: ExpressionEngine, source: string): Rows {
	const value = evaluate(engine, source);
	if (value.type !== ValueType.Matrix) throw new Error(`"${source}" produced ${ValueType[value.type]}: ${String(value.value)}`);
	return toRows(value.value as MatrixData);
}

/** Runs a whole document through the real DocumentModel/ThreeTierEvaluator pair, which is the only way cross-line access works. */
function evaluateDocument(lines: string[]): DocumentModel {
	const engine = newTrackedEngine();
	const document = new DocumentModel();
	document.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(document, engine).evaluate({ startLine: 1, endLine: lines.length });
	return document;
}

// ── Linear algebra identities ──────────────────────────────────────────────

describe("matrix inversion satisfies the identity that defines it", () => {
	test("A*inv(A) and inv(A)*A are both the identity, for 60 random 2x2 and 3x3 matrices", () => {
		const random = seededRandom(0xa11ce1);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 60; trial++) {
			const size = trial % 2 === 0 ? 2 : 3;
			const source = toSource(invertibleMatrix(random, size));
			for (const product of [`${source}*inv(${source})`, `inv(${source})*${source}`]) {
				const rows = evaluateMatrix(engine, product);
				for (let r = 0; r < size; r++) {
					for (let c = 0; c < size; c++) {
						// Elimination in doubles will not land on exactly 1 and 0, but an
						// inverse worth the name lands within a few ulps of them.
						expect(rows[r][c]).toBeCloseTo(r === c ? 1 : 0, 8);
					}
				}
			}
		}
		engine.clear();
	});

	test("a singular matrix is refused rather than inverted into nonsense", () => {
		// Every one of these has a zero determinant by construction: a repeated
		// row, a zero row, a scaled row, and the all-zero matrix.
		const engine = newTrackedEngine();
		for (const source of ["[1,2;2,4]", "[1,2;0,0]", "[0,0;0,0]", "[3,6;1,2]", "[1,2,3;4,5,6;7,8,9]", "[1,1,1;1,1,1;2,2,2]"]) {
			const value = evaluate(engine, `inv(${source})`);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("SINGULAR_MATRIX");
		}
		engine.clear();
	});

	test("inverting a non-square matrix is refused", () => {
		const engine = newTrackedEngine();
		for (const source of ["[1,2,3;4,5,6]", "[1,2;3,4;5,6]", "[1,2,3]"]) {
			const value = evaluate(engine, `inv(${source})`);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("INVERSE_REQUIRES_SQUARE_MATRIX");
		}
		engine.clear();
	});
});

describe("determinant identities", () => {
	test("det(A*B) equals det(A)*det(B) for 40 random pairs", () => {
		const random = seededRandom(0xa11ce2);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const size = trial % 2 === 0 ? 2 : 3;
			const a = invertibleMatrix(random, size);
			const b = invertibleMatrix(random, size);
			const product = toSource(multiply(a, b));
			const combined = evaluate(engine, `det(${product})`).toNumber();
			const expected = determinant(a) * determinant(b);
			expect(combined / expected).toBeCloseTo(1, 8);
		}
		engine.clear();
	});

	test("the engine's determinant agrees with a Laplace expansion computed here", () => {
		const random = seededRandom(0xa11ce3);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const rows = invertibleMatrix(random, trial % 2 === 0 ? 2 : 3);
			const expected = determinant(rows);
			const actual = evaluate(engine, `det(${toSource(rows)})`).toNumber();
			expect(actual / expected).toBeCloseTo(1, 8);
		}
		engine.clear();
	});

	test("det of a non-square matrix is refused", () => {
		const engine = newTrackedEngine();
		for (const source of ["[1,2,3;4,5,6]", "[1,2;3,4;5,6]"]) {
			const value = evaluate(engine, `det(${source})`);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("DETERMINANT_REQUIRES_SQUARE_MATRIX");
		}
		engine.clear();
	});
});

describe("transpose identities", () => {
	test("transposing twice returns the original, and (A*B)^T equals B^T*A^T", () => {
		const random = seededRandom(0xa11ce4);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 30; trial++) {
			const a = invertibleMatrix(random, 2);
			const b = invertibleMatrix(random, 2);
			const aSource = toSource(a);
			expect(evaluateMatrix(engine, `${aSource}^T^T`)).toEqual(a);
			// Reversing the order is the part worth pinning: `A^T*B^T` is a
			// different matrix, so a transpose that ignored order would still be
			// symmetric-looking and still pass a shape check.
			expect(evaluateMatrix(engine, `(${aSource}*${toSource(b)})^T`)).toEqual(evaluateMatrix(engine, `${toSource(b)}^T*${aSource}^T`));
		}
		engine.clear();
	});

	test("a non-square transpose swaps the shape rather than erroring", () => {
		const engine = newTrackedEngine();
		expect(evaluateMatrix(engine, "transpose([1,2,3;4,5,6])")).toEqual([
			[1, 4],
			[2, 5],
			[3, 6],
		]);
		engine.clear();
	});
});

describe("shapes that cannot combine are refused rather than guessed at", () => {
	test("adding and subtracting matrices of different shapes errors", () => {
		const engine = newTrackedEngine();
		for (const source of ["[1,2;3,4] + [1,2,3;4,5,6]", "[1,2;3,4] - [1,2,3]", "[1,2,3] + [1,2]"]) {
			const value = evaluate(engine, source);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("DIMENSION_MISMATCH");
		}
		engine.clear();
	});

	test("multiplying matrices whose inner dimensions disagree errors", () => {
		const engine = newTrackedEngine();
		for (const source of ["[1,2,3]*[1,2,3]", "[1,2;3,4]*[1,2,3;4,5,6;7,8,9]", "[1,2;3,4;5,6]*[1,2;3,4;5,6]"]) {
			const value = evaluate(engine, source);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("DIMENSION_MISMATCH");
		}
		engine.clear();
	});

	test("a product whose inner dimensions do agree is a real matrix product, not element-wise", () => {
		const random = seededRandom(0xa11ce5);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 30; trial++) {
			const a = invertibleMatrix(random, 2);
			const b = invertibleMatrix(random, 2);
			expect(evaluateMatrix(engine, `${toSource(a)}*${toSource(b)}`)).toEqual(multiply(a, b));
		}
		engine.clear();
	});

	test("a matrix raised to a whole power is that many matrix products", () => {
		const random = seededRandom(0xa11ce7);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 20; trial++) {
			// The reference is built here by multiplying the matrix by itself,
			// with the same `multiply` the product test above uses. `^` on a
			// matrix used to fall through to Math.pow of a value whose numeric
			// reading is 0, so `[1,2;3,4]^2` answered the number 0: not a wrong
			// matrix but no matrix at all, and 0 is a plausible-looking answer.
			const a = invertibleMatrix(random, trial % 2 === 0 ? 2 : 3);
			const source = toSource(a);
			let expected = a;
			for (let power = 2; power <= 4; power++) {
				expected = multiply(expected, a);
				const actual = evaluateMatrix(engine, `${source}^${power}`);
				expect(actual.length).toBe(expected.length);
				actual.forEach((row, r) => row.forEach((cell, c) => expect(cell).toBeCloseTo(expected[r][c], 6)));
			}
		}
		engine.clear();
	});

	test("the first power is the matrix and the zeroth is the identity", () => {
		// a^0 = I is what makes a^0 * a^n = a^n hold, the same reason 2^0 is 1.
		const engine = newTrackedEngine();
		expect(evaluateMatrix(engine, "[1,2;3,4]^1")).toEqual([
			[1, 2],
			[3, 4],
		]);
		expect(evaluateMatrix(engine, "[1,2;3,4]^0")).toEqual([
			[1, 0],
			[0, 1],
		]);
		expect(evaluateMatrix(engine, "[1,2,3;4,5,6;7,8,10]^0")).toEqual([
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		]);
		engine.clear();
	});

	test("pow() spells the same operation as ^", () => {
		const engine = newTrackedEngine();
		// [[1,2],[3,4]] squared, worked out by hand: [[1+6,2+8],[3+12,6+16]].
		expect(evaluateMatrix(engine, "pow([1,2;3,4], 2)")).toEqual([
			[7, 10],
			[15, 22],
		]);
		expect(evaluateMatrix(engine, "pow([1,2;3,4], 2)")).toEqual(evaluateMatrix(engine, "[1,2;3,4]^2"));
		engine.clear();
	});

	test("a power a matrix does not have is refused rather than answered with a number", () => {
		// Each of these once produced a bare number, which is the worst
		// available outcome: it flows into the next line as if it meant something.
		const engine = newTrackedEngine();
		for (const [source, code] of [
			["[1,2,3]^2", "MATRIX_POWER_REQUIRES_SQUARE_MATRIX"],
			["[1,2;3,4;5,6]^2", "MATRIX_POWER_REQUIRES_SQUARE_MATRIX"],
			["[1,2;3,4]^2.5", "MATRIX_POWER_REQUIRES_WHOLE_EXPONENT"],
			["[1,2;3,4]^-2", "MATRIX_POWER_REQUIRES_WHOLE_EXPONENT"],
			["2^[1,2;3,4]", "MATRIX_POWER_UNSUPPORTED"],
			["pow(2, [1,2;3,4])", "MATRIX_POWER_UNSUPPORTED"],
		] as [string, string][]) {
			const value = evaluate(engine, source);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe(code);
		}
		// The two caret suffixes that do have meanings still have them: `^-1`
		// is the inverse and `^T` the transpose, both taken at parse time.
		expect(evaluateMatrix(engine, "[1,2;3,4]^-1")[0][0]).toBeCloseTo(-2, 8);
		expect(evaluateMatrix(engine, "[1,2;3,4]^T")).toEqual([
			[1, 3],
			[2, 4],
		]);
		engine.clear();
	});

	test("an index outside the matrix errors instead of reading past the end", () => {
		const engine = newTrackedEngine();
		for (const source of ["[1,2,3][3]", "[1,2,3][-1]", "[1,2;3,4][2,0]", "[1,2;3,4][0,5]", "[1,2;3,4][-1,-1]"]) {
			const value = evaluate(engine, source);
			expect(value.type).toBe(ValueType.Error);
			expect(String(value.value)).toBe("MATRIX_INDEX_OUT_OF_BOUNDS");
		}
		engine.clear();
	});

	test("an empty matrix literal is rejected at parse time", () => {
		// There is no shape that `[]` could have, and inventing 0x0 would let it
		// slip into a product where it would silently produce nothing.
		expect(() => newTrackedEngine().evaluateExpression("[]")).toThrow();
	});
});

// ── Symbolic matrices ──────────────────────────────────────────────────────

describe("a matrix of unknowns inverts to something that really is its inverse", () => {
	/** Evaluates a symbolic (or already-numeric) cell at a point, independently of the engine. */
	function cellAt(cell: number | boolean | SymbolicNode, environment: Record<string, number>): number {
		if (typeof cell === "number") return cell;
		if (typeof cell === "boolean") throw new Error("a boolean cell has no numeric reading");
		const node = cell;
		switch (node.kind) {
			case "const":
				return Number(node.value.n) / Number(node.value.d);
			case "var":
				return environment[node.name];
			case "add":
				return cellAt(node.left, environment) + cellAt(node.right, environment);
			case "sub":
				return cellAt(node.left, environment) - cellAt(node.right, environment);
			case "mul":
				return cellAt(node.left, environment) * cellAt(node.right, environment);
			case "div":
				return cellAt(node.left, environment) / cellAt(node.right, environment);
			case "neg":
				return -cellAt(node.operand, environment);
			case "pow":
				return Math.pow(cellAt(node.base, environment), cellAt(node.exponent, environment));
			default:
				throw new Error(`no numeric reading for a ${node.kind} cell`);
		}
	}

	test("inv([a,b;c,d]) evaluated at 30 random points is the true 2x2 inverse", () => {
		const random = seededRandom(0xa11ce6);
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "m = [a, b; c, d]");
		const value = engine.evaluateLine(2, "inv(m)");
		expect(value.type).toBe(ValueType.Matrix);
		const matrix = value.value as MatrixData;
		expect(matrix.hasSymbolic).toBe(true);
		for (let trial = 0; trial < 30; trial++) {
			const environment = { a: random() * 6 - 3, b: random() * 6 - 3, c: random() * 6 - 3, d: random() * 6 - 3 };
			const det = environment.a * environment.d - environment.b * environment.c;
			if (Math.abs(det) < 0.3) continue;
			// The closed form for a 2x2 inverse, written out here rather than
			// reused from the engine: (1/det)*[[d,-b],[-c,a]].
			const expected = [
				[environment.d / det, -environment.b / det],
				[-environment.c / det, environment.a / det],
			];
			for (let r = 0; r < 2; r++) {
				for (let c = 0; c < 2; c++) {
					expect(cellAt(matrix.data[r + c * 2], environment)).toBeCloseTo(expected[r][c], 9);
				}
			}
		}
		engine.clear();
	});

	test("a symbolic matrix whose rows are literally identical is refused", () => {
		// [a,a;a,a] has determinant a*a - a*a = 0 whatever a is, so any matrix
		// answered here would be a fiction.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "m = [a, a; a, a]");
		const value = engine.evaluateLine(2, "inv(m)");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("SYMBOLIC_SINGULAR_OR_UNSUPPORTED_PIVOT");
		engine.clear();
	});

	test("a symbolic matrix whose determinant is zero for every assignment is refused too", () => {
		// [a,b;a,b] has determinant a*b - b*a, which is 0 whatever a and b are,
		// so there is no assignment under which an inverse exists. It was
		// answered with a matrix whose cells contained 1/(b-a*b/a), a division
		// by an expression that is identically zero. The rows are not literally
		// identical here, which is what the case above covers; this one needs
		// the elimination to actually reach zero rather than to `b-a*b/a`.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "m = [a, b; a, b]");
		const value = engine.evaluateLine(2, "inv(m)");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("SYMBOLIC_SINGULAR_OR_UNSUPPORTED_PIVOT");
		// And one whose singularity is a scaling rather than a repetition:
		// det([2a,b;a,b/2]) is 2a*(b/2) - b*a = 0 as well.
		engine.evaluateLine(3, "n = [2*a, b; a, b/2]");
		expect(String(engine.evaluateLine(4, "inv(n)").value)).toBe("SYMBOLIC_SINGULAR_OR_UNSUPPORTED_PIVOT");
		engine.clear();
	});

	test("the printed cells of a symbolic inverse re-read as the same numbers", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "m = [a, b; c, d]");
		const matrix = engine.evaluateLine(2, "inv(m)").value as MatrixData;
		const environment = { a: 1.7, b: -2.3, c: 0.9, d: 3.1 };
		for (let r = 0; r < 2; r++) {
			for (let c = 0; c < 2; c++) {
				const printed = formatSymbolic(matrix.data[r + c * 2] as SymbolicNode);
				const rereader = newTrackedEngine();
				rereader.evaluateLine(1, ":a = 1.7");
				rereader.evaluateLine(2, ":b = -2.3");
				rereader.evaluateLine(3, ":c = 0.9");
				rereader.evaluateLine(4, ":d = 3.1");
				const reread = rereader.evaluateLine(5, printed);
				expect(reread.type).toBe(ValueType.Number);
				expect(reread.toNumber()).toBeCloseTo(cellAt(matrix.data[r + c * 2], environment), 9);
				rereader.clear();
			}
		}
		engine.clear();
	});
});

// ── Ranges, map and reduce ─────────────────────────────────────────────────

describe("sum and prod apply the element expression to every element", () => {
	test("sum agrees with the same fold computed here, over 60 random collections", () => {
		const random = seededRandom(0xc0ffee1);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 60; trial++) {
			const length = 1 + Math.floor(random() * 5);
			const elements: number[] = [];
			for (let i = 0; i < length; i++) elements.push(Math.floor(random() * 19) - 9);
			const collection = `[${elements.join(", ")}]`;
			// The one-element case is the sharpest: a fold that seeds itself from
			// the first element never applies the expression at all there, so
			// `sum(x*10, [5])` came back as 5 rather than 50.
			for (const [expression, f] of [
				["x", (v: number) => v],
				["x*10", (v: number) => v * 10],
				["x+1", (v: number) => v + 1],
				["x^2", (v: number) => v * v],
				["2", () => 2],
			] as [string, (v: number) => number][]) {
				const expected = elements.reduce((total, element) => total + f(element), 0);
				expect(evaluate(engine, `sum(${expression}, ${collection})`).toNumber()).toBeCloseTo(expected, 9);
			}
		}
		engine.clear();
	});

	test("prod agrees with the same fold computed here, over 40 random collections", () => {
		const random = seededRandom(0xc0ffee2);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const length = 1 + Math.floor(random() * 4);
			const elements: number[] = [];
			for (let i = 0; i < length; i++) elements.push(1 + Math.floor(random() * 5));
			const collection = `[${elements.join(", ")}]`;
			for (const [expression, f] of [
				["x", (v: number) => v],
				["x*2", (v: number) => v * 2],
				["x+1", (v: number) => v + 1],
			] as [string, (v: number) => number][]) {
				const expected = elements.reduce((total, element) => total * f(element), 1);
				expect(evaluate(engine, `prod(${expression}, ${collection})`).toNumber()).toBeCloseTo(expected, 9);
			}
		}
		engine.clear();
	});

	test("a single-element collection still applies the expression", () => {
		const engine = newTrackedEngine();
		expect(evaluate(engine, "sum(x*10, [5])").toNumber()).toBe(50);
		expect(evaluate(engine, "prod(x*2, [5])").toNumber()).toBe(10);
		expect(evaluate(engine, "sum(x+1, [0])").toNumber()).toBe(1);
		engine.clear();
	});

	test("summing a range matches the closed form for the arithmetic series", () => {
		const engine = newTrackedEngine();
		for (const n of [1, 2, 5, 10, 100, 1000]) {
			// n(n+1)/2, which is not how the engine gets there.
			expect(evaluate(engine, `sum(x, 1:${n})`).toNumber()).toBe((n * (n + 1)) / 2);
		}
		// And a squared element expression against the other closed form,
		// n(n+1)(2n+1)/6, which only agrees if every element was squared.
		for (const n of [1, 4, 9, 20]) {
			expect(evaluate(engine, `sum(x^2, 1:${n})`).toNumber()).toBe((n * (n + 1) * (2 * n + 1)) / 6);
		}
		engine.clear();
	});

	test("a range whose ends coincide is one element, and a descending one is refused", () => {
		const engine = newTrackedEngine();
		expect(evaluate(engine, "sum(x, 3:3)").toNumber()).toBe(3);
		expect(evaluate(engine, "sum(x*2, 3:3)").toNumber()).toBe(6);
		expect(evaluateMatrix(engine, "map(x*2, 3:3)")).toEqual([[6]]);
		const descending = evaluate(engine, "sum(x, 5:1)");
		expect(descending.type).toBe(ValueType.Error);
		expect(String(descending.value)).toBe("DESCENDING_RANGE");
		engine.clear();
	});
});

describe("reduce folds the way its documentation says it does", () => {
	test("without an initial value the first element seeds the accumulator", () => {
		const random = seededRandom(0xc0ffee3);
		const engine = newTrackedEngine();
		for (let trial = 0; trial < 40; trial++) {
			const length = 1 + Math.floor(random() * 5);
			const elements: number[] = [];
			for (let i = 0; i < length; i++) elements.push(Math.floor(random() * 11) - 5);
			const collection = `[${elements.join(", ")}]`;
			// The documented shape: f(f(f(e0,e1),e2),e3), so the first element is
			// the seed and is never passed through the body itself.
			const expected = elements.slice(1).reduce((accumulator, element) => accumulator + element, elements[0]);
			expect(evaluate(engine, `reduce(acc+x, ${collection})`).toNumber()).toBeCloseTo(expected, 9);
		}
		engine.clear();
	});

	test("with an initial value the fold starts there and touches every element", () => {
		const engine = newTrackedEngine();
		expect(evaluate(engine, "reduce(acc+x, [1,2,3], 100)").toNumber()).toBe(106);
		expect(evaluate(engine, "reduce(acc*x, [1,2,3], 0)").toNumber()).toBe(0);
		expect(evaluate(engine, "reduce(acc*x, [2,3,4], 1)").toNumber()).toBe(24);
		// The initial value is what distinguishes a one-element fold from the
		// element itself: seeded with 100 this is 100+7, not 7.
		expect(evaluate(engine, "reduce(acc+x, [7], 100)").toNumber()).toBe(107);
		engine.clear();
	});

	test("the accumulator may change type across the fold", () => {
		const engine = newTrackedEngine();
		// max()/min() over a fold is the ordinary way a reduce is used for
		// something other than arithmetic, and it exercises a body that calls a
		// builtin on the accumulator rather than combining it arithmetically.
		expect(evaluate(engine, "reduce(max(acc,x), [3,1,4,1,5,9,2,6])").toNumber()).toBe(9);
		expect(evaluate(engine, "reduce(min(acc,x), [3,1,4,1,5,9,2,6])").toNumber()).toBe(1);
		engine.clear();
	});

	test("a reduce nested inside another reduce's body evaluates the inner fold once per step", () => {
		const engine = newTrackedEngine();
		// inner = reduce(acc+x,[1,2]) = 3. The outer fold seeds from 1 and then
		// adds 3 twice, for 1+3+3 = 7.
		expect(evaluate(engine, "reduce(acc+reduce(acc+x,[1,2]), [1,2,3])").toNumber()).toBe(7);
		// The same nesting through sum, which does apply its expression to every
		// element: inner = 3, so the outer is 3+3+3.
		expect(evaluate(engine, "sum(sum(x,[1,2]), [1,2,3])").toNumber()).toBe(9);
		engine.clear();
	});

	test("a bare function name folds and maps as that function", () => {
		const engine = newTrackedEngine();
		expect(evaluateMatrix(engine, "map(sqrt, [1,4,9,16])")).toEqual([[1, 2, 3, 4]]);
		expect(evaluate(engine, "reduce(gcd, [12, 18, 24])").toNumber()).toBe(6);
		engine.clear();
	});

	test("a user-defined function defined above is mapped over the collection", () => {
		const document = evaluateDocument(["f(n) = n * n", "map(f, [1,2,3])"]);
		const mapped = document.getLineAt(2)!.result!;
		expect(mapped.type).toBe(ValueType.Matrix);
		expect(toRows(mapped.value as MatrixData)).toEqual([[1, 4, 9]]);
	});

	test("mapping a function defined only on a later line errors rather than mapping zeros", () => {
		// Lines evaluate in ascending order, so on line 1 `f` genuinely does not
		// exist yet. Erroring is right; producing a row of zeros would not be.
		const document = evaluateDocument(["map(f, [1,2,3])", "f(n) = n * n"]);
		expect(document.getLineAt(1)!.result!.type).toBe(ValueType.Error);
	});

	test("map over a range produces one element per step", () => {
		const engine = newTrackedEngine();
		expect(evaluateMatrix(engine, "map(10*x, 0:3)")).toEqual([[0, 10, 20, 30]]);
		expect(evaluateMatrix(engine, "map(x*x, 1:5)")).toEqual([[1, 4, 9, 16, 25]]);
		engine.clear();
	});

	test("map over a two-dimensional matrix keeps its shape", () => {
		// The result of mapping a 2x2 is a 2x2, each cell the image of the cell
		// it sits in. It used to come back as the 1x4 row [2, 6, 4, 8], which
		// is not merely flattened: 6 is the image of 3, the cell BELOW 1, so
		// the column-major storage order was on display in the answer.
		const engine = newTrackedEngine();
		expect(evaluateMatrix(engine, "map(x*2, [1,2;3,4])")).toEqual([
			[2, 4],
			[6, 8],
		]);
		expect(evaluateMatrix(engine, "map(x*x, [1,2,3;4,5,6])")).toEqual([
			[1, 4, 9],
			[16, 25, 36],
		]);
		// A column stays a column, and a row stays a row.
		expect(evaluateMatrix(engine, "map(x+1, [1;2;3])")).toEqual([[2], [3], [4]]);
		expect(evaluateMatrix(engine, "map(x+1, [1,2,3])")).toEqual([[2, 3, 4]]);
		engine.clear();
	});
});

// ── Variables ──────────────────────────────────────────────────────────────

describe("variables", () => {
	test("a redefinition takes effect from its own line onward, leaving earlier lines alone", () => {
		// This is the property that makes a notepad readable: line 2 keeps the
		// value it computed, rather than being retroactively rewritten by line 3.
		const document = evaluateDocument([":x = 1", ":y = x + 1", ":x = 10", "y", "x"]);
		expect(document.getLineAt(2)!.result!.toNumber()).toBe(2);
		expect(document.getLineAt(4)!.result!.toNumber()).toBe(2);
		expect(document.getLineAt(5)!.result!.toNumber()).toBe(10);
	});

	test("a definition may read the variable's own previous value", () => {
		const document = evaluateDocument([":total = 0", ":total = total + 5", ":total = total + 5", "total"]);
		expect(document.getLineAt(4)!.result!.toNumber()).toBe(10);
	});

	test("a variable defined in terms of itself with no previous value is an error, not zero", () => {
		const document = evaluateDocument([":x = x + 1"]);
		expect(document.getLineAt(1)!.result!.type).toBe(ValueType.Error);
	});

	test("two variables defined in terms of each other both error rather than settling on a number", () => {
		const document = evaluateDocument([":a = b + 1", ":b = a + 1", "a"]);
		for (const line of [1, 2, 3]) expect(document.getLineAt(line)!.result!.type).toBe(ValueType.Error);
	});

	test("reading an undefined variable is an error rather than zero", () => {
		expect(() => newTrackedEngine().evaluateExpression("neverDefinedAnywhere + 1")).toThrow();
	});

	test("a function parameter shadows a document variable of the same name", () => {
		// The contrast worth keeping: the parameter wins inside the body, and the
		// document variable is untouched outside it.
		const document = evaluateDocument([":x = 100", "double(x) = x * 2", "double(5)", "x"]);
		expect(document.getLineAt(3)!.result!.toNumber()).toBe(10);
		expect(document.getLineAt(4)!.result!.toNumber()).toBe(100);
	});

	test("a function body may close over a document variable it does not take as a parameter", () => {
		const document = evaluateDocument([":m = 3", "f(n) = n * m", "f(4)"]);
		expect(document.getLineAt(3)!.result!.toNumber()).toBe(12);
	});

	test("calling a function with the wrong number of arguments errors rather than filling in zeros", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "f(n) = n + 1");
		expect(() => engine.evaluateLine(2, "f(1, 2)")).toThrow();
		engine.evaluateLine(3, "g(n, m) = n + m");
		expect(() => engine.evaluateLine(4, "g(1)")).toThrow();
		engine.clear();
	});

	test("a directly self-calling function is stopped rather than run until the stack dies", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "f(n) = f(n)");
		expect(() => engine.evaluateLine(2, "f(3)")).toThrow(/nesting|recursion/i);
		engine.clear();
	});

	test("a later definition of the same function name replaces the earlier one", () => {
		const document = evaluateDocument(["f(n) = n + 1", "f(n) = n + 2", "f(1)"]);
		expect(document.getLineAt(3)!.result!.toNumber()).toBe(3);
	});
});

// ── Cross-line references ──────────────────────────────────────────────────

describe("cross-line references", () => {
	test("lineN reads that line's result, and prev reads the line immediately above", () => {
		const document = evaluateDocument(["10", "20", "line1 + line2", "prev * 2"]);
		expect(document.getLineAt(3)!.result!.toNumber()).toBe(30);
		expect(document.getLineAt(4)!.result!.toNumber()).toBe(60);
	});

	test("sum above and average above cover the lines above and nothing else", () => {
		const document = evaluateDocument(["10", "20", "30", "sum above", "average above"]);
		expect(document.getLineAt(4)!.result!.toNumber()).toBe(60);
		// The average is over the three numeric lines above it, not over the four
		// lines above it including the sum: 60/3, not 120/4.
		expect(document.getLineAt(5)!.result!.toNumber()).toBeCloseTo(30, 9);
	});

	test("a blank line bounds what above reaches", () => {
		const document = evaluateDocument(["1", "2", "", "3", "4", "sum above"]);
		expect(document.getLineAt(6)!.result!.toNumber()).toBe(7);
	});

	test("a reference to a line that has not been evaluated yet errors rather than reading zero", () => {
		const document = evaluateDocument(["line2 + 1", "99"]);
		expect(document.getLineAt(1)!.result!.type).toBe(ValueType.Error);
	});

	test("a line referring to itself errors rather than looping", () => {
		const document = evaluateDocument(["line1 + 1"]);
		expect(document.getLineAt(1)!.result!.type).toBe(ValueType.Error);
	});

	test("a reference to a line holding an error propagates the error rather than a number", () => {
		const document = evaluateDocument(["line2", "line1"]);
		for (const line of [1, 2]) expect(document.getLineAt(line)!.result!.type).toBe(ValueType.Error);
	});

	test("a matrix on an earlier line multiplies as a matrix when referenced", () => {
		const document = evaluateDocument(["[1,2;3,4]", "line1 * line1"]);
		const product = document.getLineAt(2)!.result!;
		expect(product.type).toBe(ValueType.Matrix);
		// [[1,2],[3,4]]^2 worked out by hand: [[1+6, 2+8],[3+12, 6+16]].
		expect(toRows(product.value as MatrixData)).toEqual([
			[7, 10],
			[15, 22],
		]);
	});
});
