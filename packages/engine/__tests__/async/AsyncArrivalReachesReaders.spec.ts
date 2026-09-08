/**
 * A value arriving reaches the lines that read it, not only the one that asked.
 *
 * When a data source resolves, the batcher re-executes the lines the graph
 * names for that query key. That set is the direct consumers of the key, and it
 * was never expanded, so a line reading a variable the fetching line defines was
 * not in it:
 *
 * ```
 * :rate = 100 USD in EUR     named by the graph, re-run
 * rate * 2                   named by nothing, kept the number from before the fetch
 * ```
 *
 * The set is now closed over the graph: everything that reads what those lines
 * write, and so on, which is the same walk an edit to a variable already gets.
 *
 * The boundary is the VM those lines run against. The batcher deliberately does
 * not reset it, so a re-run reads whatever the last full pass left behind, and
 * for a name written on more than one line that is the last write rather than
 * the one governing the re-run line's position. Reconstructing that prefix needs
 * the checkpointer, which nothing on this path builds yet.
 */
import { describe, expect, test } from "@jest/globals";
import { LineCache, LineCacheEntry } from "@solve-js/cache/LineCache";
import { AsyncResolutionBatcher } from "@solve-js/engine/AsyncResolutionBatcher";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { DependencyGraph } from "@solve-js/vm/DependencyGraph";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { numberValue } from "@solve-js/vm/Value";
import { createVM } from "@solve-js/vm/VM";

/** `<value>`, stored into `writeVar`. */
function storeConstant(value: number, writeVar: string) {
	const builder = new BytecodeBuilder();
	builder.reset();
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(value);
	builder.emitOpcode(OpCode.STORE_VAR);
	builder.emitString(writeVar);
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

/** `readVar * factor`, stored into `writeVar` when one is given. */
function multiply(readVar: string, factor: number, writeVar?: string) {
	const builder = new BytecodeBuilder();
	builder.reset();
	builder.emitOpcode(OpCode.LOAD_VAR);
	builder.emitString(readVar);
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(factor);
	builder.emitOpcode(OpCode.MUL);
	if (writeVar !== undefined) {
		builder.emitOpcode(OpCode.STORE_VAR);
		builder.emitString(writeVar);
	}
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

function harness() {
	const dag = new DependencyGraph();
	const lineCache = new LineCache();
	const vm = createVM(sharedOpRegistry, 200, 50_000);
	const batcher = new AsyncResolutionBatcher(dag, lineCache, vm);
	const updated: number[] = [];
	batcher.onLineResult = (lineNumber) => { updated.push(lineNumber); };

	/** Register a line's edges and its cached program in one go. */
	const line = (
		lineNumber: number,
		reads: string[],
		writes: string[],
		bytecode: ReturnType<typeof storeConstant>,
	) => {
		dag.registerLine(lineNumber, reads, writes);
		lineCache.set(lineNumber, new LineCacheEntry(numberValue(0), bytecode, reads, writes[0] ?? null));
	};

	return { dag, lineCache, vm, batcher, updated, line };
}

const liveSignal = () => new AbortController().signal;
const settle = async () => { await new Promise<void>((r) => queueMicrotask(r)); await new Promise<void>((r) => queueMicrotask(r)); };
const arrive = (batcher: AsyncResolutionBatcher) =>
	batcher.add({ queryKey: "USD:EUR", packageId: "currency", signal: liveSignal(), isError: false });

describe("what a resolved data source re-runs", () => {
	test("a line reading the fetched value is re-run too", async () => {
		const { dag, lineCache, vm, batcher, updated, line } = harness();

		line(1, [], ["rate"], storeConstant(2, "rate"));
		dag.registerLineDataSourceDependency(1, "currency", ["USD:EUR"]);
		line(2, ["rate"], [], multiply("rate", 10));

		vm.setVar("rate", numberValue(1));
		arrive(batcher);
		await settle();

		expect(updated).toContain(1);
		expect(updated).toContain(2);
		expect(lineCache.getEntryForLine(2)?.result?.toNumber()).toBe(20);
	});

	test("and so is a line reading that line's result, to any depth", async () => {
		const { dag, lineCache, vm, batcher, updated, line } = harness();

		line(1, [], ["rate"], storeConstant(2, "rate"));
		dag.registerLineDataSourceDependency(1, "currency", ["USD:EUR"]);
		line(2, ["rate"], ["doubled"], multiply("rate", 2, "doubled"));
		line(3, ["doubled"], [], multiply("doubled", 5));

		vm.setVar("rate", numberValue(1));
		vm.setVar("doubled", numberValue(2));
		arrive(batcher);
		await settle();

		// Producers before consumers, so each reads the value the one above it
		// has just written rather than the one from before the fetch.
		expect(updated).toEqual([1, 2, 3]);
		expect(lineCache.getEntryForLine(2)?.result?.toNumber()).toBe(4);
		expect(lineCache.getEntryForLine(3)?.result?.toNumber()).toBe(20);
	});

	test("a line reading nothing the arrival touches is left alone", async () => {
		const { dag, vm, batcher, updated, line } = harness();

		line(1, [], ["rate"], storeConstant(2, "rate"));
		dag.registerLineDataSourceDependency(1, "currency", ["USD:EUR"]);
		line(2, ["other"], [], multiply("other", 10));

		vm.setVar("rate", numberValue(1));
		vm.setVar("other", numberValue(7));
		arrive(batcher);
		await settle();

		expect(updated).toContain(1);
		expect(updated).not.toContain(2);
	});

	test("a cycle between two readers does not stall the walk", async () => {
		// The expansion is a fixed point over a graph a document can make
		// cyclic, so it has to terminate on one.
		const { dag, vm, batcher, updated, line } = harness();

		line(1, [], ["rate"], storeConstant(2, "rate"));
		dag.registerLineDataSourceDependency(1, "currency", ["USD:EUR"]);
		line(2, ["rate", "b"], ["a"], multiply("rate", 2, "a"));
		line(3, ["a"], ["b"], multiply("a", 2, "b"));

		vm.setVar("rate", numberValue(1));
		vm.setVar("a", numberValue(1));
		vm.setVar("b", numberValue(1));
		arrive(batcher);
		await settle();

		expect(updated).toEqual(expect.arrayContaining([1, 2, 3]));
	});
});
