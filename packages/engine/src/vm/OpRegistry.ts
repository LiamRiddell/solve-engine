import type { Value } from "@solve-js/vm/Value";
import type { BytecodeProgram, UserFunctionDef } from "@solve-js/parser/BytecodeBuilder";
import type { EngineContext } from "@solve-js/engine/EngineContext";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * A stored bare (colon-less) equation of the shape `factor1*factor2*...*
 * variable = rhs` (e.g. `a*x = [60;70]`, or `s*t*v = [vx;vy;1]`)
 * registered when that line is EXECUTED (mirroring `UserFunctionDef`'s own
 * execution-time registration, not parse-time), and consulted when
 * `<variable> =>` is later evaluated. Solving is `variable =
 * inv(factor1*factor2*...) * rhs` (`vm/VM.ts`'s THEREFORE-handling code,
 * `vm/MatrixOps.ts`'s `matrixMultiply()`/`inverse()`, both symbolic-aware
 * so a factor whose OWN cells are still-unassigned free variables, e.g.
 * `s = [sx,0,0;...]`, solves correctly too).
 *
 * `factorNames` are looked up via `vm.getVar()` at solve time (ordinary,
 * ALREADY-evaluated Matrix values, ordinary ("bare") assignment always
 * evaluates its RHS eagerly, even when that RHS itself contains
 * unassigned names, via symbolic-tolerant evaluation, so by solve time
 * each factor is already a genuine, possibly-partially-symbolic Matrix
 * Value sitting in the variable store), NOT re-compiled bytecode, since
 * this pattern only ever allows bare identifiers as factors (see
 * `ExpressionEngine.ts`'s own equation-detection doc comment for why this
 * stays a narrow, disclosed pattern rather than a general expression).
 * `rhsProgram` IS a real compiled program (the right-hand side can be an
 * arbitrary expression, e.g. `[vx;vy;1]`), evaluated in symbolic-tolerant
 * mode at solve time.
 */
export interface EquationDef {
	variable: string;
	factorNames: string[];
	rhsProgram: BytecodeProgram;
}

/**
 * A stored scalar equation, the general `x^2 - 4 = 0` shape, kept separate from
 * {@link EquationDef} rather than merged into it.
 *
 * The two are genuinely different problems solved by different machinery.
 * {@link EquationDef} is a product chain of matrix factors solved by inverting
 * their product; this is an arbitrary polynomial in one unknown solved by
 * `symbolic/Solve.ts`. Merging them into one optional-field type would mean
 * every consumer branching on which half is populated, and would put the older,
 * already-shipped matrix path at risk of being changed by accident.
 *
 * Both sides are compiled programs rather than pre-evaluated values, because
 * neither side can be evaluated until solve time: they contain the very unknown
 * being solved for.
 */
export interface ScalarEquationDef {
	/** The unknown this equation is keyed by and will be solved for. */
	variable: string;
	/** Compiled left-hand side, evaluated symbolic-tolerantly at solve time. */
	lhsProgram: BytecodeProgram;
	/** Compiled right-hand side, likewise. */
	rhsProgram: BytecodeProgram;
}

/**
 * Handler function for plugin-registered opcodes via CALL_PLUGIN (opcode 50).
 * No longer dispatched directly from the VM switch, plugins register
 * functions in pluginFunctionRegistry instead.
 *
 * @deprecated Use CALL_PLUGIN + pluginFunctionRegistry for plugin functionality.
 *   OpRegistry remains for the VM interface contract only.
 */
export type OpcodeHandler = (vm: VM, opcodes: Uint8Array, ip: number, numbers: Float64Array, strings: string[]) => number;

/** Registration payload for an opcode handler. Binds an OpCode to its handler function with plugin attribution. */
export interface IOpcodeHandlerRegistration {
	opcode: number;
	handler: OpcodeHandler;
	pluginName: string;
}

/** Maximum safe opcode value for Uint8Array storage. */
const MAX_OPCODE = 254;

/** Starting point for dynamic opcode allocation. */
const DYNAMIC_OPCODE_START = 200;

/**
 * Legacy opcode registry, retained for the VM interface contract.
 *
 * Previously dispatched custom opcodes (>= 200) from the VM switch-default
 * branch. Now plugins should use CALL_PLUGIN (opcode 50) via
 * pluginFunctionRegistry instead.
 */
export class OpRegistry {
	private handlers = new Map<number, OpcodeHandler>();
	private nextOpcode = DYNAMIC_OPCODE_START + 1;

