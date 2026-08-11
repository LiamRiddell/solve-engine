/**
 * Malformed and mutated opcode streams for `executeBytecode()`.
 *
 * This is a real attack surface rather than a thought experiment. The `./vm`
 * subpath is a public export of the package, so `executeBytecode` is something
 * a third party calls directly, with a `Bytecode` object they built themselves.
 * Nothing between them and the dispatch loop validates that object: not the
 * lexer, not the parser, not the safety gate. Whatever they hand over is what
 * the VM runs.
 *
 * Two generators, because they find different things. Random streams find the
 * cases nobody wrote a handler for: an opcode with no case arm, an operand
 * indexing past a table, a program that ends mid-instruction. Mutating a real
 * compiled program finds the cases that are almost right: a stream whose first
 * forty instructions set up exactly the state a later instruction needs, with
 * one byte changed. Pure randomness essentially never reaches those, because
 * the odds of randomly building a valid matrix and then indexing it are nil.
 *
 * @module BytecodeFuzzer
 */

import { OpCode } from "@solve-js/parser/OpCode";
import { OPERAND_BYTES } from "@solve-js/parser/OperandWidth";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { Prng } from "@tools/fuzz/Prng";
import type { BytecodeCase, SerializedBody, SerializedProgram } from "@tools/fuzz/FuzzCase";

/**
 * Every opcode the VM declares, read from the enum rather than listed.
 *
 * A numeric TypeScript enum is bidirectional at run time, so the numeric-valued
 * entries are the opcodes and the string-valued ones are the reverse lookup.
 * Filtering on that is what keeps this current when an opcode is added.
 */
const ALL_OPCODES: readonly number[] = Object.values(OpCode).filter(
	(value): value is number => typeof value === "number",
);

/**
 * Opcode values with no case arm in the dispatch switch.
 *
 * The enum's bands leave gaps (there is no opcode 4 through 9, no 100 through
 * 109), and a byte landing in one of them falls through the switch to no arm at
 * all. That is the correct behaviour and it is worth generating deliberately
 * rather than waiting for chance to find it, since a random byte lands on a
 * declared opcode about a third of the time.
 */
const UNDECLARED_OPCODES: readonly number[] = (() => {
	const declared = new Set(ALL_OPCODES);
	const gaps: number[] = [];
	for (let value = 0; value < 256; value++) if (!declared.has(value)) gaps.push(value);
	return gaps;
})();

/** Strings chosen to be wrong for whatever a string-table operand is used as. */
const HOSTILE_STRINGS: readonly string[] = [
	"", " ", "0", "-1", "1e999", "not a bigint", "NaN", "Infinity",
	"9".repeat(400), "\u0000", "__proto__", "constructor", "prototype",
	"toString", "valueOf", "hasOwnProperty",
	// A BigInt literal operand is passed to `BigInt()`, which throws a
	// SyntaxError on anything it cannot read. That throw is caught and
	// relabelled, so it is worth reaching on purpose.
	"0x", "0b", "1.5", "1_000", "٣",
];

/** How a case was produced, recorded so the report can say which generator found what. */
export type BytecodeStrategy =
	| "random-bytes"
	| "structured"
	| "truncated"
	| "short-tables"
	| "stack-abuse"
	| "nested-bodies"
	| "valid-prefix-garbage"
	| "mutation";

/** Knobs the two run modes differ on. */
export interface BytecodeFuzzOptions {
	/** Longest opcode stream to generate. Long streams are slow and rarely more informative than short ones. */
	maxOpcodes?: number;
	/** Largest constant tables to generate. */
	maxTableSize?: number;
	/** Compiled programs to mutate. Empty disables the mutation strategy. */
	mutationPool?: readonly SerializedProgram[];
	/** The expressions `mutationPool` was compiled from, recorded on the case for readability. */
	mutationOrigins?: readonly string[];
}

/** A random constant pool of numbers, biased towards the values that break arithmetic. */
function numberTable(rng: Prng, size: number): string[] {
	const table: string[] = [];
	for (let i = 0; i < size; i++) table.push(String(rng.awkwardNumber()));
	return table;
}

/** A random constant pool of strings. */
function stringTable(rng: Prng, size: number): string[] {
	const table: string[] = [];
	for (let i = 0; i < size; i++) {
		table.push(rng.chance(0.6) ? rng.pick(HOSTILE_STRINGS) : `v${rng.int(1000)}`);
	}
	return table;
}

