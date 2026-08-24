/**
 * Whether the safety limits actually stop the things they are named after.
 *
 * A limit that is declared but never reached is worse than no limit, because
 * it is read as protection. Every guard the engine ships is exercised here
 * from the outside, through the public API, with an input chosen to trip that
 * specific one and nothing else:
 *
 *   maxExpressionLength   EXPRESSION_TOO_LONG
 *   maxComplexity         EXPRESSION_TOO_COMPLEX
 *   maxNestingDepth       NESTING_DEPTH_EXCEEDED
 *   vm.maxInstructions    INSTRUCTION_LIMIT_EXCEEDED
 *   vm.maxStackDepth      STACK_LIMIT_EXCEEDED
 *   vm.maxCollectionSize  COLLECTION_TOO_LARGE
 *   call-frame depth      FUNCTION_RECURSION_LIMIT_EXCEEDED
 *   maxDocumentLines      DOCUMENT_TOO_LARGE
 *
 * The rest of the 1.0.0 denial-of-service guards (total call count, the bigint
 * shift ceiling, the workday-offset ceiling, the allocation tally and the
 * symbolic depth guards) are exercised in the `DenialOfService*` specs
 * alongside the inputs that motivated them.
 *
 * Trip order matters and is asserted where it is load-bearing. Under the
 * default configuration the complexity score reaches its ceiling long before
 * the parser's own recursion counter does, so `maxNestingDepth` only becomes
 * observable once a host raises the other two. That is fine, but it means the
 * depth guard is untested by every default-configuration test in the suite,
 * which is exactly how a guard rots.
 *
 * The last describe block is about collection expansion, which used to happen
 * without anything asking how big the collection was. Its cases deliberately
 * use sizes a few orders of magnitude below the one that actually motivated
 * the guard, because the motivating input took the process down rather than
 * failing a test, and an aborted process cannot be asserted on.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The `EngineError` a source throws, or `null` when it evaluated instead. */
function errorFrom(engine: ExpressionEngine, source: string): EngineError | null {
	try {
		engine.evaluateExpression(source);
		return null;
	} catch (thrown) {
		expect(thrown).toBeInstanceOf(EngineError);
		return thrown as EngineError;
	}
}

describe("the default configuration bounds every input shape that recurses", () => {
	test("parentheses nested far past the parser's recursion depth stop at a limit", () => {
		// 200 levels is four times the default maxNestingDepth of 50. What
		// matters is not which of the two guards answers but that one of them
		// does, before the recursive descent reaches a native stack overflow.
		const engine = newTrackedEngine("en");
		const error = errorFrom(engine, "(".repeat(200) + "1" + ")".repeat(200));
		expect(error).not.toBeNull();
		expect(["EXPRESSION_TOO_COMPLEX", "NESTING_DEPTH_EXCEEDED"]).toContain(error!.code);
		expect(error!.message).not.toMatch(/call stack/i);
	});

	test("a chain of unary minus signs is bounded too", () => {
		// Unary minus recurses through parseExpression exactly like a paren
		// does, but contributes nothing to the paren-depth term of the
		// complexity score, so it is the shape most likely to slip past.
		const engine = newTrackedEngine("en");
		const error = errorFrom(engine, "-".repeat(500) + "1");
		expect(error).not.toBeNull();
		expect(error!.message).not.toMatch(/call stack/i);
	});

	test("an expression longer than the character limit is refused before lexing", () => {
		const engine = newTrackedEngine("en");
		const error = errorFrom(engine, "1+".repeat(2000) + "1");
		expect(error?.code).toBe("EXPRESSION_TOO_LONG");
		expect(error?.category).toBe("VALIDATION");
	});

	test("a long-but-legal expression is refused on complexity instead", () => {
		// Under 2000 characters, so the length check passes and the complexity
		// score is what answers. Pinned because the two limits are easy to
		// conflate and only one of them counts tokens.
		const engine = newTrackedEngine("en");
		const error = errorFrom(engine, "1" + "+1".repeat(400));
		expect(error?.code).toBe("EXPRESSION_TOO_COMPLEX");
	});

	test("the limits leave ordinary expressions alone", () => {
		// The other half of a limit test, and the half that catches a limit set
		// too low: everything here is well within what a real document holds.
		const engine = newTrackedEngine("en");
		expect(engine.evaluateExpression("(".repeat(30) + "1" + ")".repeat(30))[0].toNumber()).toBe(1);
		expect(engine.evaluateExpression("1" + "+1".repeat(100))[0].toNumber()).toBe(101);
		// 65536 is 2^16, so four square roots take it to 2.
		expect(engine.evaluateExpression("sqrt(sqrt(sqrt(sqrt(65536))))")[0].toNumber()).toBe(2);
	});
});

