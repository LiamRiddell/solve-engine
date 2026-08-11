/**
 * The allocation guard: whether one evaluation can still ask for more memory
 * than the host has.
 *
 * `RobustnessResourceLimits.spec.ts` covers the limits that count things
 * between opcodes (instructions, stack depth, nesting) and the per-collection
 * ceiling. This file covers the one that counts what opcodes ALLOCATE, which is
 * a different question and the one the other limits structurally cannot answer:
 * they are checked between opcodes, so whatever a single opcode does inside a
 * loop of its own is invisible to every one of them.
 *
 * The input that made this necessary was not the range expansion that
 * `maxCollectionSize` already refuses. It was three lines, each of which passes
 * every limit the engine had:
 *
 *   :a = map(1*x, 0:20000)     20,001 elements, well under maxCollectionSize
 *   :b = transpose(a)          same size again
 *   b * a                      20,001 x 20,001, four hundred million cells
 *
 * A matrix multiply's result is the PRODUCT of two operands that are each
 * legal, so no per-site cap on either one can bound it. V8 aborted with
 * "JavaScript heap out of memory", which no `try` in the host can contain, so
 * this could never have been caught by a test either: it takes the process down
 * rather than failing. Every size here is chosen a few orders of magnitude
 * below that, so the counted refusal is all that happens.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError, ErrorCategory } from "@solve-js/errors/EngineError";
import { allocationUsed, beginEvaluation, chargeAllocation, endEvaluation, resetAllocationTracking } from "@solve-js/vm/AllocationBudget";
import { createVM } from "@solve-js/vm/VM";
import type { VM } from "@solve-js/vm/OpRegistry";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The `EngineError` a line throws, or `null` when it evaluated instead. */
function errorFrom(engine: ExpressionEngine, source: string, line = 1): EngineError | null {
	try {
		engine.evaluateLine(line, source);
		return null;
	} catch (thrown) {
		expect(thrown).toBeInstanceOf(EngineError);
		return thrown as EngineError;
	}
}

/** Evaluates each line in order on one engine, returning the error the last line threw, if any. */
function lastErrorOver(engine: ExpressionEngine, lines: string[]): EngineError | null {
	let error: EngineError | null = null;
	lines.forEach((line, index) => {
		error = errorFrom(engine, line, index + 1);
	});
	return error;
}

