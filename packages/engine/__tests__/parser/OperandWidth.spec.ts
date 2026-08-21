import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { OpCode, getOpCodeName } from "@solve-js/parser/OpCode";
import {
	OPERAND_BYTES,
	OPCODES_WITH_OPERANDS,
	nextInstruction,
} from "@solve-js/parser/OperandWidth";
import { BytecodeBuilder, type BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * The operand-width table has to stay in step with the opcode set.
 *
 * It replaced three hand-copied switch statements that had already drifted from
 * each other. The value of one table over three is only real if something
 * notices when the table falls behind, which is what these do.
 *
 * The first version of this file only pinned the size of the enum, and that was
 * not enough: `DATE_LITERAL` was already in the enum when the table was written
 * and was simply left out of it, so the count was right and the width was zero.
 * Every scanner then read a date literal's constant-pool index as if it were an
 * opcode and walked the rest of the stream misaligned, which surfaced as a raw
 * TypeError out of currency preflight on input as ordinary as `1-1-2020`.
 *
 * So the check below no longer takes the table's word for anything. It compiles
 * real source through the real engine, records where the compiler actually put
 * each opcode, and requires the table to reproduce exactly those offsets. A
 * width that is wrong in either direction moves the walk off the emitted
 * boundaries and fails.
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

	test("DATE_LITERAL takes one operand", () => {
		// The omission this file's compiled-source check was added to catch. Its
		// operand is a constant-pool index holding the epoch-ms the parselet
		// resolved, exactly like PUSH_NUMBER's.
		expect(OPERAND_BYTES[OpCode.DATE_LITERAL]).toBe(1);
	});
});

/**
 * One compiled program plus the offsets the compiler wrote its opcodes at.
 *
 * The offsets are the ground truth this file measures the table against: they
 * come from `emitOpcode()` itself, so they say which bytes are instructions and
 * which are operands without any second opinion to drift from.
 */
interface RecordedProgram {
	source: string;
	opcodes: Uint8Array;
	opcodeOffsets: number[];
}

/**
 * Source that exercises the opcodes a parselet can emit, one band at a time.
 *
 * Hand-written, but nothing here asserts a width: these only have to reach the
 * opcodes, and the coverage check below fails if they stop reaching one. The
 * expressions do not all have to succeed either, since compilation is the only
 * part that matters, so a line that errors at run time still pulls its weight.
 */
const COMPILED_CORPUS: readonly string[] = [
	// Arithmetic, bitwise, comparison, logic, conditional.
	"1 + 1", "5 - 2", "2 * 3", "6 / 2", "7 mod 3", "2 ^ 3", "-4", "+4",
	"1 << 2", "8 >> 1", "8 >>> 1", "6 & 3", "6 | 3", "6 xor 3", "~5",
	"1 == 1", "1 != 2", "1 < 2", "1 <= 2", "2 > 1", "2 >= 1",
	"true && false", "true || false", "if 1 > 0 then 2 else 3",
	// Literals and the constant pools they index.
	"1n + 2n", "0xff", "\"abc\"", "true", "50%",
	// Variables, local and global.
	":a = 5", "a + 1", "global :g = 7", "global :g",
	// Functions: built-in, user-defined, and the plugin-function extension
	// point, which is the arm that had already drifted once.
	"sqrt(16)", "max(1,2,3)", "f(x) = 2*x", "f(3)",
	"workdays in 2 weeks", "days between 1-1-2020 and 2-1-2020",
	// Business-day arithmetic in words: the offset (DATE_WORKDAY_OFFSET, one
	// direction byte) and the inclusive count (DATE_WORKDAYS_BETWEEN, no operand).
	"5 working days after 1-1-2020", "5 working days before 1-1-2020",
	"working days between 1-1-2020 and 2-1-2020",
	"\"2020-01-01\" to date", "timestamp", "is 1-1-2020 a weekday",
	// Units and currency.
	"5 km", "5 km to m", "5 km in m", "500 lux to best", "km to ?", "5 km to ?",
	"1 cup in ml", "1 m2 in cm2", "60 km/h to mph",
	// Datetime and clock time. `1-1-2020` is the reason this block exists.
	"now", "now + 3 days", "now - 3 days", "next friday", "last monday",
	"1-1-2020", "12/25/2023", "12PM", "10:30", "week number of 1-1-2020",
	// Rates.
	"$99/week", "30 fps", "$99/week * 2 weeks",
	// Converters, including the runtime-resolved name that is the SDK's arm.
	"0.5 as fraction", "0.5 as multiplier", "1500000 as sci",
	"10 as binary", "10 as octal", "255 in hex", "255 as hex",
	"\"5\" as number", "5 as wibble",
	// Matrices, ranges, map/reduce, and the algebra verbs' bound unknown.
	"[1,2;3,4]", "[1,2;3,4][1]", "[1,2;3,4][1,2]",
	"[1,2,3;4,5,6][1:2, 1:2]", "[1,2,3;4,5,6][1, 1:2]", "[1,2,3;4,5,6][1:2, 1]",
	"1:5", "map(x*2, [1,2,3])", "reduce(acc+x, [1,2,3])",
	"sum(x, 1:5)", "prod(x, 1:5)",
	"der(x^2, x)", "solve(x^2-4=0, x)", "integral(x, x)",
	// Percentages and the finance phrases, which are where SWAP comes from.
	"10% of 200", "increase 100 by 10%", "100 + 10%", "10 is what % of 50",
	"20% off 100", "20% on 100", "what is 10% of 200",
	"5% APR on 1000 over 2 years", "remainder of 10 / 3", "root 3 of 27",
	"avg(1,2,3)", "midpoint of 1 and 3",
];