	register(registration: IOpcodeHandlerRegistration): void {
		this.handlers.set(registration.opcode, registration.handler);
	}

	/**
	 * Remove a previously registered opcode handler.
	 * Used by package unregistration to reverse shared-registry contributions.
	 */
	unregister(opcode: number): void {
		this.handlers.delete(opcode);
	}

	get(opcode: number): OpcodeHandler | undefined {
		return this.handlers.get(opcode);
	}

	has(opcode: number): boolean {
		return this.handlers.has(opcode);
	}

	/**
	 * Allocate a unique opcode for a plugin's custom bytecode handler.
	 *
	 * Returns the next available opcode (starting at 201). Each call
	 * returns a distinct value. Plugins should call this once during
	 * registration and store the result.
	 *
	 * @throws If the dynamic opcode pool is exhausted.
	 * @returns A unique opcode number for the calling plugin.
	 */
	allocateOpcode(): number {
		if (this.nextOpcode > MAX_OPCODE) {
			throw ErrorFactory.config(
				"OPCODE_POOL_EXHAUSTED",
				`OpRegistry: dynamic opcode pool exhausted (max ${MAX_OPCODE - DYNAMIC_OPCODE_START} allocations).`
			);
		}
		return this.nextOpcode++;
	}

}

/**
 * VM interface consumed by opcode handlers and the bytecode executor.
 *
 * Provides stack operations, variable access, instruction counting,
 * and abort signal management for async cancellation.
 */