/** An opcode byte, weighted so the undeclared gaps get reached deliberately. */
function anyOpcode(rng: Prng): number {
	if (rng.chance(0.15) && UNDECLARED_OPCODES.length > 0) return rng.pick(UNDECLARED_OPCODES);
	return rng.pick(ALL_OPCODES);
}

/**
 * An operand byte, weighted towards the values that index past a table.
 *
 * A uniform byte is in range for a table of size 200 four fifths of the time,
 * so a uniform generator spends most of its budget on the case that works.
 */
function operandByte(rng: Prng, tableSize: number): number {
	switch (rng.int(5)) {
		case 0: return 0;
		case 1: return 255;
		case 2: return tableSize;
		case 3: return rng.int(256);
		default: return tableSize > 0 ? rng.int(tableSize) : rng.int(256);
	}
}

/** A fully random byte stream, with no regard for instruction boundaries. */
function randomBytes(rng: Prng, options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>): SerializedProgram {
	const length = rng.range(1, options.maxOpcodes);
	const opcodes: number[] = [];
	for (let i = 0; i < length; i++) opcodes.push(rng.int(256));
	return {
		opcodes,
		numbers: numberTable(rng, rng.int(options.maxTableSize)),
		strings: stringTable(rng, rng.int(options.maxTableSize)),
	};
}

/**
 * A stream that respects instruction boundaries, with operands that may not.
 *
 * Widths come from `parser/OperandWidth.ts`'s table, the same one the engine's
 * own preflight scanners walk with, so an opcode gaining an operand is
 * generated correctly here without an edit. Emitting the right number of
 * operand bytes is what gets a case past the first few instructions, which is
 * where anything interesting happens.
 */
function structured(
	rng: Prng,
	options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>,
	bodies?: { userFunctionBodies: SerializedBody[]; anonymousBodies: SerializedBody[] },
): SerializedProgram {
	const numbers = numberTable(rng, rng.range(1, options.maxTableSize));
	const strings = stringTable(rng, rng.range(1, options.maxTableSize));
	const opcodes: number[] = [];
	const instructions = rng.range(1, Math.max(1, Math.floor(options.maxOpcodes / 3)));

	for (let i = 0; i < instructions; i++) {
		const op = anyOpcode(rng);
		opcodes.push(op);
		const width = OPERAND_BYTES[op] ?? 0;
		for (let byte = 0; byte < width; byte++) {
			// Which table an operand indexes depends on the opcode, and getting
			// that wrong is itself a case worth generating, so the size hint is
			// chosen loosely rather than per opcode.
			const table = rng.chance(0.5) ? numbers.length : strings.length;
			opcodes.push(operandByte(rng, table));
		}
	}
	// Most valid programs end in HALT, and reaching the fallback return instead
	// is a different path, so both are generated.
	if (rng.chance(0.5)) opcodes.push(OpCode.HALT);

	return {
		opcodes,
		numbers,
		strings,
		userFunctionBodies: bodies?.userFunctionBodies,
		anonymousBodies: bodies?.anonymousBodies,
	};
}

/** A structured stream cut off, usually part way through an instruction's operands. */
function truncated(rng: Prng, options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>): SerializedProgram {
	const program = structured(rng, options);
	const cut = rng.range(1, Math.max(1, program.opcodes.length));
	return { ...program, opcodes: program.opcodes.slice(0, cut) };
}

/** A stream whose operands are all in range for tables that are then emptied. */
function shortTables(rng: Prng, options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>): SerializedProgram {
	const program = structured(rng, options);
	return {
		...program,
		numbers: program.numbers.slice(0, rng.int(2)),
		strings: program.strings.slice(0, rng.int(2)),
	};
}

/** A stream that pushes far more than it pops, or pops far more than it pushes. */
function stackAbuse(rng: Prng, options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>): SerializedProgram {
	const numbers = numberTable(rng, 4);
	const strings = stringTable(rng, 4);
	const opcodes: number[] = [];
	const count = rng.range(1, options.maxOpcodes);
	const pushHeavy = rng.chance(0.5);

	for (let i = 0; i < count; i++) {
		if (pushHeavy) {
			opcodes.push(rng.pick([OpCode.PUSH_NUMBER, OpCode.DUP, OpCode.PUSH_STRING, OpCode.PUSH_BOOLEAN]));
			const op = opcodes[opcodes.length - 1];
			if ((OPERAND_BYTES[op] ?? 0) > 0) opcodes.push(rng.int(4));
		} else {
			opcodes.push(rng.pick([OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.SWAP, OpCode.NEG, OpCode.EQ]));
		}
	}
	opcodes.push(OpCode.HALT);
	return { opcodes, numbers, strings };
}