/**
 * Opcodes the VM handles but no parselet emits.
 *
 * Reachable only by hand-building a stream against the public `./vm` export, so
 * no source line can exercise them and the compiled-source check below cannot
 * speak for them. Listed rather than skipped silently, because the list is the
 * thing that has to be reconsidered when one of them is finally wired up: an
 * opcode moving out of here and into a parselet fails the coverage check until
 * the corpus above reaches it.
 *
 * Their widths are pinned here by hand, read off their `vm/VM.ts` handler,
 * because there is nothing to derive them from: the only honest thing to say
 * about an opcode nothing compiles to is what its handler consumes.
 */
const NEVER_EMITTED: ReadonlyMap<OpCode, { width: number; reason: string }> = new Map([
	[OpCode.NOP, { width: 0, reason: "no parselet emits a no-op" }],
	[OpCode.HALT, { width: 0, reason: "execution ends by running off the end of the stream" }],
	[OpCode.PUSH_HEX, { width: 1, reason: "hex literals reach the VM as PUSH_NUMBER; the handler still reads a pool index" }],
	[OpCode.PUSH_VARIABLE, { width: 0, reason: "superseded by LOAD_VAR, and the VM has no case for it" }],
	[OpCode.RETURN, { width: 0, reason: "reserved; user functions return by falling off their body" }],
	[OpCode.UOM_GET_VALUE, { width: 0, reason: "unit stripping happens inside other handlers" }],
	[OpCode.DATE_ADD, { width: 0, reason: "date arithmetic dispatches on operand type inside ADD" }],
	[OpCode.DATE_SUB, { width: 0, reason: "date arithmetic dispatches on operand type inside SUB" }],
	[OpCode.RATE_DIV, { width: 0, reason: "rate construction dispatches on operand type inside DIV" }],
	[OpCode.RATE_MUL, { width: 0, reason: "rate cancellation dispatches on operand type inside MUL" }],
	[OpCode.RATE_CONVERT, { width: 0, reason: "rate conversion dispatches on operand type inside the UOM band" }],
]);

/**
 * Compiles the corpus with `emitOpcode()` instrumented, and reports what it saw.
 *
 * The prototype is patched rather than a builder subclassed because the engine
 * owns its builders (it pools four of them) and never takes one from a caller.
 * `buildInto()` hands back views over those pooled buffers, which the next
 * compilation overwrites, so the bytes are copied at build time rather than
 * read later.
 */
function compileCorpus(): RecordedProgram[] {
	const recorded: RecordedProgram[] = [];
	const offsetsByBuilder = new WeakMap<object, number[]>();
	const proto = BytecodeBuilder.prototype as unknown as Record<string, (...args: never[]) => unknown>;
	const originalEmitOpcode = proto.emitOpcode;
	const originalBuild = proto.build;
	const originalBuildInto = proto.buildInto;
	const originalReset = proto.reset;
	let currentSource = "";

	function offsetsFor(builder: object): number[] {
		let offsets = offsetsByBuilder.get(builder);
		if (!offsets) {
			offsets = [];
			offsetsByBuilder.set(builder, offsets);
		}
		return offsets;
	}

	function capture(builder: BytecodeBuilder, program: BytecodeProgram): BytecodeProgram {
		recorded.push({
			source: currentSource,
			opcodes: Uint8Array.from(program.opcodes),
			opcodeOffsets: [...offsetsFor(builder)],
		});
		return program;
	}

	proto.emitOpcode = function (this: BytecodeBuilder, ...args: never[]) {
		// Before the delegate runs, so the recorded offset is where the opcode
		// byte lands rather than where the one after it will.
		offsetsFor(this).push(this.currentLength);
		return originalEmitOpcode.apply(this, args);
	} as never;
	proto.build = function (this: BytecodeBuilder, ...args: never[]) {
		return capture(this, originalBuild.apply(this, args) as BytecodeProgram);
	} as never;
	proto.buildInto = function (this: BytecodeBuilder, ...args: never[]) {
		return capture(this, originalBuildInto.apply(this, args) as BytecodeProgram);
	} as never;
	proto.reset = function (this: BytecodeBuilder, ...args: never[]) {
		offsetsByBuilder.set(this, []);
		return originalReset.apply(this, args);
	} as never;

	try {
		for (const source of COMPILED_CORPUS) {
			currentSource = source;
			const engine = new ExpressionEngine("en");
			try {
				engine.evaluateExpression(source);
			} catch {
				// Only compilation is being measured. A line the VM rejects, or
				// one that needs a variable this engine does not have, still
				// emitted its opcodes on the way there.
			} finally {
				engine.clear();
			}
		}
	} finally {
		proto.emitOpcode = originalEmitOpcode;
		proto.build = originalBuild;
		proto.buildInto = originalBuildInto;
		proto.reset = originalReset;
	}

	return recorded;
}

