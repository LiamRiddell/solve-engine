import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `BytecodeProgram.opcodes` is a `Uint8Array`, every operand written into
 * it (including constant-pool indices from {@link BytecodeBuilder.emitNumber}/
 * {@link BytecodeBuilder.emitString}) is truncated to a single byte on
 * `build()`. Exceeding this silently wraps the index (e.g. entry 300 reads
 * back as entry 44), producing a wrong result with no error. See
 * {@link BytecodeBuilder.emitNumber} for the guard that turns this into a
 * thrown error instead.
 */
const MAX_CONSTANT_POOL_INDEX = 255;

/**
 * Compiled bytecode program produced by {@link BytecodeBuilder}.
 * Ready for consumption by {@link executeBytecode} without further processing.
 */
export interface BytecodeProgram {
	opcodes: Uint8Array;
	numbers: Float64Array;
	strings: string[];
	/**
	 * Numeric constants by opcode position, restored from a snapshot.
	 *
	 * Nothing in the compile path writes this: numbers are emitted inline into
	 * {@link numbers} instead. `build()` used to attach an empty Map to every
	 * program anyway, which was one allocation per compiled expression, around a
	 * tenth of parse-and-compile time, for a collection that was never read.
	 * It is left off now, and only {@link EngineSnapshot} sets it when restoring
	 * a program that carried one; every reader already guards on its absence.
	 */
	constants?: Map<number, number>;
	/**
	 * Whether the program contains any async opcodes (CALL_PLUGIN, etc.).
	 * Set during compilation by the BytecodeBuilder. Allows the engine
	 * to skip the O(n) resolver preflight check in O(1) for purely
	 * synchronous expressions like `2 + 2`.
	 */
	hasAsync: boolean;
	/**
	 * User-defined-function bodies compiled alongside this program (one
	 * entry per `name(params) = body` definition on this line). See
	 * {@link BytecodeBuilder.emitUserFunctionBody}. `OpCode.DEFINE_USER_FUNCTION`'s
	 * operand is an index into this array, resolved at VM-execution time
	 * (not parse time) so a diagnostic/lookahead parse that never actually
	 * executes the definition line has no side effect on `vm.userFunctions`.
	 */
	userFunctionBodies?: UserFunctionDef[];
	/**
	 * Anonymous function bodies compiled alongside this program, one entry
	 * per `map`/`reduce` inline transform expression (e.g. the `10*x` in
	 * `map(10*x, [0,1,500])`). See {@link BytecodeBuilder.emitAnonymousBody}.
	 * Deliberately a SEPARATE side-table from `userFunctionBodies`, not
	 * routed through `vm.userFunctions` at all: an inline body has no name
	 * and must never leak into the persistent name-keyed registry the way
	 * a real `f(x) = ...` definition does.
	 */
	anonymousBodies?: AnonymousBodyDef[];
}

/**
 * An anonymous transform body for `map`/`reduce`'s inline-expression form
 * (e.g. `10*x` in `map(10*x, [0,1,500])`, or `acc+x` in `reduce(acc+x,
 * [1,2,3])`). Structurally identical to {@link UserFunctionDef} minus the
 * `name`. See `OpCode.MAP_INVOKE`/`REDUCE_INVOKE` and
 * `vm/VM.ts`'s handlers, which build a call frame from `params`/`args`
 * exactly like `CALL_USER_FUNCTION` does, just without ever registering
 * the body in `vm.userFunctions`.
 */
export interface AnonymousBodyDef {
	params: string[];
	program: BytecodeProgram;
}

/**
 * A user-defined, parameterized, reusable function's compiled form
 * (`f(x) = 2*x + 1`). See `OpCode.DEFINE_USER_FUNCTION`/`CALL_USER_FUNCTION`
 * and `vm/VM.ts`'s `VM.defineUserFunction`/`getUserFunction`.
 *
 * `program` is the body compiled to its OWN independent `BytecodeProgram`,
 * not a fragment of the definition line's own bytecode. Parameter names
 * inside the body compile to ORDINARY `LOAD_VAR <name>` opcodes, no
 * parse-time rewriting, because parameter resolution happens dynamically
 * at the VM level: `CALL_USER_FUNCTION` pushes a name-keyed call frame
 * (`Map<string, Value>`) before re-executing `program`, and `VM.getVar()`
 * checks the innermost call frame before falling back to the flat
 * document-variable store. This is why a `UNIT`-collision parameter name
 * (e.g. `h` in `area(w, h) = w * h`, which lexes as the "hour" unit) needs
 * no special handling anywhere, it's just another `LOAD_VAR "h"`, resolved
 * the same way as any other name.
 */
