/**
 * Memory an evaluation takes and does not give back.
 *
 * `ResourceGuardAllocation.spec.ts` establishes that the engine has a budget
 * and that it composes. This file is about the two places that budget cannot
 * reach, and both are holes in its edges rather than arguments against it.
 *
 * The first is a call site that allocates before it charges. `vm/Value.ts`'s
 * `matrixValue()` charges deliberately late, and says so: it is "a backstop
 * rather than a refusal", correct for an opcode nobody has thought about yet
 * and not sufficient for one whose result size is known before the first cell
 * exists. `OpCode.MUL` therefore charges up front through
 * `matrixProductCells()`. `dot()` is the same multiplication reached through
 * `CALL_BUILTIN` instead of through the operator, calls the same
 * `matrixMultiply()`, and charges nothing before it runs.
 *
 * The second is `vm/Value.ts`'s ValueArena, which is not covered by the budget
 * at all because it outlives the evaluation the budget is scoped to. It grows
 * to the largest number of Values any single evaluation ever needed and keeps
 * that block for the life of the process.
 *
 * SIZING. As in `DenialOfServiceUnboundedWork.spec.ts`, everything here is
 * scaled to where it is merely observable and the fatal input is named in the
 * comment. Measured on the release/1.0.0 worktree, Node 24, 512MB heap:
 *
 *   dot(transpose(map(x*1, 1:20000)), map(x*1, 1:20000))
 *       fatal OOM in 1.3 seconds. The `*` spelling of the same product is
 *       refused in 18 milliseconds.
 *   map(x*1, 1:100000)
 *       legal under maxCollectionSize, and permanently grows the arena to
 *       300,004 Values, roughly 24MB that no later evaluation reclaims.
 */

import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { disableValueArena, enableValueArena } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The error code a source reports, or `"no error"` when it evaluated. */
function codeFrom(engine: ExpressionEngine, source: string): string {
	try {
		const [value] = engine.evaluateExpression(source);
		return value.type === 13 ? String(value.value) : "no error";
	} catch (thrown) {
		return (thrown as { code?: string }).code ?? "THREW";
	}
}

/** Evaluates `lines` as one document, which is the path that enables the arena. */
function runDocument(lines: string[]): void {
	const engine = newTrackedEngine();
	const document = new DocumentModel();
	document.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(document, engine).evaluate({ startLine: 1, endLine: lines.length });
}

/**
 * How many Values the process-wide arena is currently holding.
 *
 * The instance is module-private, and `enableValueArena()` returns it, so
 * reading the capacity means turning the arena on for the length of one
 * expression and off again. That is safe here because nothing is evaluating in
 * between: `enable` only resets the bump index, which is already zero outside
 * an evaluation.
 */
function arenaCapacity(): number {
	const arena = enableValueArena();
	disableValueArena();
	return arena.capacity;
}

// ── Charging before allocating, versus noticing afterwards ─────────────────

describe("a matrix product is refused before it is built", () => {
	test("the operator spelling charges for the result before making it", () => {
		// Two vectors of a hundred thousand elements each, individually legal
		// under `maxCollectionSize`, whose product is 10^10 cells. `OpCode.MUL`
		// works that number out from the two shapes and charges it, so the answer
		// is the budget's own refusal and not one cell is allocated.
		const engine = newTrackedEngine();
		expect(codeFrom(engine, "transpose(map(x*1, 1:100000)) * map(x*1, 1:100000)")).toBe("ALLOCATION_LIMIT_EXCEEDED");
	});

	test("and so does the function spelling of the same product", () => {
		// BUG. `dot()` is `VMBuiltins.ts` index 66 and goes straight to
		// `matrixMultiply()`, which opens with a bare
		// `new Array(resultRows * resultCols)`. Nothing has consulted the budget
		// by then, so what answers is whichever of V8's own limits the array runs
		// into first.
		//
		// This size is chosen so that limit is the harmless one: 100,001^2 is
		// past the maximum length a JavaScript array may have, so `new Array`
		// throws `RangeError: Invalid array length` before reserving anything,
		// and the raw message surfaces through the engine as UNEXPECTED_ERROR.
		// The distinct error code is the proof: an expression that never reached
		// the budget cannot have been refused by it.
		//
		// One order of magnitude down is where it stops being harmless. At
		// `1:20000` the array length is perfectly valid, so V8 obliges, and 400
		// million cells aborts the process in 1.3 seconds. `abs()`, `det()`,
		// `inv()` and `pow()` all reach `matrixMultiply()` the same way.
		const engine = newTrackedEngine();
		expect(codeFrom(engine, "dot(transpose(map(x*1, 1:100000)), map(x*1, 1:100000))")).toBe("ALLOCATION_LIMIT_EXCEEDED");
	});

	test("a product at the size people write is unaffected either way", () => {
		// Pinned so the guard above is a ceiling rather than a removal, and so
		// the two spellings keep agreeing on the answer as well as on the refusal.
		const engine = newTrackedEngine();
		const viaOperator = engine.evaluateExpression("[1,2;3,4] * [5,6;7,8]")[0];
		const viaFunction = engine.evaluateExpression("dot([1,2;3,4], [5,6;7,8])")[0];
		expect(viaFunction.value).toEqual(viaOperator.value);
	});
});

// ── The arena, which the budget is scoped too narrowly to see ──────────────

describe("the Value arena gives back what one expensive line borrowed", () => {
	test("it starts at its declared initial size", () => {
		// 512 Values, the block `ValueArena`'s constructor pre-allocates, which
		// its comment sizes as "~30-line viewport". Establishing the baseline is
		// what makes the growth in the next case legible as growth.
		expect(arenaCapacity()).toBe(512);
	});

	test("an ordinary line does not need more than that", () => {
		runDocument(["1 + 1"]);
		expect(arenaCapacity()).toBe(512);
	});

	test("and one expensive line does not keep more than that", () => {
		// BUG. `ValueArena.acquire()` handles overflow with `this.arena.push(v)`,
		// and `reset()` only zeroes the bump index, so the array is a high-water
		// mark that never comes down. The instance is module-level and survives
		// `disableValueArena()` on purpose, which means the high-water mark is
		// for the life of the process rather than the life of an evaluation.
		//
		// `map(x*1, 1:20000)` is well inside `maxCollectionSize`, so the engine
		// considers it an ordinary line, and it takes the arena from 512 Values
		// to 60,004. At the largest collection the engine will accept,
		// `map(x*1, 1:100000)`, it is 300,004 Values, about 24MB, still live
		// after two forced full collections and still live after evaluating
		// `1 + 1` afterwards.
		//
		// This is also what makes an unbounded call count fatal rather than
		// merely slow: the document path leaves the arena enabled for the whole
		// pass, so 2^21 user-function calls put two million Values in it and V8
		// aborts. See `DenialOfServiceUnboundedWork.spec.ts`'s last describe block.
		//
		// The assertion is that the arena returns to a size it could plausibly
		// hold forever, not that it never grows: growing to serve one line is the
		// point of a bump allocator. Keeping the block afterwards is not.
		runDocument(["map(x*1, 1:20000)"]);
		runDocument(["1 + 1"]);
		expect(arenaCapacity()).toBeLessThanOrEqual(4096);
	});
});