export interface VM {
	push(value: Value): void;
	pop(): Value;
	/**
	 * Pop the top of the stack as a number.
	 *
	 * @throws `STACK_UNDERFLOW` (INTERNAL) if the stack is empty. Unlike
	 *   `pop()`, which answers an empty stack with `0`, this reports it: a
	 *   handler asking for a number has no way to tell that `0` from a real
	 *   one. Every Value converts, so there is no operand-type throw here.
	 */
	popNumber(): number;
	/**
	 * Pop the top of the stack as a string, e.g. a unit name a handler's own
	 * bytecode pushed for it to read.
	 *
	 * @throws `STACK_UNDERFLOW` (INTERNAL) if the stack is empty, and
	 *   `MALFORMED_BYTECODE_OPERAND_TYPE` (VALIDATION, recoverable) if the
	 *   value on top is not a string. Both are structured `EngineError`s
	 *   naming this method, in place of the raw TypeError a bare `pop()!` and
	 *   a compile-time-only cast used to produce somewhere further along. A
	 *   handler that would rather branch than throw can `peek()` first.
	 */
	popString(): string;
	peek(): Value;
	getStack(): Value[];
	registry: OpRegistry;
	/**
	 * Read a variable by name, checks the INNERMOST active user-defined-
	 * function call frame first (see `pushCallFrame`), then falls back to
	 * the flat, session-scoped variable store. This is why a function
	 * parameter needs no dedicated load opcode: an ordinary `LOAD_VAR
	 * "x"` inside a function body resolves to the current call's bound
	 * argument automatically, without the parser needing to know it's
	 * compiling a function body at all.
	 */
	getVar(key: string): Value | undefined;
	setVar(key: string, value: Value): void;
	/**
	 * User-defined-function call frame, a name-keyed `Map` of this call's
	 * bound arguments, PUSHED before `CALL_USER_FUNCTION` executes the
	 * callee's body and POPPED immediately after (even if the body throws),
	 * so nested/recursive calls (`double(double(5))`) each get their own
	 * frame instead of clobbering a shared flat map. See `vm/VM.ts`'s
	 * `CALL_USER_FUNCTION` case. Deliberately NOT the same store as
	 * `setVar`'s flat `:name` variables, a call frame is call-scoped and
	 * stacked (only the INNERMOST frame is ever consulted by `getVar`, see
	 * its own doc comment, no lexical capture of an outer call's
	 * parameters), a variable is session-scoped and flat.
	 *
	 * @throws `FUNCTION_RECURSION_LIMIT_EXCEEDED` if pushing would exceed
	 *   the VM's configured `maxFunctionRecursionDepth`, the backstop for
	 *   `f(x) = f(x)`, which would otherwise recurse via nested
	 *   `executeBytecode()` calls until the native V8 stack overflows
	 *   uncatchably (each reentrant call gets its OWN fresh
	 *   `localInstructionCount`, so `maxInstructions` cannot catch this).
	 */
	pushCallFrame(frame: Map<string, Value>): void;
	popCallFrame(): void;
	/** Register (or redefine, overwrites any previous definition, matching `:name = value`'s own reassignment semantics) a user-defined function. */
	defineUserFunction(name: string, params: string[], program: BytecodeProgram): void;
	getUserFunction(name: string): UserFunctionDef | undefined;
	hasUserFunction(name: string): boolean;
	/**
	 * Every session-scoped variable currently defined, as `[name, value]` pairs,
	 * for snapshotting the VM's state (see `engine/EngineSnapshot.ts`). The
	 * returned array is a fresh copy, so mutating it does not touch the store,
	 * and it reads the flat document-variable table only, never a transient
	 * user-function call frame (those are call-scoped and gone by the time any
	 * snapshot is taken).
	 */
	getVariableEntries(): [string, Value][];
	/** Every user-defined function currently defined, as a fresh array copy, for snapshotting (see {@link getVariableEntries}). */
	getUserFunctionDefs(): UserFunctionDef[];
	/** Register (or redefine) a bare equation (`a*x = rhs`), keyed by its free variable. See {@link EquationDef}. */
	defineEquation(variable: string, factorNames: string[], rhsProgram: BytecodeProgram): void;
	getEquation(variable: string): EquationDef | undefined;
	hasEquation(variable: string): boolean;
	/** Register (or redefine) a stored scalar equation (`x^2-4 = 0`), keyed by its unknown. See {@link ScalarEquationDef}. */
	defineScalarEquation(variable: string, lhsProgram: BytecodeProgram, rhsProgram: BytecodeProgram): void;
	getScalarEquation(variable: string): ScalarEquationDef | undefined;
	hasScalarEquation(variable: string): boolean;
	reset(): void;
	/** The innermost call frame's bindings, or `undefined` when no call is in progress. Read-only, for building a frame that extends the current one rather than replacing it (see `BIND_UNKNOWN`'s handler). */
	getCallFrame(): ReadonlyMap<string, Value> | undefined;
	getMaxInstructions(): number;
	getMaxStackDepth(): number;
	/** Maximum elements a Range or Matrix may be expanded to by `map`/`reduce`. See `constants/Configuration.ts`'s `maxCollectionSize`. */
	getMaxCollectionSize(): number;
	/**
	 * Maximum elements (collection Values, matrix cells) one evaluation may
	 * materialise in total.
	 *
	 * The bound the two limits above cannot be. Both are checked between
	 * opcodes, so neither sees what one opcode allocates inside a loop of its
	 * own, and `getMaxCollectionSize()` bounds one collection without bounding
	 * the total. See `vm/AllocationBudget.ts` for the counter this configures
	 * and for why charging goes through that module rather than through the VM.
	 */
	getMaxAllocatedElements(): number;
	/**
	 * Maximum user-defined-function calls one evaluation may make in total.
	 *
	 * `maxFunctionRecursionDepth` (see `pushCallFrame` above) bounds how DEEP
	 * calls nest; this bounds how MANY there are, which is a different number
	 * and the one a doubling chain runs away with: twenty-two lines of
	 * `f(v) = g(v) + g(v)` reach two million calls at a depth of twenty-two.
	 * Held by `vm/AllocationBudget.ts` rather than counted here, because it has
	 * to survive `executeBytecode()` re-entering itself, exactly like the
	 * element tally and unlike `maxInstructions`.
	 */
	getMaxFunctionCalls(): number;
	/** How far forward `<date> + N workdays` may reach, in years. The one date offset that walks the calendar rather than computing, so the one with a ceiling. See `constants/Configuration.ts`'s `date.maxOffsetYears`. */
	getMaxDateOffsetYears(): number;
	/** The same bound backwards, as a negative number of years. */
	getMinDateOffsetYears(): number;
	getInstructionCount(): number;
	incrementInstructions(n: number): void;
	/** Active AbortSignal for the current expression evaluation. Checked before cache writes. */
	activeSignal?: AbortSignal;
	/** Abort the current evaluation (called when expression changes before resolution). */
	abortCurrent?: () => void;
	/**
	 * Registries belonging to the engine that created this VM.
	 *
	 * `CALL_PLUGIN` resolves handlers through here rather than through a
	 * module-level registry, so two engines in one process no longer share the
	 * plugin functions their packages registered. This follows what
	 * `userFunctions` and `equations` already do by being VM-instance scoped.
	 */
	context: EngineContext;
}

/** Shared singleton OpRegistry, used when no custom opcodes are needed. */
export const sharedOpRegistry = new OpRegistry();
