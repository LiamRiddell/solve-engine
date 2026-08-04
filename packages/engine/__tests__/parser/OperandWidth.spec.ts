import { describe, expect, test } from "@jest/globals";
import { OpCode } from "@solve-js/parser/OpCode";
import {
	OPERAND_BYTES,
	OPCODES_WITH_OPERANDS,
	nextInstruction,
} from "@solve-js/parser/OperandWidth";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";

/**
 * The operand-width table has to stay in step with the opcode set.
 *
 * It replaced three hand-copied switch statements that had already drifted from
 * each other. The value of one table over three is only real if something
 * notices when the table falls behind, which is what these do.
 */
describe("bytecode operand widths", () => {
	/** Every numeric member of the OpCode enum. */
	const allOpcodes = Object.values(OpCode).filter((v): v is OpCode => typeof v === "number");

	test("every opcode has a width, and none is negative", () => {
		for (const op of allOpcodes) {
			const width = OPERAND_BYTES[op];
			expect(typeof width).toBe("number");
			expect(width).toBeGreaterThanOrEqual(0);
			expect(width).toBeLessThanOrEqual(3);
		}
	});

	test("the opcode set has not outgrown the table", () => {
		// A new opcode taking operands defaults to zero here, which desynchronises
		// every scanner walking past it. There is no way to detect that
		// automatically from the enum alone, so this pins the count: adding an
		// opcode fails here, and whoever adds it has to decide its width
		// deliberately rather than inherit zero by accident.
		expect(allOpcodes.length).toBe(75);
	});

	test("opcodes listed as taking operands actually record a non-zero width", () => {
		for (const op of OPCODES_WITH_OPERANDS) {
			expect(OPERAND_BYTES[op]).toBeGreaterThan(0);
		}
	});

	test("nextInstruction walks a real program to exactly its end", () => {
		// Built through the real builder rather than hand-assembled, so the
		// widths are checked against what actually gets emitted.
		const builder = new BytecodeBuilder();
		builder.reset();
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(2);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(3);
		builder.emitOpcode(OpCode.ADD);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(0);
		builder.emitIndex(1);
		builder.emitOpcode(OpCode.HALT);
		const { opcodes } = builder.build();

		const visited: number[] = [];
		let i = 0;
		let guard = 0;
		while (i < opcodes.length && guard++ < 100) {
			visited.push(opcodes[i]);
			i = nextInstruction(opcodes, i);
		}

		// Landing exactly on the end is the whole point. Overshooting or
		// stopping short both mean a width is wrong.
		expect(i).toBe(opcodes.length);
		expect(visited).toEqual([
			OpCode.PUSH_NUMBER,
			OpCode.PUSH_NUMBER,
			OpCode.ADD,
			OpCode.CALL_BUILTIN,
			OpCode.HALT,
		]);
	});

	test("CALL_PLUGIN takes two operands", () => {
		// Named explicitly because this is where the three copies disagreed: two
		// counted it, one did not, so a stream containing one was read
		// misaligned from that point on by whichever scanner had it wrong.
		expect(OPERAND_BYTES[OpCode.CALL_PLUGIN]).toBe(2);
	});
});