describe("the nesting-depth guard, once the limits in front of it are lifted", () => {
	/** Length and complexity raised out of the way; nesting depth left at its default 50. */
	function deepParseEngine(): ExpressionEngine {
		return new ExpressionEngine("en", false, {
			validation: {
				maxExpressionLength: 1_000_000,
				maxComplexity: 100_000_000,
				maxNestingDepth: 50,
				autoBalanceParens: false,
			},
		}, undefined, BUILTIN_PACKAGES);
	}

	test("parentheses past the depth report NESTING_DEPTH_EXCEEDED", () => {
		const engine = deepParseEngine();
		try {
			const error = errorFrom(engine, "(".repeat(200) + "1" + ")".repeat(200));
			expect(error?.code).toBe("NESTING_DEPTH_EXCEEDED");
			expect(error?.category).toBe("PARSING");
		} finally {
			engine.clear();
		}
	});

	test("unary minus counts toward the same depth", () => {
		const engine = deepParseEngine();
		try {
			expect(errorFrom(engine, "-".repeat(200) + "1")?.code).toBe("NESTING_DEPTH_EXCEEDED");
		} finally {
			engine.clear();
		}
	});

	test("a flat chain of the same operator does not, and still evaluates", () => {
		// Precedence climbing loops on same-level operators rather than
		// recursing, so a 200-term sum is depth 1. Asserted so a future change
		// that made the loop recursive would show up here rather than as a
		// mysterious depth error on a long invoice line.
		const engine = deepParseEngine();
		try {
			expect(engine.evaluateExpression("1" + "+1".repeat(200))[0].toNumber()).toBe(201);
		} finally {
			engine.clear();
		}
	});

	test("with every parse guard lifted, a native stack overflow is still contained", () => {
		// A host is free to raise all three limits, and at some depth the
		// recursive descent then overflows V8's own stack. That has to surface
		// as a caught EngineError rather than an uncaught RangeError escaping
		// into the host's event loop. It does. The code it arrives under is
		// the generic UNEXPECTED_ERROR rather than a depth-specific one, which
		// is a message-quality issue rather than a containment one, so this
		// asserts only the containment.
		const engine = new ExpressionEngine("en", false, {
			validation: {
				maxExpressionLength: 1_000_000,
				maxComplexity: 100_000_000,
				maxNestingDepth: 1_000_000,
				autoBalanceParens: false,
			},
		}, undefined, BUILTIN_PACKAGES);
		try {
			const error = errorFrom(engine, "-".repeat(5000) + "1");
			expect(error).toBeInstanceOf(EngineError);
			// And the engine is still usable afterwards, which is the part a
			// host depends on when a single line blows up mid-document.
			expect(engine.evaluateExpression("2+2")[0].toNumber()).toBe(4);
		} finally {
			engine.clear();
		}
	});
});