describe("the allocation a single opcode performs", () => {
	test("a matrix product larger than the budget is refused before it is built", () => {
		const engine = newTrackedEngine("en");
		try {
			const error = lastErrorOver(engine, [":a = map(1*x, 0:2000)", ":b = transpose(a)", "b * a"]);
			expect(error?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			expect(error?.category).toBe(ErrorCategory.EXECUTION);
			// Both halves of the product are named, because "too big" without a
			// number is not something a person can act on.
			expect(error?.message).toContain("4,004,001");
			expect(error?.message).toContain("2,000,000");
		} finally {
			engine.clear();
		}
	});

	test("the refusal is recoverable, and the engine keeps working after it", () => {
		// The property a host depends on. An allocation it cannot afford is a
		// statement about one line, not about the engine, and a host honouring
		// `isFatal()` must not be told to tear the document down over it.
		const engine = newTrackedEngine("en");
		try {
			const error = lastErrorOver(engine, [":a = map(1*x, 0:2000)", ":b = transpose(a)", "b * a"]);
			expect(error?.recoverable).toBe(true);
			expect(error?.isFatal()).toBe(false);

			expect(engine.evaluateLine(4, "2+2")[0].toNumber()).toBe(4);
			expect(engine.evaluateLine(5, "sum(x, 1:1000)")[0].toNumber()).toBe((1000 * 1001) / 2);
		} finally {
			engine.clear();
		}
	});

	test("a matrix is counted once, not once per site that touched it", () => {
		// The sites that know a size in advance CHECK rather than charge, and the
		// charge lands where the matrix is born. Billing at both would quietly
		// halve whatever ceiling the host asked for, which is the kind of
		// arithmetic error that only shows up as a limit that "seems too low".
		// Twelve is the whole honest cost of this expression: four cells for the
		// literal, four `Value`s for the collection it is read into (which exist
		// at the same time as the cells, so they are not the same four), and
		// four cells for the result. Twelve buys it and eleven does not.
		const affordable = new ExpressionEngine("en", false, { vm: { maxAllocatedElements: 12 } });
		try {
			expect(affordable.evaluateExpression("map(x*2, [1,2,3,4])")[0].type).toBe(ValueType.Matrix);
		} finally {
			affordable.clear();
		}

		const short = new ExpressionEngine("en", false, { vm: { maxAllocatedElements: 11 } });
		try {
			expect(errorFrom(short, "map(x*2, [1,2,3,4])")?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
		} finally {
			short.clear();
		}
	});

	test("a matrix power is charged for every squaring step, not just its answer", () => {
		// `a^k` is repeated multiplication, so it materialises a full matrix per
		// step. Counting only the result would report a fraction of what it
		// actually allocates.
		const engine = new ExpressionEngine("en", false, { vm: { maxAllocatedElements: 100 } });
		try {
			expect(errorFrom(engine, "[1,2;3,4]^1000000")?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			// The same matrix to a small power stays affordable.
			expect(engine.evaluateLine(2, "[1,2;3,4]^2")[0].type).toBe(ValueType.Matrix);
		} finally {
			engine.clear();
		}
	});
});

describe("the budget is a total, which is what makes it compose", () => {
	test("collections that are individually legal are bounded together", () => {
		// The gap every per-site cap leaves. Each of these three folds is inside
		// `maxCollectionSize`, so a per-collection ceiling passes all three and
		// the expression still materialises three times as much as any one of
		// them.
		const engine = new ExpressionEngine("en", false, {
			vm: { maxCollectionSize: 1000, maxAllocatedElements: 2500 },
		});
		try {
			expect(engine.evaluateLine(1, "sum(x, 1:1000)")[0].toNumber()).toBe((1000 * 1001) / 2);
			expect(errorFrom(engine, "sum(x, 1:1000) + sum(x, 1:1000) + sum(x, 1:1000)", 2)?.code)
				.toBe("ALLOCATION_LIMIT_EXCEEDED");
		} finally {
			engine.clear();
		}
	});

	test("a nested call spends the same allowance rather than a fresh one", () => {
		// `maxInstructions` cannot see recursion, because each reentrant
		// `executeBytecode()` gets its own counter; that is why function
		// recursion needed a guard of its own. The allocation tally is reset
		// only by the OUTERMOST entry, so a body called three times cannot
		// refresh its own budget three times.
		const engine = new ExpressionEngine("en", false, {
			vm: { maxCollectionSize: 1000, maxAllocatedElements: 2500 },
		});
		try {
			engine.evaluateLine(1, "f(n) = sum(x, 1:1000) + n");
			expect(engine.evaluateLine(2, "f(0)")[0].toNumber()).toBe((1000 * 1001) / 2);
			expect(errorFrom(engine, "f(0) + f(0) + f(0)", 3)?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
		} finally {
			engine.clear();
		}
	});

	test("each evaluation starts from zero, so a long document does not run itself out", () => {
		// The other half of "it is a total": a total that never reset would fail
		// the fortieth line of a perfectly ordinary document.
		const engine = newTrackedEngine("en");
		try {
			for (let line = 1; line <= 40; line++) {
				expect(engine.evaluateLine(line, "sum(x, 1:100000)")[0].toNumber()).toBe((100000 * 100001) / 2);
			}
		} finally {
			engine.clear();
		}
	});

	test("a refused line does not leave the tally behind it", () => {
		const engine = new ExpressionEngine("en", false, {
			vm: { maxCollectionSize: 1000, maxAllocatedElements: 2500 },
		});
		try {
			for (let i = 0; i < 20; i++) {
				expect(errorFrom(engine, "sum(x, 1:1000) + sum(x, 1:1000) + sum(x, 1:1000)", 1)?.code)
					.toBe("ALLOCATION_LIMIT_EXCEEDED");
				expect(engine.evaluateLine(2, "sum(x, 1:1000)")[0].toNumber()).toBe((1000 * 1001) / 2);
			}
		} finally {
			engine.clear();
		}
	});
});

describe("the ceiling belongs to the host", () => {
	test("a lower limit refuses what the default allows", () => {
		const engine = new ExpressionEngine("en", false, { vm: { maxAllocatedElements: 100 } });
		try {
			expect(errorFrom(engine, "map(1*x, 0:500)")?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			// And is a ceiling rather than a refusal of collections as such.
			expect(engine.evaluateLine(2, "sum(x, 1:40)")[0].toNumber()).toBe((40 * 41) / 2);
		} finally {
			engine.clear();
		}
	});

	test("a higher limit allows what the default refuses", () => {
		const engine = new ExpressionEngine("en", false, { vm: { maxAllocatedElements: 20000000 } });
		try {
			const lines = [":a = map(1*x, 0:2000)", ":b = transpose(a)", "b * a"];
			lines.forEach((line, index) => engine.evaluateLine(index + 1, line));
			expect(engine.evaluateLine(3, "b * a")[0].type).toBe(ValueType.Matrix);
		} finally {
			engine.clear();
		}
	});
});

describe("ordinary expressions are untouched", () => {
	test("the arithmetic, units and dates a document is actually made of", () => {
		const engine = newTrackedEngine("en");
		expect(engine.evaluateExpression("2 + 2 * 10")[0].toNumber()).toBe(22);
		expect(engine.evaluateExpression("(1+2)*(3+4)")[0].toNumber()).toBe(21);
		expect(engine.evaluateExpression("100 cm to m")[0].toNumber()).toBe(1);
		expect(engine.evaluateExpression("15% of 200")[0].toNumber()).toBe(30);
		expect(engine.evaluateExpression("sqrt(sqrt(sqrt(sqrt(65536))))")[0].toNumber()).toBe(2);
	});

	test("matrices, ranges, map and reduce at the sizes people write", () => {
		const engine = newTrackedEngine("en");
		expect(engine.evaluateExpression("[1,2;3,4] * [5,6;7,8]")[0].type).toBe(ValueType.Matrix);
		expect(engine.evaluateExpression("map(x*2, [1,2,3,4])")[0].type).toBe(ValueType.Matrix);
		expect(engine.evaluateExpression("reduce(acc+x, [1,2,3,4,5])")[0].toNumber()).toBe(15);
		expect(engine.evaluateExpression("sum(x, 1:100)")[0].toNumber()).toBe((100 * 101) / 2);
		// The largest collection the default configuration allows, expanded and
		// folded as before.
		expect(engine.evaluateExpression("sum(x, 1:100000)")[0].toNumber()).toBe((100000 * 100001) / 2);
		engine.clear();
	});

	test("a document of a thousand ordinary lines never meets the guard", () => {
		const engine = newTrackedEngine("en");
		try {
			for (let line = 1; line <= 1000; line++) {
				expect(engine.evaluateLine(line, `${line} * 3 + 1`)[0].toNumber()).toBe(line * 3 + 1);
			}
		} finally {
			engine.clear();
		}
	});
});

describe("the counter itself", () => {
	/** A VM whose only interesting property here is the ceiling it reports. */
	function vmWithLimit(elements: number): VM {
		return createVM(sharedOpRegistry, 200, 50000, 50, 100000, elements);
	}

	afterEach(() => resetAllocationTracking());

	test("charges nothing outside an evaluation", () => {
		// The exported helpers that charge are called by tests, by the formatter
		// and by hosts with no evaluation in flight. None of those is user input
		// being executed, so none of them should be able to trip the guard.
		resetAllocationTracking();
		chargeAllocation(1e12, "matrix cells");
		expect(allocationUsed()).toBe(0);
	});

	test("counts up to the limit and refuses past it", () => {
		beginEvaluation(vmWithLimit(10));
		try {
			chargeAllocation(6, "matrix cells");
			expect(allocationUsed()).toBe(6);
			chargeAllocation(4, "matrix cells");
			expect(allocationUsed()).toBe(10);
			expect(() => chargeAllocation(1, "matrix cells")).toThrow(EngineError);
		} finally {
			endEvaluation();
		}
	});

	test("names the limit, the request and what was being made", () => {
		beginEvaluation(vmWithLimit(10));
		try {
			chargeAllocation(999, "collection elements");
			throw new Error("the charge should have been refused");
		} catch (thrown) {
			const error = thrown as EngineError;
			expect(error).toBeInstanceOf(EngineError);
			expect(error.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			expect(error.message).toContain("999");
			expect(error.message).toContain("collection elements");
			expect(error.expected).toContain("10");
			expect(error.recoverable).toBe(true);
		} finally {
			endEvaluation();
		}
	});

	test("refuses a count that is not a count, rather than being switched off by it", () => {
		// `used += NaN` makes every later `used > limit` comparison false, which
		// would leave the guard silently disabled for the rest of the
		// evaluation. That is the one failure mode a safety limit must not have,
		// so a nonsensical count is refused on the spot.
		beginEvaluation(vmWithLimit(1000));
		try {
			expect(() => chargeAllocation(Number.NaN, "matrix cells")).toThrow(EngineError);
			expect(allocationUsed()).toBe(0);
			chargeAllocation(10, "matrix cells");
			expect(allocationUsed()).toBe(10);
		} finally {
			endEvaluation();
		}
	});

	test("a nested evaluation keeps the outer tally, and the next outer one starts fresh", () => {
		const vm = vmWithLimit(1000);
		beginEvaluation(vm);
		chargeAllocation(400, "matrix cells");
		beginEvaluation(vm);
		chargeAllocation(400, "matrix cells");
		expect(allocationUsed()).toBe(800);
		endEvaluation();
		expect(allocationUsed()).toBe(800);
		endEvaluation();

		beginEvaluation(vm);
		expect(allocationUsed()).toBe(0);
		endEvaluation();
	});
});
