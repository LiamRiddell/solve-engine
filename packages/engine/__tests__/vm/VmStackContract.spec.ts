/**
 * The VM reports a fault instead of answering it with a plausible number.
 *
 * Four paths used to fail soft: a `pop()` on an empty stack returned `0`, a
 * `push()` past `maxStackDepth` dropped the value, `CALL_PLUGIN` on an index
 * nothing was registered at pushed `0`, and `CALL_BUILTIN` on an unknown index
 * popped its arguments and pushed nothing, so the next opcode read a
 * neighbour's operand as its own. Each of those is a package or bytecode fault,
 * never the reader's line, and each now surfaces as a named error. The value
 * of naming them is that a wrong number and a right one look the same on the
 * page; an error does not.
 */

import { describe, expect, test } from "@jest/globals";
import { createVM, executeBytecode } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { createEngineContext } from "@solve-js/engine/EngineContext";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ValueType, numberValue } from "@solve-js/vm/Value";
import { EngineError } from "@solve-js/errors/EngineError";

/** A VM with a small stack and an empty plugin table. */
function vmWithDepth(maxStackDepth: number) {
	return createVM(sharedOpRegistry, maxStackDepth, undefined, undefined, undefined, undefined, undefined, undefined, undefined, createEngineContext());
}

function codeOf(thunk: () => unknown): string | undefined {
	try {
		thunk();
	} catch (e) {
		expect(e).toBeInstanceOf(EngineError);
		return (e as EngineError).code;
	}
	return undefined;
}

describe("the stack contract a package handler sees", () => {
	test("a push past maxStackDepth is refused, not dropped", () => {
		const vm = vmWithDepth(2);
		vm.push(numberValue(1));
		vm.push(numberValue(2));
		expect(codeOf(() => vm.push(numberValue(3)))).toBe("STACK_LIMIT_EXCEEDED");
		// The two that fitted are still there, in order.
		expect(vm.pop().value).toBe(2);
		expect(vm.pop().value).toBe(1);
	});

	test("a pop from an empty stack is refused, not answered with 0", () => {
		const vm = vmWithDepth(8);
		expect(codeOf(() => vm.pop())).toBe("STACK_UNDERFLOW");
	});
});

describe("a call to nothing", () => {
	function run(emit: (b: BytecodeBuilder) => void) {
		const builder = new BytecodeBuilder();
		builder.reset();
		emit(builder);
		builder.emitOpcode(OpCode.HALT);
		return executeBytecode(builder.build(), vmWithDepth(16));
	}

	test("CALL_BUILTIN on an unregistered index leaves an Error on the stack, not a hole", () => {
		const result = run((b) => {
			b.emitOpcode(OpCode.PUSH_NUMBER);
			b.emitNumber(7);
			b.emitOpcode(OpCode.CALL_BUILTIN);
			b.emitIndex(250);
			b.emitIndex(1);
		});
		expect(result.type).toBe("value");
		if (result.type !== "value") return;
		expect(result.value.type).toBe(ValueType.Error);
		expect(result.value.value).toBe("UNKNOWN_BUILTIN_FUNCTION");
		expect(String(result.value.unit)).toContain("250");
	});

	test("CALL_PLUGIN on an unregistered index is an Error, not 0", () => {
		const result = run((b) => {
			b.emitOpcode(OpCode.CALL_PLUGIN);
			b.emitIndex(199);
			b.emitIndex(0);
		});
		expect(result.type).toBe("value");
		if (result.type !== "value") return;
		expect(result.value.type).toBe(ValueType.Error);
		expect(result.value.value).toBe("UNKNOWN_PLUGIN_FUNCTION");
	});
});