describe("the VM's own execution limits", () => {
	test("maxInstructions halts a program that runs too long", () => {
		const engine = new ExpressionEngine("en", false, { vm: { maxStackDepth: 200, maxInstructions: 20 } }, undefined, BUILTIN_PACKAGES);
		try {
			const error = errorFrom(engine, "1" + "+1".repeat(12));
			expect(error?.code).toBe("INSTRUCTION_LIMIT_EXCEEDED");
			expect(error?.category).toBe("EXECUTION");
			// Under the limit still runs, so the guard is a ceiling and not a
			// blanket refusal.
			expect(engine.evaluateExpression("1+1")[0].toNumber()).toBe(2);
		} finally {
			engine.clear();
		}
	});

	test("maxStackDepth halts a program that pushes too much", () => {
		const engine = new ExpressionEngine("en", false, { vm: { maxStackDepth: 5, maxInstructions: 50_000 } }, undefined, BUILTIN_PACKAGES);
		try {
			expect(errorFrom(engine, "[1,2,3,4,5,6,7,8,9,10]")?.code).toBe("STACK_LIMIT_EXCEEDED");
			expect(errorFrom(engine, "(1+(2+(3+(4+(5+6)))))")?.code).toBe("STACK_LIMIT_EXCEEDED");
		} finally {
			engine.clear();
		}
	});
});

describe("recursion through user-defined functions", () => {
	/** Evaluates each line in order on one engine and returns the last error, if any. */
	function lastError(lines: string[]): EngineError | null {
		const engine = newTrackedEngine("en");
		let error: EngineError | null = null;
		lines.forEach((line, index) => {
			try {
				engine.evaluateLine(index + 1, line);
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(EngineError);
				error = thrown as EngineError;
			}
		});
		return error;
	}

	test("a function that calls itself unconditionally is caught", () => {
		// maxInstructions cannot see this on its own: each nested call re-enters
		// executeBytecode with its own counter, so the call-frame depth guard is
		// the only thing standing between this and a native stack overflow.
		expect(lastError(["f(x) = f(x)", "f(1)"])?.code).toBe("FUNCTION_RECURSION_LIMIT_EXCEEDED");
	});

	test("a function that recurses without a base case is caught", () => {
		expect(lastError(["f(x) = f(x-1)", "f(10)"])?.code).toBe("FUNCTION_RECURSION_LIMIT_EXCEEDED");
	});

	test("two functions that call each other are caught", () => {
		// Mutual recursion never revisits the same frame twice in a row, so a
		// naive "am I already inside myself" check would miss it. The depth
		// counter does not.
		expect(lastError(["f(x) = g(x)", "g(x) = f(x)", "f(1)"])?.code).toBe("FUNCTION_RECURSION_LIMIT_EXCEEDED");
	});

	test("ordinary nesting well inside the limit still works", () => {
		const engine = newTrackedEngine("en");
		engine.evaluateLine(1, "double(x) = x*2");
		expect(engine.evaluateLine(2, "double(double(double(double(1))))")[0].toNumber()).toBe(16);
	});
});

