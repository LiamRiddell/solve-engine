/**
 * The `solve-engine/vm` subpath as a package author reaches it.
 *
 * That barrel exports a deliberately narrow slice of the VM: the value
 * constructors an opcode needs to build a result, and the accounting half of
 * the allocation guard. Its own comment says why the guard's accounting half
 * is public at all: "an opcode that allocates in proportion to user input has
 * to charge for what it makes", and the lifecycle half stays internal because
 * `executeBytecode()` owns it.
 *
 * Five of those exports had no test: `checkAllocation`, `checkedArray`,
 * `allocatePluginFunctionIndex`, `colVectorValue` and `rangeValue`. The
 * existing guard tests (`hardening/ResourceGuardAllocation.spec.ts`) reach the
 * budget through `@solve-js/vm/AllocationBudget`, opening and closing an
 * evaluation by hand, which is a path no package author has: those two
 * functions are not exported. So what a package author can actually do with
 * the guard, charge from inside a plugin function during a real evaluation,
 * was untested.
 */

import { describe, expect, test } from "@jest/globals";
import { checkAllocation, checkedArray, chargeAllocation } from "@solve-js/vm/AllocationBudget";
import { allocatePluginFunctionIndex } from "@solve-js/vm/VMBuiltins";
import {
	colVectorValue,
	matrixValue,
	numberValue,
	rangeValue,
	rowVectorValue,
	ValueType,
	type MatrixData,
	type RangeData,
	type Value,
} from "@solve-js/vm/Value";
import { OpRegistry, sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Wrap a plugin handler in a package the engine can register, so the handler
 * runs inside a real `executeBytecode()` and therefore inside a real
 * evaluation. This is the only way the guard is reachable from a package: the
 * begin/end pair that arms it is not exported.
 */
function packageAround(
	keyword: string,
	handler: (args: Value[]) => Value,
): IEnginePackage {
	const index = allocatePluginFunctionIndex();
	const tokenType = `PKG_${keyword.toUpperCase()}`;

	const parselet: PrefixParselet = {
		category: "Guard test",
		parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			builder.emitOpcode(OpCode.CALL_PLUGIN);
			builder.emitIndex(index);
			builder.emitIndex(0);
		},
	};

	return {
		name: `guard-test-${keyword}`,
		lexerVocabulary: { keywords: { [keyword]: tokenType } },
		prefixParselets: [{ tokenType, parselet }],
		pluginFunctions: [{ index, handler }],
	};
}

describe("allocatePluginFunctionIndex", () => {
	test("hands out a distinct index every time", () => {
		/*
		 * The doc on `IEnginePackage.pluginFunctions` says an index MUST come
		 * from here and must never be hardcoded, because two packages picking
		 * the same number silently overwrite each other's handler. A
		 * generator that ever repeats itself makes that instruction useless.
		 */
		const indices = new Set<number>();
		for (let i = 0; i < 50; i++) indices.add(allocatePluginFunctionIndex());
		expect(indices.size).toBe(50);
	});

	test("the indices are non-negative integers, which is what emitIndex can encode", () => {
		// The index is written into the bytecode stream by `emitIndex`, so a
		// negative or fractional value would corrupt the program rather than
		// fail at the point of allocation.
		for (let i = 0; i < 5; i++) {
			const index = allocatePluginFunctionIndex();
			expect(Number.isInteger(index)).toBe(true);
			expect(index).toBeGreaterThanOrEqual(0);
		}
	});

	test("two packages that allocate keep their own handlers", () => {
		/*
		 * The end-to-end version of the same claim. Both packages allocate,
		 * both register on one engine, and each keyword must still reach the
		 * handler it was declared with.
		 */
		const engine = newTrackedEngine("en");
		engine.registerPackage(packageAround("firsthandler", () => numberValue(11)));
		engine.registerPackage(packageAround("secondhandler", () => numberValue(22)));

		expect(engine.evaluateExpression("firsthandler")[0].toNumber()).toBe(11);
		expect(engine.evaluateExpression("secondhandler")[0].toNumber()).toBe(22);
	});
});

