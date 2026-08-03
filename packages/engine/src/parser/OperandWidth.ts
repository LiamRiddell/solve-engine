/**
 * How many operand bytes follow each opcode, and how to step over one.
 *
 * Anything walking a bytecode stream without executing it needs this: the
 * resolver preflight scanners look for specific opcodes and must skip past
 * everything else without mistaking an operand byte for an instruction.
 *
 * It used to be a hand-copied switch in each of those scanners. They had
 * already drifted: two counted `CALL_PLUGIN` as three bytes wide and the third
 * omitted it from that arm, so a stream containing one desynchronised there and
 * every opcode after it was read at the wrong offset. Adding an opcode meant
 * remembering every copy, and nothing checked that you had.
 *
 * `__tests__/parser/OperandWidth.spec.ts` asserts every opcode has a width, so
 * a new one fails a test rather than silently defaulting to zero operands.
 */

import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Opcodes taking one operand byte.
 *
 * A constant-pool index, or a variable-name index.
 */
const ONE_OPERAND: readonly OpCode[] = [
	OpCode.PUSH_NUMBER,
	OpCode.PUSH_BIGINT,
	OpCode.PUSH_HEX,
	OpCode.PUSH_STRING,
	OpCode.PUSH_BOOLEAN,
	OpCode.LOAD_VAR,
	OpCode.STORE_VAR,
	OpCode.LOAD_GLOBAL_VAR,
	OpCode.STORE_GLOBAL_VAR,
	OpCode.DEFINE_USER_FUNCTION,
];

/**
 * Opcodes taking two operand bytes.
 *
 * A callable index plus an argument count, or a matrix's row and column counts.
 */
const TWO_OPERANDS: readonly OpCode[] = [
	OpCode.CALL_PLUGIN,
	OpCode.CALL_BUILTIN,
	OpCode.CALL_USER_FUNCTION,
	OpCode.MAT_NEW,
];

/**
 * Opcodes taking three operand bytes.
 *
 * The map and reduce invocations, which carry a body index alongside their
 * other operands.
 */
const THREE_OPERANDS: readonly OpCode[] = [OpCode.MAP_INVOKE, OpCode.REDUCE_INVOKE];

/**
 * Operand byte count for every opcode, indexed by opcode value.
 *
 * A dense array rather than a map, because the preflight scanners run on every
 * keystroke and this is read once per instruction.
 */
export const OPERAND_BYTES: readonly number[] = (() => {
	const widths = new Array<number>(256).fill(0);
	for (const op of ONE_OPERAND) widths[op] = 1;
	for (const op of TWO_OPERANDS) widths[op] = 2;
	for (const op of THREE_OPERANDS) widths[op] = 3;
	return widths;
})();

/**
 * Every opcode that takes at least one operand.
 *
 * Exported so a test can assert the table stays complete as opcodes are added.
 */
export const OPCODES_WITH_OPERANDS: readonly OpCode[] = [
	...ONE_OPERAND,
	...TWO_OPERANDS,
	...THREE_OPERANDS,
];

/**
 * Offset of the instruction after the one at `index`.
 *
 * @param opcodes - The bytecode stream.
 * @param index - Offset of an opcode, not of an operand byte. Passing an
 * operand offset yields nonsense, which is the failure mode this exists to
 * prevent: a caller stepping by hand and getting one width wrong reads the rest
 * of the stream misaligned.
 * @returns Offset of the next opcode. May be past the end when the instruction
 * at `index` is the last one, so callers loop while it is under `opcodes.length`.
 */
export function nextInstruction(opcodes: Uint8Array, index: number): number {
	return index + 1 + (OPERAND_BYTES[opcodes[index]] ?? 0);
}