export interface UserFunctionDef {
	name: string;
	params: string[];
	program: BytecodeProgram;
}

/**
 * Shared empty collections for programs that emit none.
 *
 * `build()` runs once per compiled expression, so an empty array allocated
 * there is an allocation per line of every document. Most programs emit no
 * strings at all (only the unit and datetime parselets do), and one that emits
 * no numbers is common too, so both were routinely allocating an empty
 * container that nothing would ever read.
 *
 * Sharing them is safe because a built program is read-only downstream: the VM
 * and the snapshot writer only index and iterate these, and nothing in the
 * engine pushes to `program.strings` or `program.numbers`. They are frozen so
 * that a future writer fails loudly here rather than silently corrupting every
 * other program that shares the instance.
 */
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_NUMBERS = new Float64Array(0);

/**
 * Direct-to-bytecode compiler for the Pratt parser.
 *
 * Accumulates opcodes, numeric constants, and string references during parsing,
 * then produces a {@link BytecodeProgram} for VM execution. Supports:
 * - Standard build via {@link build}
 * - Zero-copy build into pre-allocated buffers via {@link buildInto}
 * - In-place reset for reuse without reallocation
 */
export class BytecodeBuilder {
	private opcodes: number[] = [];
	private numbers: number[] = [];
	private strings: string[] = [];
	private stringIndex = new Map<string, number>();
	private _hasAsync = false;
	private userFunctionBodies: UserFunctionDef[] = [];
	private anonymousBodies: AnonymousBodyDef[] = [];

	/**
	 * The per-engine `plugin function name -> registry index` map, wired in by
	 * the engine so {@link emitPluginCall} can resolve a name at emit time. The
	 * same object reference is shared with every builder in an engine (the pool
	 * and each ad-hoc nested-body builder), and the engine populates it as
	 * packages register, so a parselet never sees the numeric index.
	 */
	constructor(private readonly pluginFunctionIndex?: ReadonlyMap<string, number>) {}

	/** The name->index map, so a nested-body builder inherits the same resolution. */
	get pluginIndexMap(): ReadonlyMap<string, number> | undefined {
		return this.pluginFunctionIndex;
	}

	/**
	 * Emit a plugin-function call by NAME. The engine assigns each registered
	 * `pluginFunctions` entry an index at registration; this resolves the name to
	 * that index and emits `CALL_PLUGIN` + index + argCount. Package authors emit
	 * through this rather than a hand-allocated index.
	 */
	emitPluginCall(name: string, argCount: number): void {
		const index = this.pluginFunctionIndex?.get(name);
		if (index === undefined) {
			throw ErrorFactory.execution(
				"UNKNOWN_PLUGIN_FUNCTION",
				`No registered plugin function named "${name}". A package must declare it in its pluginFunctions record and be registered before an expression using it is parsed.`,
				{ functionName: name },
			);
		}
		// One byte covers the first 256 plugin functions; beyond that, the
		// wide opcode carries a two-byte little-endian index. Emitting the
		// narrow form whenever it fits keeps existing bytecode and snapshots
		// byte-for-byte unchanged. The index cannot exceed 65535 because the
		// allocator (allocatePluginFunctionIndex) caps it, but guard anyway so
		// a stray index is a clear error rather than a silently truncated byte.
		if (index > 0xffff) {
			throw ErrorFactory.parsing(
				"PLUGIN_FUNCTION_INDEX_TOO_LARGE",
				`Plugin-function index ${index} exceeds the two-byte bytecode limit (65535).`,
				{ index },
			);
		}
		if (index <= 0xff) {
			this.emitOpcode(OpCode.CALL_PLUGIN);
			this.emitIndex(index);
		} else {
			this.emitOpcode(OpCode.CALL_PLUGIN_WIDE);
			this.emitIndex(index & 0xff); // low byte
			this.emitIndex((index >> 8) & 0xff); // high byte
		}
		this.emitIndex(argCount);
	}

	/** Emit an {@link OpCode} instruction. */
	emitOpcode(op: OpCode): void {
		this.opcodes.push(op);
		if (op === OpCode.CALL_PLUGIN || op === OpCode.CALL_PLUGIN_WIDE) {
			this._hasAsync = true;
		}
	}