describe("the allocation guard from inside a plugin function", () => {
	test("charging outside an evaluation is a no-op, so a host can call the constructors freely", () => {
		/*
		 * The formatter, the tests and any host inspecting a Value all build
		 * Values with no evaluation in flight, and none of that is user input
		 * being executed. If charging threw or accumulated there, a host that
		 * formatted enough results would eventually be refused.
		 */
		expect(() => chargeAllocation(1e12, "imaginary things")).not.toThrow();
		expect(() => checkAllocation(1e12, "imaginary things")).not.toThrow();
		expect(checkedArray<number>(4, "imaginary things")).toHaveLength(4);
	});

	test("a plugin that asks for more than the budget is refused, and the engine survives", () => {
		/*
		 * This is the property the exported guard exists to give a package
		 * author: a request sized from user input is refused BEFORE the
		 * memory is taken, with a recoverable error, rather than aborting the
		 * host process the way an unguarded allocation of this size can.
		 *
		 * The limit is set explicitly rather than relying on the default, so
		 * the test asks for something modest and the assertion is about the
		 * guard rather than about how much memory the machine has.
		 */
		const engine = newTrackedEngine("en", false, { vm: { maxAllocatedElements: 1000 } });
		engine.registerPackage(
			packageAround("greedy", () => {
				const room = checkedArray<number>(5000, "greedy elements");
				return numberValue(room.length);
			}),
		);

		expect(() => engine.evaluateExpression("greedy")).toThrow(/limit/i);

		// Recoverable means the next line still evaluates. A guard that left
		// the engine unusable would be a worse outcome than the allocation.
		expect(engine.evaluateExpression("2 + 2")[0].toNumber()).toBe(4);
	});

	test("a plugin asking for what it can afford is allowed through", () => {
		// The other half: the guard must not refuse ordinary sizes, or every
		// package that allocates anything becomes unusable.
		const engine = newTrackedEngine("en", false, { vm: { maxAllocatedElements: 1000 } });
		engine.registerPackage(
			packageAround("modest", () => numberValue(checkedArray<number>(100, "modest elements").length)),
		);

		expect(engine.evaluateExpression("modest")[0].toNumber()).toBe(100);
	});

	test("checkAllocation refuses without spending, so a later charge still fits", () => {
		/*
		 * The documented difference between the two: `checkAllocation` is for
		 * a site that knows a size in advance and whose result is charged
		 * later, at birth. Billing at both points would halve the ceiling the
		 * host asked for. So a check of 600 against a budget of 1000 must
		 * leave the full 1000 available to charge afterwards.
		 */
		const engine = newTrackedEngine("en", false, { vm: { maxAllocatedElements: 1000 } });
		engine.registerPackage(
			packageAround("checkthenchargea", () => {
				checkAllocation(600, "planned elements");
				chargeAllocation(600, "planned elements");
				chargeAllocation(390, "more elements");
				return numberValue(1);
			}),
		);

		expect(engine.evaluateExpression("checkthenchargea")[0].toNumber()).toBe(1);
	});

	test("charges accumulate across one evaluation, so two affordable asks can still be refused together", () => {
		/*
		 * The tally being a total is what makes the bound compose. Two
		 * requests of 600 are each under a 1000 ceiling and must not both be
		 * granted.
		 */
		const engine = newTrackedEngine("en", false, { vm: { maxAllocatedElements: 1000 } });
		engine.registerPackage(
			packageAround("twice", () => {
				chargeAllocation(600, "first batch");
				chargeAllocation(600, "second batch");
				return numberValue(1);
			}),
		);

		expect(() => engine.evaluateExpression("twice")).toThrow(/limit/i);
	});

	test("the next evaluation starts from zero", () => {
		/*
		 * A per-line budget rather than a per-document one. If the tally
		 * carried over, a long document would run itself out of allowance
		 * partway down and start refusing lines that are individually
		 * trivial.
		 */
		const engine = newTrackedEngine("en", false, { vm: { maxAllocatedElements: 1000 } });
		engine.registerPackage(
			packageAround("spendmost", () => {
				chargeAllocation(900, "elements");
				return numberValue(1);
			}),
		);

		expect(engine.evaluateExpression("spendmost")[0].toNumber()).toBe(1);
		expect(engine.evaluateExpression("spendmost")[0].toNumber()).toBe(1);
		expect(engine.evaluateExpression("spendmost")[0].toNumber()).toBe(1);
	});
});

