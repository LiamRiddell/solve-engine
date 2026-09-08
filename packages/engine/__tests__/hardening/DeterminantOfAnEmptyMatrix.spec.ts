/**
 * `det` of a matrix with no rows answers, rather than leaking a TypeError.
 *
 * `determinant` accepts a 0x0 matrix, because it is square, and then took the
 * integer route, which ends by reading the last pivot at `rows[n - 1][n - 1]`.
 * With no rows that is `rows[-1]`, and the host was handed
 * `Cannot read properties of undefined (reading '-1')` as an
 * `UNEXPECTED_ERROR`: a raw JavaScript exception wearing an engine error's
 * clothes, which is the one thing the VM's contract says cannot happen.
 *
 * | input        | before                            | now |
 * | ---          | ---                               | --- |
 * | `det` of 0x0 | `UNEXPECTED_ERROR` from a TypeError | `1` |
 *
 * One, the empty product, and not a new opinion: the numeric and symbolic
 * routes already returned `1` for the same matrix, because their elimination
 * loops do not run and they return the `1` they started from. The integer route
 * was the only one that disagreed, and it disagreed by crashing.
 *
 * The boundary: no expression can build such a matrix. A literal `[]` is
 * refused for having no shape, which is asserted below so that the day it
 * becomes constructible this page is the one that says what it should do. The
 * VM is reachable without the parser, through bytecode and through plugins, and
 * its promise not to leak an exception is made to those callers too.
 *
 * Found by the bytecode fuzzer, in a six-opcode program: build a 0x0 matrix,
 * call builtin 1.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { createVM, executeBytecode, type Bytecode } from "@solve-js/vm/VM";

/** The shrunk fuzz case: `MAT_NEW 0 0` then `CALL_BUILTIN 1 1`. */
function emptyMatrixDeterminant(): Bytecode {
	return {
		opcodes: new Uint8Array([152, 0, 0, 51, 1, 1]),
		numbers: new Float64Array([]),
		strings: [],
	} as unknown as Bytecode;
}

describe("det of a matrix with no rows", () => {
	test("answers instead of leaking an exception", () => {
		const result = executeBytecode(emptyMatrixDeterminant(), createVM());
		const asError = result as unknown as { type?: string; error?: { code?: string } };
		expect(asError.error?.code).not.toBe("UNEXPECTED_ERROR");
	});

	test("answers the empty product", () => {
		const result = executeBytecode(emptyMatrixDeterminant(), createVM());
		const asValue = result as unknown as { value?: { toNumber?: () => number } };
		expect(asValue.value?.toNumber?.()).toBe(1);
	});

	test("a one-cell matrix is unaffected", () => {
		// The neighbouring case, so the guard cannot be widened by accident.
		const engine = createEngine();
		expect(engine.evaluateExpression("det([1])").toNumber()).toBe(1);
		expect(engine.evaluateExpression("det([3])").toNumber()).toBe(3);
	});

	test("a singular matrix is still exactly zero", () => {
		// What the integer route exists for, kept beside the guard that now
		// short-circuits ahead of it.
		const engine = createEngine();
		expect(engine.evaluateExpression("det([1,2,3;4,5,6;7,8,9])").toNumber()).toBe(0);
	});

	test("no expression can build the matrix in the first place", () => {
		// The boundary, asserted rather than assumed. If this ever starts
		// passing, the case above is the one that says what the answer is.
		const engine = createEngine();
		expect(() => engine.evaluateExpression("det([])")).toThrow();
	});
});