/**
 * A body side-table entry, sometimes containing another one.
 *
 * The nesting is bounded because `executeBytecode()` re-enters itself for a
 * body, and an unbounded generator here would only ever find the native stack
 * limit, which the engine already guards with `maxFunctionRecursionDepth`. The
 * interesting cases are shallow: a body whose parameter list does not match its
 * caller's argument count, a body indexing a side table its parent does not
 * have.
 */
function randomBody(rng: Prng, options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>, depth: number): SerializedBody {
	const params: string[] = [];
	const count = rng.int(4);
	for (let i = 0; i < count; i++) params.push(`p${rng.int(5)}`);
	const nested = depth > 0 && rng.chance(0.4)
		? { userFunctionBodies: [randomBody(rng, options, depth - 1)], anonymousBodies: [randomBody(rng, options, depth - 1)] }
		: undefined;
	return {
		name: rng.chance(0.5) ? `f${rng.int(5)}` : undefined,
		params,
		program: structured(rng, { maxOpcodes: 24, maxTableSize: options.maxTableSize }, nested),
	};
}

/** A program with populated side tables, reaching the reentrant opcodes. */
function nestedBodies(rng: Prng, options: Required<Pick<BytecodeFuzzOptions, "maxOpcodes" | "maxTableSize">>): SerializedProgram {
	const userFunctionBodies: SerializedBody[] = [];
	const anonymousBodies: SerializedBody[] = [];
	const userCount = rng.range(1, 3);
	const anonCount = rng.range(1, 3);
	for (let i = 0; i < userCount; i++) userFunctionBodies.push(randomBody(rng, options, 2));
	for (let i = 0; i < anonCount; i++) anonymousBodies.push(randomBody(rng, options, 2));

	// Opcodes that index the side tables, emitted explicitly so the generated
	// stream actually reaches them rather than waiting for chance.
	const opcodes: number[] = [];
	const numbers = numberTable(rng, 4);
	const strings = stringTable(rng, 4);
	const emitters = [
		() => opcodes.push(OpCode.DEFINE_USER_FUNCTION, operandByte(rng, userFunctionBodies.length)),
		() => opcodes.push(OpCode.CALL_USER_FUNCTION, operandByte(rng, strings.length), rng.int(4)),
		() => opcodes.push(OpCode.MAP_INVOKE, rng.int(3), operandByte(rng, anonymousBodies.length), rng.int(3)),
		() => opcodes.push(OpCode.REDUCE_INVOKE, rng.int(3), operandByte(rng, anonymousBodies.length), rng.int(3)),
		() => opcodes.push(OpCode.BIND_UNKNOWN, operandByte(rng, anonymousBodies.length)),
		() => opcodes.push(OpCode.PUSH_NUMBER, operandByte(rng, numbers.length)),
		() => opcodes.push(OpCode.RANGE_NEW),
		() => opcodes.push(OpCode.MAT_NEW, rng.int(8), rng.int(8)),
	];
	const steps = rng.range(2, 12);
	for (let i = 0; i < steps; i++) rng.pick(emitters)();
	opcodes.push(OpCode.HALT);

	return { opcodes, numbers, strings, userFunctionBodies, anonymousBodies };
}

/** Offsets of the instruction starts in a stream, walked with the engine's own width table. */
function instructionOffsets(opcodes: readonly number[]): number[] {
	const offsets: number[] = [];
	let index = 0;
	while (index < opcodes.length) {
		offsets.push(index);
		index += 1 + (OPERAND_BYTES[opcodes[index] & 0xff] ?? 0);
	}
	return offsets;
}

/**
 * Apply one mutation to a copy of a real compiled program.
 *
 * Each arm is a distinct hypothesis about how a program could be wrong: a bit
 * flipped in transit, a stream cut short, an instruction repeated, two
 * instructions swapped, a constant pool that no longer matches the code that
 * indexes it.
 */