	/**
	 * Emit a numeric literal: appends `n` to the program's constant pool and
	 * writes its index into the opcode stream (read back by the VM as e.g.
	 * `PUSH_NUMBER <idx>`).
	 *
	 * Numeric constants are NOT deduplicated (unlike {@link emitString})
	 * every call appends a new entry, so an expression with more than
	 * {@link MAX_CONSTANT_POOL_INDEX}+1 distinct numeric-literal occurrences
	 * throws rather than silently wrapping the index (see
	 * `MAX_CONSTANT_POOL_INDEX`'s doc for what that would otherwise do).
	 *
	 * @throws If the constant pool would exceed 256 entries.
	 */
	emitNumber(n: number): void {
		const idx = this.numbers.length;
		if (idx > MAX_CONSTANT_POOL_INDEX) {
			throw ErrorFactory.parsing(
				"TOO_MANY_NUMERIC_CONSTANTS",
				`Expression has more than ${MAX_CONSTANT_POOL_INDEX + 1} numeric literals, exceeding the bytecode constant pool's limit.`,
				{ limit: MAX_CONSTANT_POOL_INDEX + 1 }
			);
		}
		this.numbers.push(n);
		this.opcodes.push(idx);
	}

	/**
	 * Emit a string literal: interns `s` into the program's string pool
	 * (deduplicated via `stringIndex`) and writes its index into the opcode
	 * stream. Subject to the same constant-pool bound as {@link emitNumber},
	 * but since strings ARE deduplicated, only distinct string values count
	 * against the limit.
	 *
	 * @throws If the string pool would exceed 256 distinct entries.
	 */
	emitString(s: string): void {
		let idx = this.stringIndex.get(s);
		if (idx === undefined) {
			idx = this.strings.length;
			if (idx > MAX_CONSTANT_POOL_INDEX) {
				throw ErrorFactory.parsing(
					"TOO_MANY_STRING_CONSTANTS",
					`Expression has more than ${MAX_CONSTANT_POOL_INDEX + 1} distinct string literals, exceeding the bytecode constant pool's limit.`,
					{ limit: MAX_CONSTANT_POOL_INDEX + 1 }
				);
			}
			this.strings.push(s);
			this.stringIndex.set(s, idx);
		}
		this.opcodes.push(idx);
	}

	/**
	 * Emit a raw numeric operand (0-255) following an opcode, e.g. a
	 * plugin-function index for `CALL_PLUGIN`, or an argument count. Unlike
	 * {@link emitOpcode}, this does not go through the `OpCode` enum, so
	 * package authors use this (not an unsafe cast to `OpCode`) to push
	 * operands their own opcode handler expects to read positionally.
	 */
	emitIndex(idx: number): void {
		this.opcodes.push(idx);
	}

	/** Emit a raw byte (0-255), used for fixed small operands like argument counts. */
	emitByte(b: number): void {
		this.opcodes.push(b);
	}

	/** Number of opcodes/operands emitted so far, used to compute jump targets before {@link patchJump}. */
	get currentLength(): number {
		return this.opcodes.length;
	}

	/**
	 * Register a compiled user-defined-function body, returning its index
	 * into this program's `userFunctionBodies` side-table, the caller emits
	 * that index as `DEFINE_USER_FUNCTION`'s operand via {@link emitIndex}.
	 * Subject to the same {@link MAX_CONSTANT_POOL_INDEX} bound as
	 * {@link emitNumber}/{@link emitString} (the index itself is a single
	 * opcode-stream byte), in practice a single line defines at most a
	 * handful of functions, so this limit is never realistically reached.
	 *
	 * @throws If more than 256 function bodies are registered on one program.
	 */
	emitUserFunctionBody(name: string, params: string[], program: BytecodeProgram): number {
		const idx = this.userFunctionBodies.length;
		if (idx > MAX_CONSTANT_POOL_INDEX) {
			throw ErrorFactory.parsing(
				"TOO_MANY_FUNCTION_DEFINITIONS",
				`More than ${MAX_CONSTANT_POOL_INDEX + 1} function definitions on one line, exceeding the bytecode constant pool's limit.`,
				{ limit: MAX_CONSTANT_POOL_INDEX + 1 }
			);
		}
		this.userFunctionBodies.push({ name, params, program });
		return idx;
	}

	/**
	 * Register a compiled `map`/`reduce` anonymous transform body, returning
	 * its index into this program's `anonymousBodies` side-table, the
	 * caller emits that index as `MAP_INVOKE`/`REDUCE_INVOKE`'s operand via
	 * {@link emitIndex}. Same {@link MAX_CONSTANT_POOL_INDEX} bound as
	 * {@link emitUserFunctionBody}.
	 *
	 * @throws If more than 256 anonymous bodies are registered on one program.
	 */
	emitAnonymousBody(params: string[], program: BytecodeProgram): number {
		const idx = this.anonymousBodies.length;
		if (idx > MAX_CONSTANT_POOL_INDEX) {
			throw ErrorFactory.parsing(
				"TOO_MANY_ANONYMOUS_BODIES",
				`More than ${MAX_CONSTANT_POOL_INDEX + 1} map/reduce transform expressions on one line, exceeding the bytecode constant pool's limit.`,
				{ limit: MAX_CONSTANT_POOL_INDEX + 1 }
			);
		}
		this.anonymousBodies.push({ params, program });
		return idx;
	}

