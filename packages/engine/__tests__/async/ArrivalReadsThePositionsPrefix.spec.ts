/**
 * A re-run line reads the state its own position has, not the document's end.
 *
 * When a value arrives, the batcher re-executes a few lines out of the middle
 * of a document against the engine's VM. That VM holds whatever the last full
 * pass left in it, which is the state at the END of the document, and that is
 * the right answer only for a name written once. A name written twice has a
 * value per position:
 *
 * ```
 * :x = <fetched>   the value arrives here
 * x + 100          reads the fetched value
 * :x = 99          redefines it
 * x + 200          reads 99, because this line sits below the redefinition
 * ```
 *
 * The last line answered `207` for a fetched `7`: the arriving value had leaked
 * past the redefinition, because the line that redefines `x` was not itself
 * affected and so was not re-run.
 *
 * The batch now runs as a sweep through the document. The VM is restored to the
 * state just before the earliest affected line, and each writing line passed on
 * the way has its recorded bindings applied, so a line running at position N
 * sees the prefix position N actually has. A line that writes updates its own
 * checkpoint in place rather than taking a new one, since taking one drops the
 * chain after it and the sweep is about to walk through exactly those entries.
 *
 * Without a chain the batcher behaves as it did, which is what a host driving
 * it directly gets.
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
import { VMCheckpointer } from "@solve-js/vm/VMCheckpoints";

/** `<value>` stored into `name`. */
function store(value: number, name: string) {
	const b = new BytecodeBuilder();
	b.reset();
	b.emitOpcode(OpCode.PUSH_NUMBER);
	b.emitNumber(value);
	b.emitOpcode(OpCode.STORE_VAR);
	b.emitString(name);
	b.emitOpcode(OpCode.HALT);
	return b.build();
}

/** `name + addend`. */
function readPlus(name: string, addend: number) {
	const b = new BytecodeBuilder();
	b.reset();
	b.emitOpcode(OpCode.LOAD_VAR);
	b.emitString(name);
	b.emitOpcode(OpCode.PUSH_NUMBER);
	b.emitNumber(addend);
	b.emitOpcode(OpCode.ADD);
	b.emitOpcode(OpCode.HALT);
	return b.build();
}

/**
 * The document above, with `x` fetched as 7 on line 1 and redefined as 99 on
 * line 3, and the chain a full pass would have left behind.
 */
function twiceDefined(withChain: boolean) {
	const dag = new DependencyGraph();
	const lineCache = new LineCache();
	const vm = createVM(sharedOpRegistry, 200, 50_000);
	const batcher = new AsyncResolutionBatcher(dag, lineCache, vm);
	const updated: number[] = [];
	batcher.onLineResult = (lineNumber) => { updated.push(lineNumber); };

	dag.registerLine(1, [], ["x"]);
	dag.registerLineDataSourceDependency(1, "src", ["k"]);
	dag.registerLine(2, ["x"], []);
	dag.registerLine(3, [], ["x"]);
	dag.registerLine(4, ["x"], []);
	lineCache.set(1, new LineCacheEntry(numberValue(0), store(7, "x"), [], "x"));
	lineCache.set(2, new LineCacheEntry(numberValue(0), readPlus("x", 100), ["x"], null));
	lineCache.set(3, new LineCacheEntry(numberValue(0), store(99, "x"), [], "x"));
	lineCache.set(4, new LineCacheEntry(numberValue(0), readPlus("x", 200), ["x"], null));

	// What a full pass leaves: line 1 defined x, line 3 redefined it, and the
	// VM ends holding line 3's value.
	const checkpointer = new VMCheckpointer(vm);
	vm.setVar("x", numberValue(5));
	checkpointer.snapshot(1, 1, ["x"]);
	vm.setVar("x", numberValue(99));
	checkpointer.snapshot(3, 3, ["x"]);
	if (withChain) batcher.checkpointer = checkpointer;

	return { batcher, lineCache, updated, checkpointer };
}

const arrive = (batcher: AsyncResolutionBatcher) =>
	batcher.add({ queryKey: "k", packageId: "src", signal: new AbortController().signal, isError: false });
const settle = async () => {
	await new Promise<void>((r) => queueMicrotask(r));
	await new Promise<void>((r) => queueMicrotask(r));
};
const resultOf = (lineCache: LineCache, line: number) => lineCache.getEntryForLine(line)?.result?.toNumber();

describe("a name defined twice, with a value arriving on the first", () => {
	test("a line below the redefinition reads the redefinition", async () => {
		const { batcher, lineCache, updated } = twiceDefined(true);
		arrive(batcher);
		await settle();

		// Line 3 is not affected and is not re-run; its value is applied as the
		// sweep passes it.
		expect(updated).toEqual([1, 2, 4]);
		expect(resultOf(lineCache, 1)).toBe(7);
		expect(resultOf(lineCache, 2)).toBe(107);
		expect(resultOf(lineCache, 4)).toBe(299);
	});

	test("the arriving value reaches the line above the redefinition", async () => {
		// The other half: sweeping must not lose the value that just arrived.
		const { batcher, lineCache } = twiceDefined(true);
		arrive(batcher);
		await settle();
		expect(resultOf(lineCache, 2)).toBe(107);
	});

	test("without a chain the batcher behaves as it did", async () => {
		// A host driving the batcher directly supplies no checkpointer, and gets
		// exactly the previous behaviour rather than a half-applied sweep.
		const { batcher, lineCache } = twiceDefined(false);
		arrive(batcher);
		await settle();
		expect(resultOf(lineCache, 2)).toBe(107);
		expect(resultOf(lineCache, 4)).toBe(207);
	});

	test("the chain carries the arrived value for the next batch", async () => {
		// A re-run that writes updates its own checkpoint, so a second arrival
		// sweeps through the new value rather than the one from the last pass.
		const { batcher, lineCache, checkpointer } = twiceDefined(true);
		arrive(batcher);
		await settle();

		expect(checkpointer.getCheckpointAt(1)?.variables.x?.toNumber()).toBe(7);
		// And the entry for the redefinition is untouched, so the sweep can
		// still find it.
		expect(checkpointer.getCheckpointAt(3)?.variables.x?.toNumber()).toBe(99);

		arrive(batcher);
		await settle();
		expect(resultOf(lineCache, 2)).toBe(107);
		expect(resultOf(lineCache, 4)).toBe(299);
	});
});
