/**
 * The bytecode builder refuses what the opcode stream cannot hold, and counts
 * numeric constants by value rather than by occurrence.
 *
 * `build()` copies the stream into a `Uint8Array`, which keeps the low eight
 * bits of each operand: an index of 300 used to become 44 with no error, and
 * the program read a different constant, plugin function or argument count
 * from the one the parselet emitted. And the 256-entry numeric pool counted
 * occurrences, so a long line repeating one literal was refused long before
 * it held 256 different numbers, while the string pool had always deduplicated.
 */

import { describe, expect, test } from "@jest/globals";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

function codeOf(thunk: () => unknown): string | undefined {
	try {
		thunk();
	} catch (error) {
		expect(error).toBeInstanceOf(EngineError);
		return (error as EngineError).code;
	}
	return undefined;
}

describe("an operand that does not fit a byte", () => {
	test("emitIndex refuses it instead of truncating", () => {
		const builder = new BytecodeBuilder();
		builder.reset();
		expect(codeOf(() => builder.emitIndex(256))).toBe("BYTECODE_OPERAND_OUT_OF_RANGE");
		expect(codeOf(() => builder.emitIndex(-1))).toBe("BYTECODE_OPERAND_OUT_OF_RANGE");
		expect(codeOf(() => builder.emitIndex(1.5))).toBe("BYTECODE_OPERAND_OUT_OF_RANGE");
		expect(codeOf(() => builder.emitIndex(255))).toBeUndefined();
	});

	test("emitByte refuses it too", () => {
		const builder = new BytecodeBuilder();
		builder.reset();
		expect(codeOf(() => builder.emitByte(300))).toBe("BYTECODE_OPERAND_OUT_OF_RANGE");
	});

	test("patchJump refuses a target that does not fit and a position outside the stream", () => {
		const builder = new BytecodeBuilder();
		builder.reset();
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		expect(codeOf(() => builder.patchJump(1, 300))).toBe("BYTECODE_OPERAND_OUT_OF_RANGE");
		expect(codeOf(() => builder.patchJump(7, 0))).toBe("BYTECODE_OPERAND_OUT_OF_RANGE");
		expect(codeOf(() => builder.patchJump(1, 9))).toBeUndefined();
		expect(builder.build().opcodes[1]).toBe(9);
	});
});

describe("numeric constants", () => {
	test("are interned, so a repeated literal takes one slot", () => {
		const builder = new BytecodeBuilder();
		builder.reset();
		for (let i = 0; i < 300; i++) {
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(1);
		}
		const program = builder.build();
		expect(program.numbers.length).toBe(1);
		expect(program.opcodes.length).toBe(600);
	});

	test("keep negative zero apart from zero", () => {
		const builder = new BytecodeBuilder();
		builder.reset();
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(0);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(-0);
		const program = builder.build();
		expect(program.numbers.length).toBe(2);
		expect(Object.is(program.numbers[1], -0)).toBe(true);
	});

	test("a line of three hundred occurrences of one literal now compiles", () => {
		// Six hundred tokens is past the default complexity ceiling, which is a
		// different guard from the one under test, so it is raised for this case.
		const engine = newTrackedEngine({ config: { validation: { maxComplexity: 5000 } } });
		const line = Array.from({ length: 300 }, () => "1").join(" + ");
		expect(engine.evaluateExpression(line).toNumber()).toBe(300);
	});

	test("a line of more than 256 distinct literals is still refused by name", () => {
		const engine = newTrackedEngine({ config: { validation: { maxComplexity: 5000 } } });
		const line = Array.from({ length: 260 }, (_, i) => String(i + 1)).join(" + ");
		expect(codeOf(() => engine.evaluateExpression(line))).toBe("TOO_MANY_NUMERIC_CONSTANTS");
	});
});