describe("operand widths against what the compiler emits", () => {
	let recorded: RecordedProgram[] = [];

	beforeAll(() => {
		recorded = compileCorpus();
	});

	afterAll(() => {
		recorded = [];
	});

	test("the corpus compiles enough programs to be worth walking", () => {
		// A guard on the guard. If the engine ever stops routing compilation
		// through BytecodeBuilder, every check below would pass vacuously.
		expect(recorded.length).toBeGreaterThan(50);
	});

	test("walking each compiled program lands on exactly the emitted opcodes", () => {
		const failures: string[] = [];

		for (const program of recorded) {
			const walked: number[] = [];
			let index = 0;
			let guard = 0;
			while (index < program.opcodes.length && guard++ <= program.opcodes.length) {
				walked.push(index);
				index = nextInstruction(program.opcodes, index);
			}

			const drift = walked.findIndex((offset, i) => offset !== program.opcodeOffsets[i]);
			const sameLength = walked.length === program.opcodeOffsets.length;
			if (drift === -1 && sameLength && index === program.opcodes.length) continue;

			// Naming the opcode the walk was standing on when it diverged is the
			// whole diagnostic: that is the one whose width is wrong.
			const culprit = drift === -1
				? program.opcodeOffsets[walked.length] ?? program.opcodeOffsets[program.opcodeOffsets.length - 1]
				: program.opcodeOffsets[Math.max(0, drift - 1)];
			failures.push(
				`${JSON.stringify(program.source)}: the walk diverged from the emitted opcode boundaries.\n` +
				`  first suspect: ${getOpCodeName(program.opcodes[culprit])} at offset ${culprit}, ` +
				`table says it takes ${OPERAND_BYTES[program.opcodes[culprit]]} operand byte(s)\n` +
				`  emitted at: ${program.opcodeOffsets.join(",")}\n` +
				`  walked to:  ${walked.join(",")}\n` +
				`  bytes:      ${[...program.opcodes].join(",")}`,
			);
		}

		expect(failures.join("\n\n")).toBe("");
	});

	test("every opcode a parselet emits is covered by the corpus above", () => {
		// This replaces pinning the size of the enum. The count moved when an
		// opcode was added and stayed put when one gained an operand, which is
		// the case that actually broke: DATE_LITERAL was in the enum and in the
		// VM and missing from the table, and the count said nothing.
		//
		// Coverage is the stronger statement, and it subsumes the count: a new
		// opcode is neither exercised here nor listed as unreachable, so it
		// fails until someone decides which it is.
		const exercised = new Set<number>();
		for (const program of recorded) {
			for (const offset of program.opcodeOffsets) exercised.add(program.opcodes[offset]);
		}

		const uncovered = Object.values(OpCode)
			.filter((value): value is OpCode => typeof value === "number")
			.filter((op) => !exercised.has(op) && !NEVER_EMITTED.has(op))
			.map((op) => `${getOpCodeName(op)} (${op})`);

		expect(uncovered.join(", ")).toBe("");
	});

	test("the opcodes no parselet emits still carry the width their handler reads", () => {
		// They are unreachable from source but not from the public ./vm export,
		// so a scanner can still meet one in a caller-supplied stream.
		for (const [op, { width, reason }] of NEVER_EMITTED) {
			expect(`${getOpCodeName(op)}: ${OPERAND_BYTES[op]} (${reason})`).toBe(
				`${getOpCodeName(op)}: ${width} (${reason})`,
			);
		}
	});

	test("nothing listed as never emitted actually shows up in a compiled program", () => {
		// Keeps the list honest in the other direction: an opcode that starts
		// being emitted has to leave the list, which is what forces the corpus
		// above to grow a line for it.
		const exercised = new Set<number>();
		for (const program of recorded) {
			for (const offset of program.opcodeOffsets) exercised.add(program.opcodes[offset]);
		}

		const wronglyListed = [...NEVER_EMITTED.keys()]
			.filter((op) => exercised.has(op))
			.map((op) => getOpCodeName(op));

		expect(wronglyListed.join(", ")).toBe("");
	});
});