describe("a range is expanded one value per element, with nothing asking how many", () => {
	test("the guards RANGE_NEW does have still fire", () => {
		const engine = newTrackedEngine("en");
		expect(engine.evaluateExpression("map(10*x, 1.5:3)")[0].type).toBe(ValueType.Error);
		expect(engine.evaluateExpression("map(10*x, 10:1)")[0].type).toBe(ValueType.Error);
		// And a range of a sane size maps normally.
		const mapped = engine.evaluateExpression("map(10*x, 0:3)")[0];
		expect(mapped.type).toBe(ValueType.Matrix);
	});

	test("a range far larger than any representable collection is refused", () => {
		// `collectionToValues()` in vm/MatrixOps.ts turns a Range into a real
		// array of one `Value` per element, and nothing used to look at the
		// count first. `maxInstructions` cannot help: the loop lives inside a
		// single opcode, so the counter is never consulted while it runs.
		//
		// The input that found this is `map(10*x, 0:2000000000)`, twenty-four
		// characters, which allocated until V8 aborted with "Reached heap limit
		// Allocation failed" and killed the process outright. That abort is not
		// catchable, so a test could not have caught it either: it would take
		// the Jest worker down instead of failing. A million elements stands in
		// for it here, still ten times past the `vm.maxCollectionSize` ceiling
		// and small enough that the counted refusal is all that happens.
		const engine = newTrackedEngine("en");
		const [value] = engine.evaluateExpression("reduce(acc+x, 0:1000000)");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("COLLECTION_TOO_LARGE");
		engine.clear();
	});

	test("the ceiling is the configured one, and a collection under it still folds", () => {
		// A host that wants a tighter (or looser) bound gets one, and the guard
		// is a ceiling rather than a blanket refusal of large collections.
		const engine = new ExpressionEngine("en", false, { vm: { maxStackDepth: 200, maxInstructions: 50_000, maxCollectionSize: 10 } }, undefined, BUILTIN_PACKAGES);
		try {
			const [refused] = engine.evaluateExpression("sum(x, 1:11)");
			expect(refused.type).toBe(ValueType.Error);
			expect(String(refused.value)).toBe("COLLECTION_TOO_LARGE");
			// 1..10 is exactly the limit, so it folds: 10*11/2.
			expect(engine.evaluateExpression("sum(x, 1:10)")[0].toNumber()).toBe(55);
		} finally {
			engine.clear();
		}
	});

	test("a range the default configuration does allow is expanded as before", () => {
		const engine = newTrackedEngine("en");
		// 1..100000 by the closed form n(n+1)/2, which is not how the engine
		// gets there.
		expect(engine.evaluateExpression("sum(x, 1:100000)")[0].toNumber()).toBe((100000 * 100001) / 2);
		engine.clear();
	});
});

describe("how many lines a document may have, which no per-line limit can see", () => {
	/** A document of `count` lines, each of them trivially cheap on its own. */
	function document(count: number): string {
		return Array.from({ length: count }, (_, index) => `${index} + 1`).join("\n");
	}

	test("a document past the ceiling is refused by name, before it is scanned", () => {
		// Every limit in this file bounds what ONE line may ask for, and a
		// document's cost is its line count whatever the lines say: each one is a
		// LineState with six arrays in it. Two hundred thousand lines of `1 + 1`
		// exhausted the heap and aborted the process, which no host can catch,
		// and `performance.maxDocumentLines` was declared for exactly this and
		// read nowhere until the 1.0.0 hardening pass.
		//
		// A tightened limit is used rather than the default 100,000, so this test
		// costs a few kilobytes rather than a megabyte and still exercises the
		// same check.
		const engine = new ExpressionEngine("en", false, { performance: { defaultCacheSize: 2000, maxDocumentLines: 500 } as any }, undefined, BUILTIN_PACKAGES);
		try {
			const error = (() => {
				try { engine.parseDocument(document(501)); return null; } catch (thrown) { return thrown as EngineError; }
			})();
			expect(error?.code).toBe("DOCUMENT_TOO_LARGE");
			// Recoverable: the document is too big, the engine is fine.
			expect(error?.recoverable).toBe(true);
		} finally {
			engine.clear();
		}
	});

	test("a document at the ceiling is processed normally", () => {
		// The guard has to be a ceiling rather than a refusal of long documents.
		const engine = new ExpressionEngine("en", false, { performance: { defaultCacheSize: 2000, maxDocumentLines: 500 } as any }, undefined, BUILTIN_PACKAGES);
		try {
			expect(engine.parseDocument(document(500)).totalLines).toBe(500);
		} finally {
			engine.clear();
		}
	});

	test("the document model refuses the same size, since it is what holds the lines", () => {
		// `parseDocument()` is one of the two doors into a whole document. The
		// other is DocumentModel, which a host drives directly for incremental
		// editing and which allocates the per-line records.
		const model = new DocumentModel(500);
		expect(() => model.setDocument(document(501))).toThrow(/more than 500 lines/);
		model.setDocument(document(500));
		expect(model.lineCount).toBe(500);
	});
});
