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

/**
 * A body that throws leaves the shared stack as it found it.
 *
 * What was wrong: a user function's body runs through a reentrant
 * `executeBytecode()` on the same stack, and when it threw (an undefined name,
 * say) every operand it had pushed stayed behind. `plot` samples a body
 * sixty-four times, so a body that pushed two values before its throw leaked
 * a hundred and twenty-eight, crossed the default depth of 200, and the depth
 * guard then reported an undefined function as STACK_LIMIT_EXCEEDED.
 *
 * What is pinned: after an error result the stack is at its entry depth, an
 * operand the caller pushed before the call is still there, and a body that
 * faults sixty-four times in a row never reaches the depth guard.
 */
describe("a failed reentrant body leaves no operands behind", () => {
	/** A body that pushes three numbers and then reads a name nothing defines. */
	function leakyBody() {
		const body = new BytecodeBuilder();
		body.reset();
		for (let i = 0; i < 3; i++) {
			body.emitOpcode(OpCode.PUSH_NUMBER);
			body.emitNumber(i);
		}
		body.emitOpcode(OpCode.LOAD_VAR);
		body.emitString("nothing_defines_this");
		body.emitOpcode(OpCode.HALT);
		return body.build();
	}

	/** `f(1)` against a VM where `f` is {@link leakyBody}. */
	function callProgram() {
		const main = new BytecodeBuilder();
		main.reset();
		main.emitOpcode(OpCode.PUSH_NUMBER);
		main.emitNumber(1);
		main.emitOpcode(OpCode.CALL_USER_FUNCTION);
		main.emitString("f");
		main.emitByte(1);
		main.emitOpcode(OpCode.HALT);
		return main.build();
	}

	test("the stack is back at its entry depth after the error result", () => {
		const vm = vmWithDepth(200);
		vm.defineUserFunction("f", ["x"], leakyBody());
		const result = executeBytecode(callProgram(), vm);
		expect(result.type).toBe("error");
		if (result.type !== "error") return;
		expect(result.error.code).toBe("UNDEFINED_VARIABLE");
		expect(vm.getStack().length).toBe(0);
	});

	test("an operand the caller pushed before the call is untouched", () => {
		const vm = vmWithDepth(200);
		vm.defineUserFunction("f", ["x"], leakyBody());
		vm.push(numberValue(42));
		const result = executeBytecode(callProgram(), vm);
		expect(result.type).toBe("error");
		expect(vm.getStack().length).toBe(1);
		expect(vm.pop().value).toBe(42);
	});

	test("sixty-four failed calls in a row never reach the depth guard", () => {
		// The shape `plot` produces: the same failing body, over and over, on
		// one stack. With the leak this crossed a depth of 200 by the second
		// dozen and reported STACK_LIMIT_EXCEEDED for an undefined name.
		const vm = vmWithDepth(200);
		vm.defineUserFunction("f", ["x"], leakyBody());
		const program = callProgram();
		for (let i = 0; i < 64; i++) {
			const result = executeBytecode(program, vm);
			expect(result.type).toBe("error");
			if (result.type === "error") expect(result.error.code).toBe("UNDEFINED_VARIABLE");
		}
		expect(vm.getStack().length).toBe(0);
	});
});