function mutateOnce(rng: Prng, program: SerializedProgram): SerializedProgram {
	const opcodes = program.opcodes.slice();
	const numbers = program.numbers.slice();
	const strings = program.strings.slice();
	const offsets = instructionOffsets(opcodes);

	switch (rng.int(11)) {
		case 0: {
			// One bit, which is what a corrupted transfer actually looks like.
			if (opcodes.length === 0) break;
			const at = rng.int(opcodes.length);
			opcodes[at] ^= 1 << rng.int(8);
			break;
		}
		case 1: {
			if (opcodes.length === 0) break;
			opcodes[rng.int(opcodes.length)] = rng.int(256);
			break;
		}
		case 2: {
			// Cut, usually leaving a dangling operand.
			const cut = rng.int(Math.max(1, opcodes.length));
			opcodes.length = cut;
			break;
		}
		case 3: {
			// Repeat one whole instruction, operands included.
			if (offsets.length === 0) break;
			const which = rng.int(offsets.length);
			const start = offsets[which];
			const end = which + 1 < offsets.length ? offsets[which + 1] : opcodes.length;
			opcodes.splice(rng.int(opcodes.length + 1), 0, ...opcodes.slice(start, end));
			break;
		}
		case 4: {
			// Swap two instructions, which breaks the stack discipline the
			// compiler guarantees without breaking the stream's framing.
			if (offsets.length < 2) break;
			const a = rng.int(offsets.length);
			const b = rng.int(offsets.length);
			if (a === b) break;
			const slice = (index: number): number[] => {
				const start = offsets[index];
				const end = index + 1 < offsets.length ? offsets[index + 1] : opcodes.length;
				return opcodes.slice(start, end);
			};
			const first = Math.min(a, b);
			const second = Math.max(a, b);
			const firstSlice = slice(first);
			const secondSlice = slice(second);
			const secondStart = offsets[second];
			const secondEnd = second + 1 < offsets.length ? offsets[second + 1] : opcodes.length;
			opcodes.splice(secondStart, secondEnd - secondStart, ...firstSlice);
			const firstEnd = first + 1 < offsets.length ? offsets[first + 1] : opcodes.length;
			opcodes.splice(offsets[first], firstEnd - offsets[first], ...secondSlice);
			break;
		}
		case 5: {
			// Delete one instruction.
			if (offsets.length === 0) break;
			const which = rng.int(offsets.length);
			const start = offsets[which];
			const end = which + 1 < offsets.length ? offsets[which + 1] : opcodes.length;
			opcodes.splice(start, end - start);
			break;
		}
		case 6: {
			// Insert a well-framed instruction at an instruction boundary.
			const op = anyOpcode(rng);
			const inserted = [op];
			for (let byte = 0; byte < (OPERAND_BYTES[op] ?? 0); byte++) inserted.push(rng.int(256));
			const at = offsets.length > 0 ? rng.pick(offsets) : 0;
			opcodes.splice(at, 0, ...inserted);
			break;
		}
		case 7: {
			// Shrink a constant pool the code still indexes.
			if (rng.chance(0.5)) numbers.length = rng.int(numbers.length + 1);
			else strings.length = rng.int(strings.length + 1);
			break;
		}
		case 8: {
			if (strings.length === 0) break;
			strings[rng.int(strings.length)] = rng.pick(HOSTILE_STRINGS);
			break;
		}
		case 9: {
			if (numbers.length === 0) break;
			numbers[rng.int(numbers.length)] = String(rng.awkwardNumber());
			break;
		}
		default: {
			// Valid prefix, then garbage. The prefix does real work first, so
			// the garbage runs against a populated stack rather than an empty one.
			const keep = offsets.length > 0 ? rng.pick(offsets) : 0;
			opcodes.length = keep;
			const tail = rng.range(1, 16);
			for (let i = 0; i < tail; i++) opcodes.push(rng.int(256));
			break;
		}
	}

	return {
		opcodes,
		numbers,
		strings,
		// The side tables travel with the program, and dropping one while the
		// code still indexes it is its own case.
		userFunctionBodies: rng.chance(0.9) ? program.userFunctionBodies : undefined,
		anonymousBodies: rng.chance(0.9) ? program.anonymousBodies : undefined,
	};
}

/**
 * One generated bytecode case.
 *
 * @param seed - The seed. Same seed and same `options`, same case, forever.
 *
 * The `options` qualifier is load-bearing and is why a corpus entry stores the
 * concrete input rather than only its seed. Half of what this generates is a
 * mutation of a program in `mutationPool`, and that pool is compiled from
 * expressions the expression generator produced, so a change to THAT generator
 * changes what every bytecode seed means. Storing the input makes a recorded
 * finding survive both generators changing underneath it; the seed stays for
 * provenance and for re-running the neighbourhood it came from.
 *
 * @param options - Size bounds and the mutation pool.
 * @returns The case, ready to run.
 */
