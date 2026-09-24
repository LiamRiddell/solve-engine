/**
 * The scratch VM `explainLine` runs a line in (#566): it reads the document's
 * VM and keeps its own writes, so dropping it discards the run.
 *
 * Pinned directly, as well as through `ExplainingIsReadOnly.spec.ts`, because
 * the engine-level spec only sees what the lines it explains happen to touch.
 * Here every piece of state the VM holds is written through the scratch VM
 * and read back through both.
 */
import { describe, expect, test } from "@jest/globals";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { createScratchVM } from "@solve-js/vm/ScratchVM";
import { createVM } from "@solve-js/vm/VM";
import { numberValue } from "@solve-js/vm/Value";

const program = (marker: number): BytecodeProgram => ({
	opcodes: new Uint8Array(0),
	numbers: new Float64Array([marker]),
	strings: [],
	hasAsync: false,
});

function liveWithState() {
	const live = createVM(sharedOpRegistry, 200, 50_000);
	live.setVar("x", numberValue(3));
	live.setVar("y", numberValue(4));
	live.defineUserFunction("f", ["a"], program(1));
	live.defineEquation("n", ["a"], program(2));
	live.defineScalarEquation("w", program(3), program(4));
	return live;
}

describe("a scratch VM", () => {
	test("reads the live VM's state as it stands", () => {
		const scratch = createScratchVM(liveWithState());
		expect(scratch.getVar("x")?.toNumber()).toBe(3);
		expect(scratch.getUserFunction("f")?.params).toEqual(["a"]);
		expect(scratch.hasEquation("n")).toBe(true);
		expect(scratch.hasScalarEquation("w")).toBe(true);
		expect(scratch.getVariableEntries().map(([name]) => name).sort()).toEqual(["x", "y"]);
	});

	test("keeps its own writes and leaves the live VM untouched", () => {
		const live = liveWithState();
		const scratch = createScratchVM(live);

		scratch.setVar("x", numberValue(30));
		scratch.setVar("z", numberValue(1));
		scratch.deleteVar("y");
		scratch.defineUserFunction("f", ["b"], program(9));
		scratch.defineUserFunction("g", ["t"], program(8));
		scratch.defineEquation("m", ["a"], program(7));
		scratch.defineScalarEquation("v", program(6), program(5));

		expect(scratch.getVar("x")?.toNumber()).toBe(30);
		expect(scratch.getVar("y")).toBeUndefined();
		expect(scratch.getVariableEntries().map(([name, value]) => `${name}=${value.toNumber()}`).sort()).toEqual(["x=30", "z=1"]);
		expect(scratch.getUserFunctionDefs().map(def => `${def.name}(${def.params})`).sort()).toEqual(["f(b)", "g(t)"]);
		expect(scratch.hasEquation("m") && scratch.hasScalarEquation("v")).toBe(true);

		expect(live.getVariableEntries().map(([name, value]) => `${name}=${value.toNumber()}`).sort()).toEqual(["x=3", "y=4"]);
		expect(live.getUserFunctionDefs().map(def => `${def.name}(${def.params})`)).toEqual(["f(a)"]);
		expect(live.hasEquation("m") || live.hasScalarEquation("v")).toBe(false);
	});

	test("a deleted function stops reading through", () => {
		const scratch = createScratchVM(liveWithState());
		scratch.deleteUserFunction("f");
		expect(scratch.hasUserFunction("f")).toBe(false);
		expect(scratch.getUserFunction("f")).toBeUndefined();
		expect(scratch.getUserFunctionDefs()).toEqual([]);
	});

	test("a call frame's binding wins over a variable, as on the live VM", () => {
		const live = liveWithState();
		const scratch = createScratchVM(live);
		scratch.setVar("a", numberValue(1));
		scratch.pushCallFrame(new Map([["a", numberValue(99)]]));
		try {
			expect(scratch.getVar("a")?.toNumber()).toBe(99);
		} finally {
			scratch.popCallFrame();
		}
		expect(scratch.getVar("a")?.toNumber()).toBe(1);
	});

	test("reset() empties the scratch VM without touching the live one", () => {
		const live = liveWithState();
		const scratch = createScratchVM(live);
		scratch.setVar("z", numberValue(1));
		scratch.reset();
		expect(scratch.getVar("x")).toBeUndefined();
		expect(scratch.getVar("z")).toBeUndefined();
		expect(scratch.getVariableEntries()).toEqual([]);
		expect(scratch.hasUserFunction("f") || scratch.hasEquation("n")).toBe(false);
		expect(live.getVar("x")?.toNumber()).toBe(3);
		expect(live.hasUserFunction("f")).toBe(true);
	});

	test("did-you-mean reads the merged names, and gives up past its limit", () => {
		const scratch = createScratchVM(liveWithState());
		scratch.setVar("z", numberValue(1));
		expect([...(scratch.getVariableNames?.(10) ?? [])].sort()).toEqual(["x", "y", "z"]);
		expect(scratch.getVariableNames?.(2)).toBeUndefined();
	});
});