	/** Overwrite a previously-emitted placeholder operand at `position` with the real jump `target`, once known. */
	patchJump(position: number, target: number): void {
		this.opcodes[position] = target;
	}

	/**
	 * Build the accumulated opcodes/numbers/strings into a BytecodeProgram.
	 * Creates new TypedArrays, the builder can be reused after this call.
	 */
	build(): BytecodeProgram {
		return {
			opcodes: new Uint8Array(this.opcodes),
			numbers: this.numbers.length > 0 ? new Float64Array(this.numbers) : EMPTY_NUMBERS,
			// Defensive copy when there is anything to copy: reset()'s
			// `.length = 0` would otherwise clear a reference the program still
			// holds. An empty one needs no copy, so it shares the frozen
			// singleton instead of allocating per program.
			strings: this.strings.length > 0 ? [...this.strings] : (EMPTY_STRINGS as string[]),
			hasAsync: this._hasAsync,
			userFunctionBodies: this.userFunctionBodies.length > 0 ? [...this.userFunctionBodies] : undefined,
			anonymousBodies: this.anonymousBodies.length > 0 ? [...this.anonymousBodies] : undefined,
		};
	}

	/**
	 * Build directly into a pre-allocated buffer for zero-copy VM consumption.
	 *
	 * When `buf` is provided and large enough, writes into it and returns
	 * subarray **views** (not copies), the returned TypedArrays share the
	 * buffer's underlying ArrayBuffer. The caller MUST NOT mutate the buffer
	 * until the returned BytecodeProgram is no longer needed.
	 *
	 * If the caller intends to cache the result, they must copy the TypedArrays
	 * (e.g. `new Uint8Array(program.opcodes)`) before reusing the buffer pool.
	 *
	 * When `buf` is omitted or too small, allocates fresh TypedArrays.
	 */
	buildInto(buf?: { opcodes: Uint8Array; numbers: Float64Array }): BytecodeProgram {
		const opLen = this.opcodes.length;
		const numLen = this.numbers.length;

		const reuseOpcodes = buf && buf.opcodes.length >= opLen;
		const reuseNumbers = buf && buf.numbers.length >= numLen;

		// Subarray views that share the buffer's ArrayBuffer (zero-copy)
		const opcodes = reuseOpcodes
			? new Uint8Array(buf!.opcodes.buffer, buf!.opcodes.byteOffset, opLen)
			: new Uint8Array(opLen);
		const numbers = reuseNumbers
			? new Float64Array(buf!.numbers.buffer, buf!.numbers.byteOffset, numLen)
			: new Float64Array(numLen);

		// Write data into the views
		for (let i = 0; i < opLen; i++) opcodes[i] = this.opcodes[i];
		for (let i = 0; i < numLen; i++) numbers[i] = this.numbers[i];

		return {
			opcodes,
			numbers,
			strings: [...this.strings],
			hasAsync: this._hasAsync,
			userFunctionBodies: this.userFunctionBodies.length > 0 ? [...this.userFunctionBodies] : undefined,
			anonymousBodies: this.anonymousBodies.length > 0 ? [...this.anonymousBodies] : undefined,
		};
	}

	reset(): void {
		// Retain backing stores with .length = 0 to avoid reallocation on growth.
		// = [] discards the ArrayBuffer, forcing V8 to reallocate on every push()
		// threshold (4→8→16→32...). For a 50-opcode expression, that's 3-4 copies.
		this.opcodes.length = 0;
		this.numbers.length = 0;
		// Guarded on being non-empty. reset() runs once per compiled expression
		// and a CPU profile put it at over a tenth of parse-and-compile, which
		// is a lot for clearing collections that are usually already empty:
		// most expressions emit no strings, and user function bodies are rarer
		// still. Emptying an empty Map is not free, and neither is the write
		// barrier on a length assignment.
		if (this.strings.length > 0) {
			this.strings.length = 0;
			this.stringIndex.clear();
		}
		this._hasAsync = false;
		if (this.userFunctionBodies.length > 0) this.userFunctionBodies.length = 0;
		if (this.anonymousBodies.length > 0) this.anonymousBodies.length = 0;
	}
}