export function generateBytecodeCase(seed: number, options: BytecodeFuzzOptions = {}): BytecodeCase {
	const rng = new Prng(seed);
	const bounded = {
		maxOpcodes: options.maxOpcodes ?? 120,
		maxTableSize: options.maxTableSize ?? 8,
	};
	const pool = options.mutationPool ?? [];

	// Half the budget goes to mutation when there is a pool to mutate, because
	// that half finds the deeper bugs. With no pool the weights collapse onto
	// the generated strategies, which is what the Jest run does to stay fast.
	const strategies: BytecodeStrategy[] = pool.length > 0
		? ["mutation", "mutation", "mutation", "random-bytes", "structured", "structured", "truncated", "short-tables", "stack-abuse", "nested-bodies"]
		: ["random-bytes", "structured", "structured", "truncated", "short-tables", "stack-abuse", "nested-bodies"];

	const strategy = rng.pick(strategies);
	switch (strategy) {
		case "mutation": {
			const which = rng.int(pool.length);
			let program = pool[which];
			const rounds = rng.range(1, 4);
			for (let i = 0; i < rounds; i++) program = mutateOnce(rng, program);
			return { kind: "bytecode", program, origin: options.mutationOrigins?.[which] };
		}
		case "random-bytes": return { kind: "bytecode", program: randomBytes(rng, bounded) };
		case "truncated": return { kind: "bytecode", program: truncated(rng, bounded) };
		case "short-tables": return { kind: "bytecode", program: shortTables(rng, bounded) };
		case "stack-abuse": return { kind: "bytecode", program: stackAbuse(rng, bounded) };
		case "nested-bodies": return { kind: "bytecode", program: nestedBodies(rng, bounded) };
		default: return { kind: "bytecode", program: structured(rng, bounded) };
	}
}

/** Flatten a compiled program's side table into its storable form. */
function storeBody(body: { name?: string; params: string[]; program: BytecodeProgram }): SerializedBody {
	return { name: body.name, params: body.params.slice(), program: storeProgram(body.program) };
}

/**
 * Turn a compiled program into the storable form the fuzzer works with.
 *
 * @param program - What `ExpressionEngine.compileExpression()` produced.
 * @returns The same program as plain JSON.
 */
export function storeProgram(program: BytecodeProgram): SerializedProgram {
	return {
		opcodes: Array.from(program.opcodes),
		numbers: Array.from(program.numbers, String),
		strings: program.strings.slice(),
		userFunctionBodies: program.userFunctionBodies?.map(storeBody),
		anonymousBodies: program.anonymousBodies?.map(storeBody),
	};
}

/** Real compiled programs, with the sources they came from. */
export interface MutationPool {
	programs: SerializedProgram[];
	origins: string[];
}

/**
 * Expression shapes that must be in the mutation pool.
 *
 * The generated seed expressions cover the grammar broadly, but a few opcodes
 * are only reachable through a specific shape and a random walk finds them
 * rarely enough that a run could contain none. Those opcodes are the ones with
 * the most machinery behind them, so they are named here to guarantee at least
 * one real program of each shape exists to mutate. This is the only hard-coded
 * expression list in the fuzzer, and it exists to raise a floor rather than to
 * define the vocabulary.
 */
const SHAPE_ANCHORS: readonly string[] = [
	"1 + 2 * 3",
	"[1,2;3,4] * [5,6;7,8]",
	"[1,2,3][0]",
	"[1,2;3,4][0:1, 0:1]",
	"map(10*x, 0:20)",
	"reduce(acc+x, [1,2,3])",
	"f(x) = 2*x + 1",
	"100 cm to m",
	"5 USD to EUR",
	"25% of 80",
	"now + 3 days",
	"if 1 < 2 then 3 else 4",
	"der(x^2, x)",
	"x^2 - 4 = 0",
	"sqrt(16) + max(1,2,3)",
	"255 as hex",
	"12345678901234567890n * 2n",
	"4d6",
	"$99/week",
	":a = 5",
];

/**
 * Compile real programs to mutate.
 *
 * Anything that does not compile is skipped rather than reported: a generated
 * expression failing to parse is the expression fuzzer's business, not this
 * one's.
 *
 * @param engine - The engine to compile with.
 * @param sources - Generated expressions, from `generateSeedExpressions()`.
 * @returns The pool, anchors first so a small pool still covers the shapes.
 */
export function buildMutationPool(engine: ExpressionEngine, sources: readonly string[]): MutationPool {
	const programs: SerializedProgram[] = [];
	const origins: string[] = [];
	for (const source of [...SHAPE_ANCHORS, ...sources]) {
		try {
			const { program } = engine.compileExpression(source);
			if (program.opcodes.length === 0) continue;
			programs.push(storeProgram(program));
			origins.push(source);
		} catch {
			// Not compilable. Nothing to mutate, and nothing to report here.
		}
	}
	return { programs, origins };
}