describe("the vector and range constructors", () => {
	test("a row vector is 1xN and a column vector is Nx1", () => {
		/*
		 * The two differ only in shape, and the shape is what every matrix
		 * operation downstream reads. Swapping them transposes silently: a
		 * dot product still returns a number, and the number is wrong.
		 */
		const row = rowVectorValue([1, 2, 3]);
		const column = colVectorValue([1, 2, 3]);

		expect((row.value as MatrixData).rows).toBe(1);
		expect((row.value as MatrixData).cols).toBe(3);
		expect((column.value as MatrixData).rows).toBe(3);
		expect((column.value as MatrixData).cols).toBe(1);

		expect(row.type).toBe(ValueType.Matrix);
		expect(column.type).toBe(ValueType.Matrix);
	});

	test("both hold their entries in the order they were given", () => {
		// For a single row or a single column, row-major and column-major
		// storage are identical, which is why both can pass the array
		// straight through.
		expect(Array.from((rowVectorValue([4, 5, 6]).value as MatrixData).data)).toEqual([4, 5, 6]);
		expect(Array.from((colVectorValue([4, 5, 6]).value as MatrixData).data)).toEqual([4, 5, 6]);
	});

	test("neither is marked symbolic, since numbers are not expression trees", () => {
		// `hasSymbolic` decides which code path every later operation takes.
		// A plain numeric vector claiming to be symbolic sends arithmetic
		// through the CAS instead of the fast path.
		expect((rowVectorValue([1, 2]).value as MatrixData).hasSymbolic).toBe(false);
		expect((colVectorValue([1, 2]).value as MatrixData).hasSymbolic).toBe(false);
	});

	test("a row vector renders as a list and a column vector as a semicolon stack", () => {
		/*
		 * The rendering is how the two are told apart on screen, and it is
		 * meant to read back as the literal that would produce it: `[1, 2, 3]`
		 * for a row and `[1; 2; 3]` for a column.
		 */
		expect(formatValue(rowVectorValue([1, 2, 3]))).toBe("= [1, 2, 3]");
		expect(formatValue(colVectorValue([1, 2, 3]))).toBe("= [1; 2; 3]");
	});

	test("an empty vector is 1x0 or 0x1 rather than a throw", () => {
		// Reachable from any package folding a collection that turned out
		// empty, so it has to be a shape rather than an error.
		expect((rowVectorValue([]).value as MatrixData).cols).toBe(0);
		expect((colVectorValue([]).value as MatrixData).rows).toBe(0);
	});

	test("a range keeps both bounds, which are documented as inclusive", () => {
		const range = rangeValue(1, 5);
		expect(range.type).toBe(ValueType.Range);
		expect((range.value as RangeData).min).toBe(1);
		expect((range.value as RangeData).max).toBe(5);
	});

	test("a range does not reorder its bounds", () => {
		/*
		 * `5:1` is a descending range and the constructor is not the place
		 * that decides what that means. Normalising here would make a
		 * descending range indistinguishable from an ascending one for every
		 * consumer, including the ones that want to count down.
		 */
		const descending = rangeValue(5, 1);
		expect((descending.value as RangeData).min).toBe(5);
		expect((descending.value as RangeData).max).toBe(1);
	});

	test("a single-point range is legal", () => {
		const point = rangeValue(3, 3);
		expect((point.value as RangeData).min).toBe(3);
		expect((point.value as RangeData).max).toBe(3);
	});

	test("matrixValue keeps the shape it is told, without inferring one", () => {
		// The vector helpers are thin wrappers over this, so the wrapper
		// tests above only mean something if the thing underneath does not
		// second-guess its arguments.
		const m = matrixValue(2, 3, [1, 2, 3, 4, 5, 6]);
		expect((m.value as MatrixData).rows).toBe(2);
		expect((m.value as MatrixData).cols).toBe(3);
	});
});

describe("OpRegistry", () => {
	/*
	 * The legacy custom-opcode path, superseded by CALL_PLUGIN but still
	 * exported through `solve-engine/vm` and still what `createVM()` is
	 * handed. Only one of its six functions had ever been called by a test.
	 * A package written against the old documentation still reaches it, and
	 * a registry that lost handlers or reissued opcodes would corrupt
	 * bytecode rather than fail.
	 */
	const noopHandler = (_vm: unknown, _opcodes: Uint8Array, ip: number) => ip;

	test("a registered handler is findable by its opcode", () => {
		const registry = new OpRegistry();
		const opcode = registry.allocateOpcode();

		registry.register({ opcode, handler: noopHandler as never });

		expect(registry.has(opcode)).toBe(true);
		expect(registry.get(opcode)).toBe(noopHandler);
	});

	test("an unregistered opcode is absent rather than an error", () => {
		// The VM asks before dispatching, so this is the ordinary answer for
		// every built-in opcode, not an exceptional one.
		const registry = new OpRegistry();
		expect(registry.has(201)).toBe(false);
		expect(registry.get(201)).toBeUndefined();
	});

	test("unregister removes the handler, which is what package teardown needs", () => {
		const registry = new OpRegistry();
		const opcode = registry.allocateOpcode();
		registry.register({ opcode, handler: noopHandler as never });

		registry.unregister(opcode);

		expect(registry.has(opcode)).toBe(false);
	});

	test("allocateOpcode never repeats, and starts above the built-in range", () => {
		/*
		 * Built-in opcodes occupy the low numbers and the dynamic pool starts
		 * at 201. An allocator that handed back a built-in number would make
		 * a package's handler shadow an arithmetic instruction, and one that
		 * repeated would make two packages share a handler.
		 */
		const registry = new OpRegistry();
		const allocated = new Set<number>();
		for (let i = 0; i < 20; i++) {
			const opcode = registry.allocateOpcode();
			expect(opcode).toBeGreaterThan(200);
			allocated.add(opcode);
		}
		expect(allocated.size).toBe(20);
	});

	test("exhausting the pool is a named config error, not a silent wrap into a built-in", () => {
		/*
		 * The pool runs from 201 to 254, so it is genuinely exhaustible: 54
		 * allocations. Wrapping or continuing past 254 would hand out a
		 * number that does not fit the single byte an opcode is written as,
		 * which corrupts every program compiled afterwards.
		 */
		const registry = new OpRegistry();
		for (let i = 0; i < 54; i++) registry.allocateOpcode();

		expect(() => registry.allocateOpcode()).toThrow(/exhausted/i);
	});

	test("two registries allocate independently", () => {
		// A registry is an object rather than a singleton, so a host building
		// its own must not be handed the shared one's counter.
		const first = new OpRegistry();
		const second = new OpRegistry();
		expect(first.allocateOpcode()).toBe(second.allocateOpcode());
	});

	test("the shared registry the VM is built with is an OpRegistry", () => {
		expect(sharedOpRegistry).toBeInstanceOf(OpRegistry);
	});
});
