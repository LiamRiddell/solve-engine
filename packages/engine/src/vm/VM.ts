import { OpCode } from "@solve-js/parser/OpCode";
import { Value, ValueType, numberValue, numberValueExact, numberValueRational, numberValueUncertain, stringValue, bigIntValue, hexValue, uomValue, uomValueExact, matrixValue, boolValue, datetimeValue, percentageValue, persistentValue, isArenaActive, errorValue, rateValue, isRateUnit, splitRateUnit, isTimecodeUnit, timecodeFps, rangeValue, symbolicValue, colourValue, faultedOperand, faultedIn, type MatrixEntry, type MatrixData, type RangeData, type ColourData } from "@solve-js/vm/Value";
import { decimalFromLiteral, decimalNegate, decimalToNumber } from "@solve-js/decimal";
import { moneyExactMagnitude, scaleMoneyByPercent, scaleMoneyExact } from "@solve-js/vm/MoneyExact";
import { varNode as varSymbolicNode, type SymbolicNode as SymbolicNodeType, type Rational, rationalNeg } from "@solve-js/symbolic";
import { symbolicPow, symbolicNeg, symbolicBuiltin, SYMBOLIC_NATIVE_BUILTINS } from "@solve-js/vm/SymbolicOps";
import { rowMajorToColumnMajor, matrixMultiply, matrixPower, matrixCompare, matIndex, matAt, inBounds, collectionToValues, matrixEntryToValue } from "@solve-js/vm/MatrixOps";
import type { VM, OpRegistry, EquationDef, ScalarEquationDef } from "@solve-js/vm/OpRegistry";
import { convertUnit, convertRate, getMeasure, getBestUnit, getConvertiblePossibilities, isWorkdayUnit } from "@solve-js/uom/UomConverter";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { ErrorFactory, normalizeUnknownError, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { CoreErrorCodes } from "@solve-js/errors/ErrorCode";
import { addBusinessDays as walkBusinessDays, countBusinessDaysBetween } from "@solve-js/vm/BusinessDays";
import { DiagnosticPipeline, DiagnosticEventType } from "@solve-js/diagnostics";
import { builtinFunctions, asConverterRegistry } from "@solve-js/vm/VMBuiltins";
import { builtinArityError } from "@solve-js/vm/VMBuiltinArity";
import { defaultEngineContext } from "@solve-js/engine/EngineContext";
import type { EngineContext } from "@solve-js/engine/EngineContext";
import { getOpCodeName } from "@solve-js/parser/OpCode";
import { unifyUom, binaryOp, compareUom, incomparableUnitsError, describeConversionMismatch, toBigIntOperand, compareBigIntOperands, bigIntDivisionByZero, power, exactRationalOp, compareRationalOperands, uncertainOp } from "@solve-js/vm/VMConversion";
import { CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { beginEvaluation, chargeAllocation, chargeFunctionCall, checkAllocation, checkedArray, endEvaluation } from "@solve-js/vm/AllocationBudget";
import type { BytecodeProgram, UserFunctionDef, AnonymousBodyDef } from "@solve-js/parser/BytecodeBuilder";

/**
 * Create a new VM instance with the given opcode registry and configurable limits.
 *
 * The VM is a stack machine that executes compiled bytecode. It manages:
 * - A value stack (bounded by `maxStackDepth`)
 * - A variable store (Map of name → Value)
 * - An instruction counter (bounded by `maxInstructions`)
 * - An AbortSignal for async cancellation
 *
 * @param registry - Opcode handler registry for plugin-extensible opcodes
 * @param maxStackDepth - Maximum stack slots (default 200)
 * @param maxInstructions - Maximum opcodes per expression (default 50000)
 * @param maxFunctionRecursionDepth - Maximum nested user-defined-function
 *   calls (default 50). See the VM interface's `pushCallFrame` doc for why
 *   this exists as its own dedicated guard, separate from `maxInstructions`.
 * @param maxCollectionSize - Maximum elements a Range or Matrix may be
 *   expanded to by `map`/`reduce` (default 100000). Neither of the two
 *   counters above can see that expansion, since it happens inside one
 *   opcode and never touches the value stack.
 * @param maxAllocatedElements - Maximum elements one evaluation may
 *   materialise in TOTAL (default 2000000). The parameter above bounds one
 *   collection; per-site bounds do not compose, and an operation whose result
 *   is the product of two legal operands (a matrix multiply) is bounded by
 *   neither. See `vm/AllocationBudget.ts`.
 * @param maxFunctionCalls - Maximum user-defined-function calls one
 *   evaluation may make in total (default 10000). `maxFunctionRecursionDepth`
 *   above bounds how deep they nest and cannot see how many there are: a
 *   doubling chain reaches two million calls at a depth of twenty-two.
 * @param maxDateOffsetYears - How far forward `<date> + N workdays` may
 *   reach, in years (default 100). The one date offset that walks rather than
 *   computing, so the one that needs a ceiling. See `addBusinessDays()`.
 * @param minDateOffsetYears - The same bound backwards, negative (default
 *   -100).
 * @param context - Registries belonging to the engine that created this VM.
 */
export function createVM(
    registry: OpRegistry,
    maxStackDepth = 200,
    maxInstructions = 50000,
    maxFunctionRecursionDepth = 50,
    maxCollectionSize = 100000,
    maxAllocatedElements = 2000000,
    maxFunctionCalls = 10000,
    maxDateOffsetYears = 100,
    minDateOffsetYears = -100,
    // Defaults to the shared context so the many call sites that predate
    // per-engine contexts keep working unchanged. An ExpressionEngine always
    // passes its own.
    context: EngineContext = defaultEngineContext,
    // The host's resolved holiday predicate for working-day arithmetic, or
    // undefined for weekends-only. Last, and optional, so every existing
    // createVM() call site keeps the honest default without changing. An
    // ExpressionEngine passes what `resolveHolidayPredicate(date.holidays)`
    // returns. See constants/Configuration.ts's `date.holidays`.
    holidayPredicate?: (epochMs: number) => boolean,
): VM {
    const stack: Value[] = [];
    const variables = new Map<string, Value>();
    let instructionCount = 0;

    let activeSignal: AbortSignal | undefined;
    let abortCurrent: (() => void) | undefined;

    // User-defined-function call frames, a real stack of name-keyed Maps
    // not a flat map, so nested/recursive calls (double(double(5))) each
    // get their own bound-argument scope instead of clobbering a shared
    // one. `getVar` below only ever consults the INNERMOST frame (no
    // lexical capture across nested calls). See OpRegistry.ts's VM
    // interface doc for the full reasoning.
    const callFrames: Map<string, Value>[] = [];
    // VM-INSTANCE-scoped (not module-global), an intentional improvement
    // over a shared-across-engines registry: two ExpressionEngine
    // instances with different documents no longer risk one's `f(x)`
    // clobbering the other's same-named function, which a module-level
    // Map would allow (the same class of gap ARCHITECTURE.md §10's L1
    // cross-instance-isolation item already tracks for pluginFunctionRegistry
    // et al.. This VM-scoped design simply doesn't inherit it).
    const userFunctions = new Map<string, UserFunctionDef>();
    // Bare (colon-less) equations (`a*x = rhs`), keyed by their free
    // variable. See OpRegistry.ts's EquationDef doc comment. Same
    // VM-instance scoping reasoning as userFunctions above.
    const equations = new Map<string, EquationDef>();
    // Bare scalar equations (`x^2-4 = 0`), kept in their own map rather than
    // sharing the one above, since the two are solved by entirely different
    // machinery. See OpRegistry.ts's ScalarEquationDef doc comment.
    const scalarEquations = new Map<string, ScalarEquationDef>();

    return {
      push(v: Value) {
        if (stack.length < maxStackDepth) {
          stack.push(v);
        }
      },
      getMaxStackDepth() { return maxStackDepth; },
      getMaxCollectionSize() { return maxCollectionSize; },
      getMaxAllocatedElements() { return maxAllocatedElements; },
      getMaxFunctionCalls() { return maxFunctionCalls; },
      getMaxDateOffsetYears() { return maxDateOffsetYears; },
      getMinDateOffsetYears() { return minDateOffsetYears; },
      // False whenever no calendar was configured, which is what makes
      // unconfigured working-day arithmetic weekends-only. See
      // vm/BusinessDays.ts, the only reader.
      isHoliday(epochMs: number) { return holidayPredicate ? holidayPredicate(epochMs) : false; },
      pop() {
        if (stack.length === 0) {
          return numberValue(0);
        }
        return stack.pop()!;
      },
      /**
       * Popped through `safePop()` for the same reason as `popString()` below.
       * Only the underflow half applies here: `toNumber()` is a real method on
       * every Value, so there was no cast to make a non-number look like one,
       * and the `!` was the whole bug.
       */
      popNumber() { return safePop(stack).toNumber(); },
      /**
       * Popped through the same two guards the dispatch loop below uses, and
       * for the same reason: a package's opcode handler can disagree with its
       * own bytecode exactly as this engine's compiler can disagree with
       * hand-assembled input.
       *
       * This was `stack.pop()!.value as string`, which had neither guard. The
       * `!` is compile-time only, so an empty stack reached `.value` and threw
       * a raw TypeError; so is the cast, so any Value the stack happened to be
       * holding was handed back as a "string" and threw in the handler's own
       * code some lines later. Nothing in this repo calls this method, which is
       * the only reason the fuzz corpus never found either.
       */
      popString() { return stringOperand(safePop(stack), "VM.popString()"); },
      peek() { return stack[stack.length - 1]; },
      getStack() { return stack; },
      registry,
      getVar(key: string) {
        if (callFrames.length > 0) {
          const frameValue = callFrames[callFrames.length - 1].get(key);
          if (frameValue !== undefined) return frameValue;
        }
        return variables.get(key);
      },
      setVar(key: string, val: Value) { variables.set(key, val); },
      deleteVar(key: string) { variables.delete(key); },
      pushCallFrame(frame: Map<string, Value>) {
        if (callFrames.length >= maxFunctionRecursionDepth) {
          throw ErrorFactory.execution(
            "FUNCTION_RECURSION_LIMIT_EXCEEDED",
            `Function call nesting exceeded maximum depth of ${maxFunctionRecursionDepth} (possible infinite recursion, e.g. f(x) = f(x))`,
            { maxFunctionRecursionDepth },
          );
        }
        callFrames.push(frame);
      },
      popCallFrame() { callFrames.pop(); },
      getCallFrame() { return callFrames.length > 0 ? callFrames[callFrames.length - 1] : undefined; },
      defineUserFunction(name: string, params: string[], program: BytecodeProgram) {
        userFunctions.set(name, { name, params, program });
      },
      getUserFunction(name: string) { return userFunctions.get(name); },
      hasUserFunction(name: string) { return userFunctions.has(name); },
      getVariableEntries() { return Array.from(variables.entries()); },
      getUserFunctionDefs() { return Array.from(userFunctions.values()); },
      defineEquation(variable: string, factorNames: string[], rhsProgram: BytecodeProgram) {
        equations.set(variable, { variable, factorNames, rhsProgram });
      },
      getEquation(variable: string) { return equations.get(variable); },
      hasEquation(variable: string) { return equations.has(variable); },
      defineScalarEquation(variable: string, lhsProgram: BytecodeProgram, rhsProgram: BytecodeProgram) {
        scalarEquations.set(variable, { variable, lhsProgram, rhsProgram });
      },
      getScalarEquation(variable: string) { return scalarEquations.get(variable); },
      hasScalarEquation(variable: string) { return scalarEquations.has(variable); },
      reset() {
        stack.length = 0;
        variables.clear();
        callFrames.length = 0;
        userFunctions.clear();
        equations.clear();
        scalarEquations.clear();
        instructionCount = 0;
        // The allocation tally deliberately isn't touched here. It belongs to
        // an evaluation rather than to a VM, and the outermost
        // `beginEvaluation()` zeroes it on the way in, so a reset would be
        // redundant work on a method the benchmark suite calls in its inner
        // loop.
        // Abort any in-flight async work for the previous expression
        if (abortCurrent) { abortCurrent(); abortCurrent = undefined; }
        activeSignal = undefined;
      },
      get activeSignal() { return activeSignal; },
      set activeSignal(s: AbortSignal | undefined) { activeSignal = s; },
      get abortCurrent() { return abortCurrent; },
      set abortCurrent(f: (() => void) | undefined) { abortCurrent = f; },
      context,
      getMaxInstructions() { return maxInstructions; },
      getInstructionCount() { return instructionCount; },
      incrementInstructions(n: number) {
        instructionCount += n;
        if (instructionCount > maxInstructions) {
          throw ErrorFactory.execution("INSTRUCTION_LIMIT_EXCEEDED", `Execution exceeded maximum of ${maxInstructions} instructions`);
        }
      },
    };
}

/**
 * Compiled bytecode ready for VM execution.
 *
 * Uses packed TypedArrays for cache-friendly memory layout:
 * - `opcodes`: Uint8Array of OpCode values
 * - `numbers`: Float64Array of numeric literals (indexed by opcode operands)
 * - `strings`: String table for identifiers, UoM units, and BigInt literals
 */
export interface Bytecode {
    opcodes: Uint8Array;
    numbers: Float64Array;
    strings: string[];
    /** User-defined-function bodies compiled alongside this program. See `parser/BytecodeBuilder.ts`'s `BytecodeProgram.userFunctionBodies`. */
    userFunctionBodies?: UserFunctionDef[];
    /** map/reduce anonymous transform bodies. See `parser/BytecodeBuilder.ts`'s `BytecodeProgram.anonymousBodies`. */
    anonymousBodies?: AnonymousBodyDef[];
}

/**
 * Per-line execution context, threaded optionally through
 * {@link executeBytecode} down to `CALL_PLUGIN`'s plugin-function handlers
 * (see `vm/VMBuiltins.ts`'s `pluginFunctionRegistry`).
 *
 * Exists so a package can implement cross-line features (`prev`, `line<N>`,
 * range/above aggregation. See `packages/lines/`) without every other
 * plugin function having to care: it's optional, and every existing
 * handler ignores it unchanged. Before this, a plugin function's only
 * input was its own call-site arguments, no line number, no access to
 * any other line's cached result. `getLineResult`/`isLineBoundary` are
 * both `undefined` when there's no real document (e.g.
 * `ExpressionEngine.evaluateExpression()`'s single-expression path, which
 * uses `lineIndex = -1` as its existing "no document" sentinel), a
 * plugin function needing document access must check for that itself
 * and return a clear error, never silently treat it as line 0.
 */
export interface LineExecutionContext {
    /** 1-based current line number, or -1 when there is no real document (see class doc above). */
    lineIndex: number;
    /** Look up another line's cached result by 1-based line number. `undefined` = not evaluated yet (or out of range), distinct from a line that evaluated to an actual `undefined`-like Value, which can't happen (every Value type has a concrete representation). */
    getLineResult?: (lineNumber: number) => Value | undefined;
    /** Whether line `lineNumber` is a blank line or a `#` heading, the stopping condition for "total above"/"sum above"/"average above" aggregation. */
    isLineBoundary?: (lineNumber: number) => boolean;
    /**
     * The variables another line's expression reads, by 1-based line number, or
     * `undefined` when the line has no evaluated expression (forward reference,
     * out of range, or markdown). Goal seek (`packages/goalseek/`) uses it to
     * refuse up front when the variable it was asked to vary is one the target
     * line never reads, rather than searching a relationship that cannot move.
     */
    getLineReads?: (lineNumber: number) => string[] | undefined;
    /**
     * Re-evaluate another line's already-compiled expression with `variable`
     * bound to `bound` for that one evaluation, without disturbing the
     * document's own value for it. This is the primitive goal seek
     * (`packages/goalseek/`) drives: binding a numeric candidate probes the
     * relationship, binding a symbolic placeholder (with `symbolicTolerant`)
     * reads it back in closed form. Returns an error Value when there is no
     * document, the line is not a plain expression ready to run, or its
     * re-evaluation itself faults. The binding is a call frame, so it shadows
     * the document's value exactly the way a function parameter does and is
     * gone the moment the probe returns.
     */
    evaluateLineWithBinding?: (
        lineNumber: number,
        variable: string,
        bound: Value,
        symbolicTolerant: boolean,
    ) => Value;
    /**
     * The hard ceiling on goal seek's bisection steps, from
     * `config.vm.maxGoalSeekIterations`. Carried on the context so the search,
     * which runs as a plugin function with no other view of engine config, is
     * bounded by the host's configured limit rather than a hardcoded one.
     */
    goalSeekMaxIterations?: number;
    /**
     * The RAW markdown text of line `lineNumber` (1-based), or `undefined`
     * when there is no real document or the line is out of range. Distinct
     * from `getLineResult`, which returns a line's evaluated Value: a
     * markdown table's rows are skipped by the evaluator and hold no result,
     * so reading a column as data has to go back to the source text. Backs
     * the tables package (`packages/tables/`), which walks upward from the
     * current line to find the nearest table and read one of its columns.
     */
    getLineText?: (lineNumber: number) => string | undefined;
}

/**
 * Discriminated union returned by {@link executeBytecode}.
 *
 * Two variants:
 * - `value`: execution completed synchronously with a concrete Value
 * - `pending`: an async plugin call was encountered, the orchestrator
 *   must await the resolver Promise, then re-execute
 *
 * Replaces the old throw-AsyncSuspenseError pattern, eliminating the need
 * for try/catch in the engine.
 */
export type EvalResult =
    | { type: 'value'; value: Value }
    | { type: 'pending'; queryKey: string; resolver: Promise<Value>; packageId: string; signal: AbortSignal }
    /**
     * NEW third arm, an internal invariant violation (stack underflow via
     * `safePop()`, an unresolved global variable bypassing preflight, a
     * safety limit exceeded) surfaced as a controlled, structured
     * `EngineError` instead of letting a raw exception escape
     * `executeBytecode()` uncaught. See `executeBytecode()`'s own doc
     * comment on the try/catch this arm makes possible.
     */
    | { type: 'error'; error: EngineError };

/**
 * Extract the Value from an EvalResult. Throws if the result is
 * `'pending'` (should not happen at call sites that have already resolved
 * async dependencies) or `'error'` (re-throws the original `EngineError`
 * as-is, preserving its structure. This used to be a raw `new Error(...)`).
 */
export function unwrapEvalResult(result: EvalResult): Value {
    if (result.type === 'value') return result.value;
    if (result.type === 'error') throw result.error;
    throw ErrorFactory.internal("UNEXPECTED_PENDING_RESULT", `Expected value result but got pending: ${result.queryKey}`);
}

// ── Shared helpers ─────────────────────────────────────────────────────
// Kept as module-level functions so V8 can inline them at the switch case
// call sites. Cost: zero when inlined by TurboFan.

/**
 * How many cells `matrixMultiply(l, r)` will materialise, computed from the
 * shapes alone so the answer is available before the multiply runs.
 *
 * Mirrors that function's own three cases. A dimension mismatch returns 0
 * rather than a product: the multiply refuses that pair without allocating, and
 * charging for an allocation that never happens would refuse a later, legal one.
 *
 * @param l - Left operand's shape and data.
 * @param r - Right operand's shape and data.
 * @returns Cell count of the result, or 0 when the shapes cannot be multiplied.
 */
function matrixProductCells(l: MatrixData, r: MatrixData): number {
    // A 1x1 operand broadcasts over the other rather than contracting with it,
    // so the result is the size of the other operand.
    if (l.rows === 1 && l.cols === 1) return r.data.length;
    if (r.rows === 1 && r.cols === 1) return l.data.length;
    if (l.cols !== r.rows) return 0;
    return l.rows * r.cols;
}

/**
 * How many cells {@link matrixPower} will materialise across its whole run.
 *
 * It squares repeatedly rather than multiplying one factor at a time, so the
 * count is per squaring step and not just the size of the answer: `a^1000000`
 * is twenty multiplications of a full-size matrix, each one a fresh allocation.
 *
 * @param m - The base, which must be square for the power to be attempted.
 * @param exponent - The power.
 * @returns Total cells the repeated squaring will allocate.
 */
function matrixPowerCells(m: MatrixData, exponent: number): number {
    if (!Number.isInteger(exponent) || exponent < 0) return 0;
    const cells = m.rows * m.cols;
    // The identity, then up to two products per bit of the exponent (one
    // squaring, one accumulation).
    return cells * (1 + (exponent < 2 ? 1 : 2 * Math.floor(Math.log2(exponent))));
}

/**
 * Fatal-bug fix: pop the stack, throwing a controlled `EngineError` instead
 * of silently returning `undefined` on an empty stack. Every one of this
 * dispatch loop's ~90 opcode cases used to call the raw `stack.pop()!`
 * the `!` is compile-time-only, so if bytecode's push/pop counts ever
 * didn't match what an opcode expected (corrupted bytecode, a buggy
 * third-party package's parselet, an internal compiler bug), `pop()`
 * silently returned `undefined` and the NEXT property access on it threw
 * a raw, uncontrolled `TypeError`. This file's own comments already
 * flagged the general risk class (see `maxStackDepth`'s doc comment above)
 * but only ever built a backstop against stack GROWTH; underflow had none.
 * Caught for free by `executeBytecode()`'s new outer try/catch.
 */
function safePop(stack: Value[]): Value {
    if (stack.length === 0) {
        throw ErrorFactory.internal({
            code: "STACK_UNDERFLOW",
            message: "Stack underflow: an opcode expected a value on the stack but it was empty",
            expected: "at least one value on the VM stack",
            found: "an empty stack",
            suggestion: "this indicates corrupted bytecode or a bug in a package's parselet (mismatched push/pop counts), not a user-input error",
        });
    }
    return stack.pop()!;
}

/**
 * What to tell a caller who handed `executeBytecode()` a program it cannot run.
 *
 * `executeBytecode` is a public export, so a bytecode program is CALLER INPUT in
 * exactly the way an expression string is. It was not being treated that way:
 * every operand was read on trust, so a truncated stream or an out-of-range
 * pool index reached `BigInt(undefined)`, `code.toUpperCase()` on a boolean, or
 * a reentrant call with no program at all. Each of those arrived as a raw
 * TypeError, was normalised to UNEXPECTED_ERROR/INTERNAL, and told the caller
 * the engine had a bug when what actually happened was that they passed
 * eleven bytes of nonsense.
 *
 * VALIDATION rather than INTERNAL, and recoverable, because that is what it is.
 */
const MALFORMED_BYTECODE_SUGGESTION =
    "bytecode is caller input on this entry point: rebuild the program with the engine's compiler, or fix the hand-assembled stream";

/**
 * Whatever was running when a malformation was found, for the message to name.
 *
 * The dispatch loop always has an OpCode. The `VM` interface's `popString()`
 * does not: it is called from a package's own opcode handler, which knows its
 * opcode perfectly well but has no way to pass it to a method whose signature
 * is fixed SDK surface. The method name is the next-best locator, and it is the
 * one that author is looking at anyway, so a site is either of the two.
 */
type BytecodeSite = OpCode | string;

/** A site's name for the message: an opcode's mnemonic, or a method name as given. */
function siteName(site: BytecodeSite): string {
    return typeof site === "number" ? getOpCodeName(site) : site;
}

/**
 * Builds the refusal, naming the site and what it was reaching for.
 *
 * @param code - Which class of malformation this is.
 * @param site - The opcode being executed when the problem was found, or the
 *   VM-interface method that found it. See {@link BytecodeSite}.
 * @param problem - Completes "Malformed bytecode: <SITE> ...".
 * @param expected - What a well-formed program would have had here.
 * @param found - What was there instead.
 * @param context - Anything else worth carrying, e.g. the offending index.
 * @returns The error to throw.
 */
function malformedBytecode(
    code: string,
    site: BytecodeSite,
    problem: string,
    expected: string,
    found: string,
    context: Record<string, unknown> = {},
): EngineError {
    const name = siteName(site);
    return ErrorFactory.validation({
        code,
        message: `Malformed bytecode: ${name} ${problem}`,
        expected,
        found,
        suggestion: MALFORMED_BYTECODE_SUGGESTION,
        // A named site reports under `site` rather than borrowing `opcodeName`,
        // so a host reading `opcode`/`opcodeName` never gets a method name
        // where it expects an opcode, and never has to tell a missing opcode
        // apart from opcode 0.
        context: typeof site === "number"
            ? { opcode: site, opcodeName: name, ...context }
            : { site: name, ...context },
    });
}

/**
 * Reads one operand byte, refusing a stream that ends mid-instruction.
 *
 * `opcodes[at]` on a `Uint8Array` past its end is `undefined` rather than a
 * throw, so an operand read off the end propagates silently into whatever the
 * handler does next. A one-byte `[PUSH_BIGINT]` program used to reach
 * `BigInt(undefined)` this way.
 *
 * @param opcodes - The instruction stream.
 * @param at - Offset of the operand byte, i.e. the caller passes `ip++`.
 * @param op - The opcode being executed, for the message.
 * @param role - What the operand is, e.g. "constant-pool index".
 * @returns The operand byte.
 */
function operandByte(opcodes: Uint8Array, at: number, op: OpCode, role: string): number {
    if (at >= opcodes.length) {
        throw malformedBytecode(
            "MALFORMED_BYTECODE_TRUNCATED",
            op,
            `is missing its ${role}: the program ends mid-instruction`,
            `an operand byte at offset ${at}`,
            `a program only ${opcodes.length} byte(s) long`,
            { offset: at, length: opcodes.length, role },
        );
    }
    return opcodes[at];
}

/**
 * Reads one operand byte and checks it actually indexes the pool it names.
 *
 * @param opcodes - The instruction stream.
 * @param at - Offset of the operand byte.
 * @param op - The opcode being executed.
 * @param role - What the operand is, for the truncation message.
 * @param poolSize - How many entries the pool holds.
 * @param poolName - The pool's name, for the message.
 * @returns An index known to be within the pool.
 */
function poolIndex(
    opcodes: Uint8Array,
    at: number,
    op: OpCode,
    role: string,
    poolSize: number,
    poolName: string,
): number {
    const index = operandByte(opcodes, at, op, role);
    if (index >= poolSize) {
        throw malformedBytecode(
            "MALFORMED_BYTECODE_CONSTANT_INDEX",
            op,
            `reads ${poolName} entry ${index}, which does not exist`,
            `an index below ${poolSize}`,
            `${index}`,
            { index, poolSize, pool: poolName },
        );
    }
    return index;
}

/**
 * Reads a string-pool entry through the bounds check above.
 *
 * The extra type check is not redundant with the bounds check: `strings` is an
 * ordinary array on a caller-supplied program, so it can be sparse or hold
 * something that is not a string at all.
 *
 * @param opcodes - The instruction stream.
 * @param at - Offset of the operand byte.
 * @param strings - The program's string pool.
 * @param op - The opcode being executed.
 * @param role - What the operand is, for the message.
 * @returns The pooled string.
 */
function poolString(opcodes: Uint8Array, at: number, strings: string[], op: OpCode, role: string): string {
    return pooledString(strings, operandByte(opcodes, at, op, role), op);
}

/**
 * The same check for an index that has already been read.
 *
 * `map(f, ...)` and `reduce(f, ...)` name their function through the `ref`
 * operand they had to read first in order to know which arm to take.
 *
 * @param strings - The program's string pool.
 * @param index - The pool index.
 * @param op - The opcode being executed.
 * @returns The pooled string.
 */
function pooledString(strings: string[], index: number, op: OpCode): string {
    const text = strings[index];
    if (typeof text !== "string") {
        throw malformedBytecode(
            "MALFORMED_BYTECODE_CONSTANT_INDEX",
            op,
            `reads string-pool entry ${index}, which is ${index >= strings.length ? "past the end of the pool" : "not a string"}`,
            `an index below ${strings.length}, holding a string`,
            index >= strings.length ? `${index}` : typeof text,
            { index, poolSize: strings.length, pool: "string-pool" },
        );
    }
    return text;
}

/**
 * A unit or converter name taken off the value stack.
 *
 * Every one of these sites used to be a bare `safePop(stack).value as string`.
 * The cast is compile-time only, so any Value the stack happened to be holding
 * went straight through, and the next `.toLowerCase()`/`.indexOf()` threw. This
 * also stops a Uom being built around a non-string unit, which is what let a
 * malformed stream carry the problem forward into unrelated handlers and
 * builtins that all reasonably assume a unit is text.
 *
 * @param value - The popped operand.
 * @param site - The opcode being executed, or the VM-interface method doing
 *   the popping. See {@link BytecodeSite}.
 * @param role - What the string is, e.g. "target unit name". Left out by a
 *   caller that has nothing more specific to say than "a string", which is all
 *   `popString()` knows: its handler is the only thing that knows the role.
 * @returns The string.
 */
function stringOperand(value: Value, site: BytecodeSite, role?: string): string {
    if (typeof value.value !== "string") {
        throw malformedBytecode(
            "MALFORMED_BYTECODE_OPERAND_TYPE",
            site,
            `expected a ${role ?? "string"} on the stack`,
            role ? `a string value holding the ${role}` : "a string value",
            `a ${ValueType[value.type] ?? "unknown"} value`,
            role ? { role, valueType: value.type } : { valueType: value.type },
        );
    }
    return value.value;
}

/**
 * Refuses a `map`/`reduce` body kind the dispatch has no arm for.
 *
 * The three arms are 0 (an inline anonymous body), 1 (a builtin) and 2 (a
 * user-defined function). Anything else used to fall past all of them with
 * `program` still undefined and then recurse into `executeBytecode(undefined)`,
 * whose destructure threw before its own try/catch could see it.
 *
 * @param kind - The operand as read.
 * @param ref - The body reference beside it, for the message.
 * @param op - MAP_INVOKE or REDUCE_INVOKE.
 */
function requireKnownBodyKind(kind: number, ref: number, op: OpCode): void {
    if (kind !== 0 && kind !== 1 && kind !== 2) {
        throw malformedBytecode(
            "MALFORMED_BYTECODE_BODY_KIND",
            op,
            `has body kind ${kind}, which is not one this VM knows`,
            "0 (inline body), 1 (builtin function) or 2 (user-defined function)",
            `${kind}`,
            { kind, ref },
        );
    }
}

/**
 * Turns a pooled string into a BigInt without letting V8's SyntaxError out.
 *
 * `BigInt("1.000")` throws a raw `SyntaxError`, which arrived at the host as
 * UNEXPECTED_ERROR/INTERNAL. From the `./vm` surface the string is caller
 * input; from ordinary source it means the lexer put something in the pool that
 * is not an integer, which is a real defect but still not something to report
 * as an unexplained internal fault on the user's line.
 *
 * @param text - The pooled literal text.
 * @param op - The opcode being executed.
 * @returns The parsed BigInt.
 */
function parseBigIntLiteral(text: string, op: OpCode): bigint {
    try {
        return BigInt(text);
    } catch {
        throw malformedBytecode(
            "MALFORMED_BYTECODE_BIGINT_LITERAL",
            op,
            `cannot read "${text}" as a whole number`,
            "a string holding an integer, with no decimal point or separators",
            `"${text}"`,
            { literal: text },
        );
    }
}

/**
 * Whether a program is runnable at all, checked before anything reads it.
 *
 * The destructure at the top of `executeBytecode()` sits outside its try/catch,
 * so `executeBytecode(undefined)` threw a raw TypeError at whoever called it.
 * That is reachable from inside the engine too: a `map`/`reduce` body whose
 * side-table entry is missing recurses with `program` undefined.
 *
 * Duck-typed rather than an `instanceof` check, because callers and tests
 * legitimately build programs with plain arrays rather than typed ones.
 *
 * @param bytecode - Whatever was passed in.
 * @returns A description of what is wrong, or `null` when it is runnable.
 */
function unrunnableProgram(bytecode: unknown): string | null {
    if (bytecode === null || typeof bytecode !== "object") {
        return `expected a bytecode program, got ${bytecode === null ? "null" : typeof bytecode}`;
    }
    const candidate = bytecode as { opcodes?: unknown; numbers?: unknown; strings?: unknown };
    if (typeof (candidate.opcodes as { length?: unknown } | undefined)?.length !== "number") {
        return "the program has no `opcodes` array";
    }
    if (typeof (candidate.numbers as { length?: unknown } | undefined)?.length !== "number") {
        return "the program has no `numbers` pool";
    }
    if (typeof (candidate.strings as { length?: unknown } | undefined)?.length !== "number") {
        return "the program has no `strings` pool";
    }
    return null;
}

/**
 * Reentrantly executes a `map`/`reduce` transform body, either an
 * anonymous inline expression (`10*x` in `map(10*x, [...])`) or a real
 * user-defined function's own body (`map(f, ...)`), with a fresh call
 * frame binding `params[i] -> args[i]`. Mirrors `CALL_USER_FUNCTION`'s own
 * reentrant-`executeBytecode()` pattern exactly (see its case below for
 * the full reasoning on why this is safe); factored out here so
 * `MAP_INVOKE`/`REDUCE_INVOKE` don't each duplicate it twice (once per
 * transform kind that needs a call frame, the builtin-function kind
 * needs no frame at all, so it's handled inline at each call site
 * instead).
 *
 * `symbolicTolerant` (H.3) is threaded straight through from the
 * ENCLOSING `executeBytecode()` call's own flag (see MAP_INVOKE/
 * REDUCE_INVOKE below), not hardcoded true, so a map/reduce transform
 * body only tolerates an undefined variable (e.g. the free `b` in
 * `reduce(acc+x+b,[1,2,3])=>2b+6`) when the OUTER expression is itself
 * running in a `=>` solve/simplify context; ordinary (non-`=>`)
 * map/reduce usage keeps today's exact behavior, a genuinely undefined
 * variable inside the transform body still hard-throws.
 */
function invokeFrameBody(
    params: string[],
    program: BytecodeProgram,
    args: Value[],
    vm: VM,
    pipeline: DiagnosticPipeline | undefined,
    expression: string | undefined,
    context: LineExecutionContext | undefined,
    symbolicTolerant: boolean,
): Value {
    const frame = new Map<string, Value>();
    for (let i = 0; i < params.length; i++) frame.set(params[i], args[i]);
    vm.pushCallFrame(frame);
    let bodyResult: EvalResult;
    try {
        bodyResult = executeBytecode(program, vm, pipeline, expression, context, symbolicTolerant);
    } finally {
        vm.popCallFrame();
    }
    if (bodyResult.type === "pending") {
        // Same v1 scope decision as CALL_USER_FUNCTION's own async body
        // rejection, propagating a 'pending' result up through a
        // reentrant executeBytecode() call would need the OUTER
        // expression's own bytecode position/stack state to also be
        // resumable later, which isn't implemented.
        throw ErrorFactory.execution(
            "MAP_REDUCE_ASYNC_UNSUPPORTED",
            `map/reduce transform bodies calling an async operation (weather, stocks, currency, ...) aren't supported`,
        );
    }
    if (bodyResult.type === "error") {
        throw bodyResult.error;
    }
    return bodyResult.value;
}

/**
 * Executes an algebra verb's expression argument with the verb's own named
 * unknown bound to itself, for `OpCode.BIND_UNKNOWN`.
 *
 * `der(x^2, x)` names x as the unknown it differentiates by, which declares
 * x bound for that expression: it has to read as the unknown even on a page
 * that also says `:x = 5`. This is the same shadowing a function's parameter
 * already gets (`getVar` reads the innermost call frame before the variable
 * store), reached the same way, with a frame. Without it the expression was
 * evaluated against the document's value first, so the verb was handed 25 and
 * `der(x^2, x)` answered 0, `solve(x^2-4=0, x)` reported no solution, and
 * `integral(x^2, x)` gave `25x`.
 *
 * The frame is copied from the enclosing one rather than started empty, so a
 * verb written inside a function or a map body still sees that body's own
 * parameters; only the named unknown is replaced.
 *
 * @param name - The unknown the verb named.
 * @param program - The expression argument, compiled on its own.
 * @returns The expression's value, with `name` free inside it.
 */
function invokeWithBoundUnknown(
    name: string,
    program: BytecodeProgram,
    vm: VM,
    pipeline: DiagnosticPipeline | undefined,
    expression: string | undefined,
    context: LineExecutionContext | undefined,
    symbolicTolerant: boolean,
): Value {
    const frame = new Map<string, Value>(vm.getCallFrame());
    frame.set(name, symbolicValue(varSymbolicNode(name)));
    vm.pushCallFrame(frame);
    let bodyResult: EvalResult;
    try {
        bodyResult = executeBytecode(program, vm, pipeline, expression, context, symbolicTolerant);
    } finally {
        vm.popCallFrame();
    }
    if (bodyResult.type === "pending") {
        // Unreachable through the shipped grammar (the parselets refuse an
        // async expression argument at parse time, see
        // SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS), and stated as its own error
        // rather than left to fall through as an accidental value.
        throw ErrorFactory.execution(
            "SYMBOLIC_ASYNC_UNSUPPORTED",
            `an algebra verb's expression cannot call an async operation (weather, stocks, currency, ...)`,
        );
    }
    if (bodyResult.type === "error") {
        throw bodyResult.error;
    }
    return bodyResult.value;
}

/**
 * `$20/day + $300/week`, two rates over different periods.
 *
 * Adding them reported incompatible units, because USD/day and USD/week are
 * literally different unit strings. They are the same kind of thing measured
 * per different periods, though, so one converts into the other and the sum is
 * meaningful. The right operand's period wins, which is the one the reader
 * just wrote and so the one they are thinking in.
 *
 * @returns The converted left magnitude, or null when these are not two rates
 * sharing a numerator.
 */
function unifyRatePeriods(l: Value, r: Value): number | null {
    if (l.type !== ValueType.Uom || r.type !== ValueType.Uom) return null;
    const leftUnit = l.unit;
    const rightUnit = r.unit;
    if (leftUnit === undefined || rightUnit === undefined) return null;

    const leftSlash = leftUnit.indexOf("/");
    const rightSlash = rightUnit.indexOf("/");
    if (leftSlash < 0 || rightSlash < 0) return null;
    // Same thing being measured, or there is nothing to reconcile.
    if (leftUnit.slice(0, leftSlash) !== rightUnit.slice(0, rightSlash)) return null;

    const leftPeriod = UNIT_TABLE[leftUnit.slice(leftSlash + 1).toLowerCase()] as readonly [number, number] | undefined;
    const rightPeriod = UNIT_TABLE[rightUnit.slice(rightSlash + 1).toLowerCase()] as readonly [number, number] | undefined;
    if (leftPeriod === undefined || rightPeriod === undefined) return null;
    if (leftPeriod[0] !== rightPeriod[0]) return null;

    // Per a longer period is a larger number: $20/day is $140/week.
    return l.toNumber() * (rightPeriod[1] / leftPeriod[1]);
}

/**
 * `$30 × 4 days`, money multiplied by a count of something.
 *
 * The unit system refused this outright, because there is no such unit as a
 * dollar-day and combining the two is genuinely undefined in general. But it
 * is not undefined in the one case where exactly one side is money: the other
 * side is then a count, and the answer is that much money.
 *
 * Restricted to money on purpose. `3 kg × 4 days` really has no meaning worth
 * guessing at, and it still says so.
 *
 * @returns The product, or null when this is not the money case.
 */
function moneyTimesQuantity(l: Value, r: Value): Value | null {
    if (l.type !== ValueType.Uom || r.type !== ValueType.Uom) return null;
    // Captured before the rate guard, which narrows the property away.
    const leftUnit = l.unit;
    const rightUnit = r.unit;
    if (leftUnit === undefined || rightUnit === undefined) return null;
    // Checked directly rather than through isRateUnit(), whose `unit is
    // string` signature narrows both locals to never on the negative branch.
    if (leftUnit.includes("/") || rightUnit.includes("/")) return null;

    const leftIsMoney = CURRENCY_DISPLAY[leftUnit.toUpperCase()] !== undefined;
    const rightIsMoney = CURRENCY_DISPLAY[rightUnit.toUpperCase()] !== undefined;
    // Exactly one side. Money times money is not a thing either.
    if (leftIsMoney === rightIsMoney) return null;

    return uomValue(l.toNumber() * r.toNumber(), leftIsMoney ? leftUnit : rightUnit);
}

/**
 * `X + 10%` and `X - 10%`, where the percentage is relative to X.
 *
 * A percentage on its own means nothing; it is a proportion *of* something.
 * Which of the two readings applies depends on what it is being combined with,
 * so the decision is made here where both operands are known, the same way
 * Datetime and Rate are handled in these opcodes:
 *
 *   200 + 10%     220        a percentage of a quantity is relative to it
 *   $300 + 15%    $345.00    and that includes money and other units
 *   10% + 20%     30%        two percentages are just proportions, they add
 *   30% + 0.4     70%        as does a percentage and a bare fraction
 *   100% + 2      300%       which is why this is 300% and not 3
 *
 * Returns `null` when neither operand is a Percentage, leaving the caller's
 * existing paths untouched.
 *
 * @param sign - `1` for addition, `-1` for subtraction.
 */
function combinePercentage(l: Value, r: Value, sign: 1 | -1): Value | null {
    if (l.type === ValueType.Percentage) {
        // A measured quantity on the other side is the thing the proportion is
        // OF, so the answer is that quantity scaled, exactly as it would be
        // with the operands the other way round: "10% + $5" is $5.50, the same
        // as "$5 + 10%". It used to fall through to the ordinary path, which
        // added the bare fraction as though it were money and answered $5.10.
        // Subtraction reads the same way round ("10% - $5" is $5 less a tenth,
        // $4.50), which keeps the rule one rule rather than two.
        if (r.type === ValueType.Uom && r.unit !== undefined) {
            return scaleMoneyByPercent(r, r.unit, l.toNumber(), sign);
        }
        // Otherwise a percentage on the left keeps the result a percentage,
        // because the thing being described is still a proportion. Only
        // Number/Percentage make sense here; anything else (a date, a matrix)
        // falls through to the ordinary error path.
        if (r.type !== ValueType.Percentage && r.type !== ValueType.Number) return null;
        return percentageValue(l.toNumber() + sign * r.toNumber());
    }
    if (r.type !== ValueType.Percentage) return null;

    // A percentage on the right of something concrete scales it. Uom covers
    // money and every other unit, and the unit has to survive: "$300 + 15%"
    // is $345.00, not a bare 345.
    const factor = 1 + sign * r.toNumber();
    if (l.type === ValueType.Number) {
        // A scalar multiply scales a carried tolerance by the same factor, so a
        // measurement keeps its uncertainty: "(100 +/- 5) + 10%" is "110 +/- 5.5",
        // exactly what "(100 +/- 5) * 1.1" gives. Without this the tolerance was
        // silently dropped.
        const scaled = l.toNumber() * factor;
        if (l.uncertainty !== undefined) return numberValueUncertain(scaled, Math.abs(l.uncertainty * factor));
        return numberValue(scaled);
    }
    // A Uom with no unit string is not something this can scale meaningfully,
    // so it falls through to the ordinary path rather than inventing one. Money
    // stays exact via the base-ten scaling factor.
    if (l.type === ValueType.Uom && l.unit !== undefined) return scaleMoneyByPercent(l, l.unit, r.toNumber(), sign);
    return null;
}

/**
 * `X * p%` and `p% of X` are a scalar multiply, so a tolerance on `X` scales by
 * the factor: `(100 +/- 5) * 10%` and `10% of (100 +/- 5)` are `10 ± 0.5`. Only
 * fires when one operand is a Percentage and the other is an uncertain Number, so
 * every plain `100 * 10%` and every non-percentage multiply keeps its own path.
 * (`of` compiles to `MUL`, so this covers both spellings.) Returns null
 * otherwise, exactly as {@link combinePercentage} does for `+`/`-`.
 */
function multiplyPercentWithUncertainty(l: Value, r: Value): Value | null {
    const pct = l.type === ValueType.Percentage ? l : r.type === ValueType.Percentage ? r : null;
    if (pct === null) return null;
    const other = pct === l ? r : l;
    if (other.type !== ValueType.Number || other.uncertainty === undefined) return null;
    const factor = pct.toNumber();
    return numberValueUncertain(other.toNumber() * factor, Math.abs(other.uncertainty * factor));
}

/**
 * Money times a scalar is a scalar multiply, so like `$X + p%` it must stay exact
 * to the cent: `15% of $0.10` and `$0.10 * 15%` are `$0.015 -> $0.02`, not the
 * `$0.01` a bare double rounds down to, and the same for a computed factor with
 * no exact sidecar of its own, e.g. `50% of 1% of $3` (the inner `50% of 1%`
 * reduces to a bare `0.005`). Fires when one operand is a currency Uom and the
 * other a plain Number or a Percentage, routing through the same base-ten scaling
 * the `+`/`-` path uses, which recovers the factor from its shortest decimal (see
 * MoneyExact.ts). A rational scalar (`$3 * 2/7`) is left alone so the exact
 * fraction is kept rather than flattened to a decimal, and a non-currency Uom
 * (`10% of 5 kg`) and every other multiply keep their existing path. (`of`
 * compiles to `MUL`, so this covers the `of` spellings too.)
 */
function multiplyMoneyByScalarExact(l: Value, r: Value): Value | null {
    const money = l.type === ValueType.Uom ? l : r;
    const scalar = l.type === ValueType.Uom ? r : l;
    if (money.type !== ValueType.Uom || money.unit === undefined || !sharedCurrencyExchange.isCurrency(money.unit)) return null;
    if (scalar.type !== ValueType.Number && scalar.type !== ValueType.Percentage) return null;
    if (scalar.rational !== undefined) return null;
    return scaleMoneyExact(money, scalar.toNumber(), money.unit);
}

/**
 * A division involving a Percentage and an uncertain Number carries the tolerance
 * that {@link uncertainOp} drops for a Percentage operand, in both arrangements:
 *
 *   (100 +/- 5) / 10%     1000 ± 50       X / p% = X/factor, spread scales by 1/factor
 *   10% / (2 +/- 0.1)     0.05 ± 0.0025   p% / (b ± e) = a/b, spread |a·e / b²|
 *
 * A zero divisor returns null so the general path surfaces the divide-by-zero,
 * and every other division keeps its own path.
 */
function dividePercentWithUncertainty(l: Value, r: Value): Value | null {
    // Uncertain Number over a Percentage divisor: a scalar divide by `factor`.
    if (r.type === ValueType.Percentage && l.type === ValueType.Number && l.uncertainty !== undefined) {
        const factor = r.toNumber();
        if (factor === 0) return null;
        return numberValueUncertain(l.toNumber() / factor, Math.abs(l.uncertainty / factor));
    }
    // Percentage over an uncertain Number divisor: the divisor's relative spread
    // carries through the quotient (the dividend is exact, so only `b` varies).
    if (l.type === ValueType.Percentage && r.type === ValueType.Number && r.uncertainty !== undefined) {
        const b = r.toNumber();
        if (b === 0) return null;
        return numberValueUncertain(l.toNumber() / b, Math.abs((l.toNumber() * r.uncertainty) / (b * b)));
    }
    return null;
}

/** Extract milliseconds from a duration Value (UoM time unit or plain number).
 *  The linear half of {@link shiftDatetime}, and the whole of it for any unit
 *  shorter than a day. */
function extractDurationMs(value: Value): number {
    if (value.type === ValueType.Uom) {
        const unit = value.unit;
        // Only a time-measure unit can be a duration. Checking the measure
        // BEFORE converting, rather than relying on convertUnit() to throw for
        // everything else, is deliberate: it makes `<date> + 5 kg` contribute
        // zero because kilograms are not a duration, not because a conversion
        // happened to fail. The two are the same today, but a single lenient
        // conversion is all it takes for them to diverge, and when they do the
        // symptom is a silently wrong date rather than an error. That is
        // exactly how `today + 5 m` came to mean five minutes.
        if (unit && getMeasure(unit) === "time") {
            try { return convertUnit(value.toNumber(), unit, "ms"); } catch { /* Ignore */ }
        }
        return 0;
    }
    return value.toNumber();
}

/**
 * Workdays in a year: 52.1775 weeks of five, rounded down.
 *
 * Only ever used to turn a limit configured in years into a number of steps
 * {@link addBusinessDays} may take, so being a day or two out across a century
 * is immaterial and no date is ever computed from it. Deliberately not the
 * unit table's workday<->day ratio, which exists for Rate arithmetic.
 */
const WORKDAYS_PER_YEAR = 260;

/**
 * Advance (or, for negative `n`, retreat) a Datetime by `n` business days,
 * skipping Saturdays/Sundays, e.g. Friday + 1 workday lands on Monday, not
 * Saturday. Backs the datetime package's `<date> + N workdays` / `<date> -
 * N workdays` arithmetic and the `N working days after/before/from <date>`
 * form (see this function's call sites below and `DATE_WORKDAY_OFFSET`).
 *
 * Skips public holidays too when the host has configured a calendar: the walk
 * asks `vm.isHoliday()` about each candidate day and lands only on a working
 * one. With no calendar `vm.isHoliday()` is always false, so this is weekends-
 * only, the honest default (see `constants/Configuration.ts`'s `date.holidays`
 * and `vm/BusinessDays.ts`). Same predicate every working-day form consults, so
 * `<date> + N workdays` and `N working days after <date>` can never disagree.
 *
 * Walks one calendar day at a time (matching this file's existing
 * DATE_NEXT_WEEKDAY/DATE_LAST_WEEKDAY local-time convention below) rather
 * than a closed-form calculation, the exact skip pattern depends on which
 * day of the week the anchor date falls on (and which days the host excludes),
 * so there's no fixed ratio like uom/UomConverter.ts's workday<->day RATE
 * conversion (that's a linear approximation acceptable for Rate math; actual
 * date arithmetic needs the real, exact answer).
 *
 * That walk is why this is the one date offset with a ceiling on it. Every
 * other one moves a Date field once and lets Date recompute (see
 * addCalendarDays() below), so `today + 100000 days` costs what one day
 * costs; here the cost IS the offset. The loop runs entirely inside a single
 * ADD opcode, so `vm.maxInstructions` is never consulted while it runs:
 * `today + 100000000 workdays` froze for 13.2 seconds and then answered
 * "Invalid Date", and `today + 1000000000000 workdays` never answered at all.
 * `date.maxOffsetYears`/`date.minOffsetYears` bound it, which is also the
 * first thing in the engine ever to read those two fields. The same bound,
 * expanded to calendar days, is handed to the walk as its step cap, so a
 * calendar that marks every day a holiday (nothing ever counts) is refused
 * rather than looping forever.
 *
 * @throws `DATE_OFFSET_LIMIT_EXCEEDED` for an offset outside the configured
 * range. Recoverable: it is a statement about this line, not about the
 * engine.
 */
function addBusinessDays(epochMs: number, n: number, vm: VM): number {
    const remaining = Math.trunc(Math.abs(n));
    const direction = n >= 0 ? 1 : -1;
    // Checked before the first step rather than counted during it, so a
    // hopeless offset costs nothing at all. Working in workdays rather than
    // converting the bound to days keeps the comparison exact for the number
    // the user actually typed, and the ratio only has to be right to name a
    // limit, not to compute a date.
    const limitYears = direction > 0 ? vm.getMaxDateOffsetYears() : -vm.getMinDateOffsetYears();
    const limitWorkdays = Math.floor(limitYears * WORKDAYS_PER_YEAR);
    if (remaining > limitWorkdays) {
        throw ErrorFactory.execution(
            "DATE_OFFSET_LIMIT_EXCEEDED",
            `A date offset of ${remaining.toLocaleString("en-US")} workdays is about ${Math.round(remaining / WORKDAYS_PER_YEAR).toLocaleString("en-US")} years, past the limit of ${limitYears} years for a workday offset`,
            { requestedWorkdays: remaining, limitYears, limitWorkdays },
        );
    }
    // Seven calendar days per workday is the floor of a week with only one
    // working day in it, which no real calendar reaches, so a legitimate
    // in-limit offset never trips this. A pathological all-holiday calendar
    // does, and is reported as the same limit error rather than hanging.
    const maxCalendarSteps = limitWorkdays * 7 + 7;
    const landed = walkBusinessDays(epochMs, n, (ms) => vm.isHoliday(ms), maxCalendarSteps);
    if (landed === null) {
        throw ErrorFactory.execution(
            "DATE_OFFSET_LIMIT_EXCEEDED",
            `A working-day offset of ${remaining.toLocaleString("en-US")} could not be reached within the ${limitYears}-year limit; the configured holiday calendar leaves too few working days`,
            { requestedWorkdays: remaining, limitYears, maxCalendarSteps },
        );
    }
    return landed;
}

/** Milliseconds in a day that contains no daylight-saving transition. */
const MS_PER_DAY = 86_400_000;

/**
 * How many calendar months one of these units spans.
 *
 * The unit table gives a month and a year fixed lengths (2,592,000 and
 * 31,536,000 seconds, i.e. exactly 30 and 365 days). Those ratios are correct
 * for pure duration arithmetic, which is why they are left alone: `2 years in
 * days` genuinely is 730 days, and other code depends on that. They are not
 * correct for landing on a calendar date, because a real month is 28 to 31
 * days and a real year is 365 or 366, so no single ratio can put "a year after
 * January 1 2024" on January 1 2025 (linearly it lands on December 31 2024,
 * a day early, and drifts further with every year added).
 *
 * Every unit named here is therefore shifted with `setMonth()` instead, by
 * this many months. Everything not named here keeps whatever the table says.
 */
const CALENDAR_MONTHS_PER_UNIT: Record<string, number> = {
    month: 1, months: 1, mo: 1,
    year: 12, years: 12, yr: 12, y: 12, a: 12,
    decade: 120, decades: 120, dec: 120,
    century: 1200, centuries: 1200,
    millennium: 12000, millennia: 12000,
};

/** Days in calendar month `monthIndex` (0-11) of `year`. Day zero of the
 *  following month is the last day of this one, which is also how the leap
 *  year rule gets applied without restating it. */
function daysInMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Move `epochMs` by `days` calendar days, holding the local wall-clock time.
 *
 * Stepping the day field is the whole point, the same reason
 * addBusinessDays() above does it. A day is only 86,400,000 ms when no
 * daylight-saving transition falls inside it: the day a zone springs forward
 * is 23 hours long and the day it falls back is 25. Adding a flat 86,400,000
 * across either one lands an hour off, and an hour off a local midnight is a
 * different calendar day, so `2024-11-03 + 1 day` answered November 3 again
 * in Los Angeles and `26/10/2024 + 2 days` answered October 27 in London.
 * `setDate()` moves the field and lets Date recompute the offset, so the
 * answer is the day the user named in every zone.
 */
function addCalendarDays(epochMs: number, days: number): number {
    const whole = Math.trunc(days);
    const date = new Date(epochMs);
    date.setDate(date.getDate() + whole);
    const shifted = date.getTime();
    // A shift far enough out to leave the range a Date can represent gives an
    // Invalid Date. Falling back to the linear arithmetic hands back the same
    // out-of-range number as before rather than turning it into a NaN here.
    if (Number.isNaN(shifted)) return epochMs + days * MS_PER_DAY;
    // A fractional part is elapsed time, not a calendar step ("1.5 days" is a
    // day and then twelve hours), so it is added as milliseconds.
    return shifted + (days - whole) * MS_PER_DAY;
}

/**
 * Move `epochMs` by `months` calendar months, clamping to the end of the month
 * it lands in: January 31 plus a month is February 28, or February 29 in a leap
 * year, and never March.
 *
 * The clamp is why the day is parked on the 1st before the month field moves.
 * `setMonth()` on its own keeps the day number, so the 31st of a month whose
 * target has 30 days overflows into the month after it, which is how
 * `2024-01-31 + 1 month` answered March 1 and `2024-03-31 - 1 month` answered
 * March 1 as well. Clamping is what every calendar application does with this
 * case, and it is the only choice that keeps the month the user asked for.
 */
function addCalendarMonths(epochMs: number, months: number): number {
    const whole = Math.trunc(months);
    const date = new Date(epochMs);
    const dayOfMonth = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + whole);
    date.setDate(Math.min(dayOfMonth, daysInMonth(date.getFullYear(), date.getMonth())));
    const shifted = date.getTime();
    // A leftover fraction of a month names no calendar date of its own, so it
    // falls back to the table's fixed-length month. Same overflow reasoning as
    // addCalendarDays() above for the NaN case.
    const monthMs = convertUnit(1, "month", "ms");
    if (Number.isNaN(shifted)) return epochMs + months * monthMs;
    return shifted + (months - whole) * monthMs;
}

/**
 * Move a Datetime by a duration: the operation behind `<date> + <duration>`
 * and `<date> - <duration>`, with `sign` +1 for ADD and -1 for SUB.
 *
 * Three kinds of duration, because they are three different questions:
 * - Workdays skip weekends, so they are neither a fixed span of milliseconds
 *   nor a plain calendar-day step (see addBusinessDays() above).
 * - Months and years are calendar fields, not lengths (see
 *   CALENDAR_MONTHS_PER_UNIT above).
 * - Days, weeks and fortnights are whole calendar days, so they step the day
 *   field and keep the wall-clock time (see addCalendarDays() above).
 *
 * Everything shorter than a day stays linear, and deliberately so: a duration
 * in hours is elapsed time. "36 hours from now" means 36 hours of clock
 * ticking, across a daylight-saving transition included, which is exactly what
 * adding milliseconds does.
 */
function shiftDatetime(epochMs: number, duration: Value, sign: 1 | -1, vm: VM): number {
    if (duration.type === ValueType.Uom && duration.unit !== undefined) {
        const unit = duration.unit;
        const amount = sign * duration.toNumber();

        // `vm` is threaded in for this one branch: the workday walk is the
        // only date offset whose cost grows with the offset, so it is the only
        // one that needs a configured ceiling. See addBusinessDays().
        if (isWorkdayUnit(unit)) return addBusinessDays(epochMs, amount, vm);

        const monthsPerUnit = CALENDAR_MONTHS_PER_UNIT[unit];
        if (monthsPerUnit !== undefined) return addCalendarMonths(epochMs, amount * monthsPerUnit);

        // Measure first, for the reason extractDurationMs() gives below: a
        // unit that is not a duration at all has to contribute nothing rather
        // than be rescued by a lenient conversion.
        if (getMeasure(unit) === "time") {
            // Whether a unit is a whole number of days is read out of the unit
            // table rather than listed here, so weeks and fortnights are
            // covered by the same rule as days with nothing to keep in step by
            // hand. Sub-day units fail the test and fall through to the linear
            // path below, which is what they want.
            let daysPerUnit = 0;
            try { daysPerUnit = convertUnit(1, unit, "day"); } catch { /* Ignore */ }
            if (Number.isInteger(daysPerUnit) && daysPerUnit >= 1) {
                return addCalendarDays(epochMs, amount * daysPerUnit);
            }
        }
    }
    return epochMs + sign * extractDurationMs(duration);
}

/**
 * Combine a video-timecode Value (`Uom(totalFrames, "timecode@fps")`. See
 * `vm/Value.ts`'s timecode section) with a right-hand operand for ADD/SUB.
 * `sign` is +1 for ADD, -1 for SUB.
 *
 * Handles three right-hand shapes:
 * - Another timecode at the SAME fps -> combine frame counts directly.
 *   ADD ("timecode + timecode") keeps the timecode tag (SoulverCore treats
 *   a timecode primarily as a duration-since-zero, so summing two is
 *   meaningful, concatenating clip lengths, unlike summing two absolute
 *   Datetimes, which this file already rejects above). SUB ("timecode -
 *   timecode") produces a plain `Uom(diff, "frames")` instead, mirroring
 *   this file's Datetime-Datetime SUB convention just above (an absolute-
 *   ish quantity minus another yields a plain duration/count, not another
 *   absolute-ish value).
 * - A plain `Uom("frames")` (see FrameCountParselet) -> add/subtract the
 *   frame count directly, no fps conversion needed.
 * - Any other Time-measure Uom (minutes, seconds, ...) -> convert to
 *   seconds via convertUnit() and multiply by the timecode's own fps to
 *   get a frame count.
 * - A bare Number -> treated as a raw frame count, for convenience.
 *
 * Deliberately NOT commutative (only handles `left` being the timecode)
 * the task grammar this backs always writes the timecode first
 * ("timecode + N frames", not "N frames + timecode"); see this file's
 * ADD/SUB call sites for where that asymmetry is accepted.
 */
function combineTimecode(tc: Value, r: Value, sign: 1 | -1): Value {
    const fps = timecodeFps(tc.unit!);

    if (r.type === ValueType.Uom && isTimecodeUnit(r.unit)) {
        const rFps = timecodeFps(r.unit!);
        if (rFps !== fps) {
            return errorValue(
                "TIMECODE_FPS_MISMATCH",
                `Cannot combine timecodes at different frame rates (${fps} fps vs ${rFps} fps)`
            );
        }
        return sign === 1
            ? uomValue(tc.toNumber() + r.toNumber(), tc.unit!)
            : uomValue(tc.toNumber() - r.toNumber(), "frames");
    }

    if (r.type === ValueType.Uom && r.unit === "frames") {
        return uomValue(tc.toNumber() + sign * r.toNumber(), tc.unit!);
    }

    if (r.type === ValueType.Uom && r.unit && getMeasure(r.unit) === "time") {
        const seconds = convertUnit(r.toNumber(), r.unit, "s");
        return uomValue(tc.toNumber() + sign * seconds * fps, tc.unit!);
    }

    // Bare Number (or any other Uom), treated as a raw frame count.
    return uomValue(tc.toNumber() + sign * r.toNumber(), tc.unit!);
}

/**
 * Truthiness for a conditional/logical operand. `Boolean` values use
 * their own value directly; anything else falls back to a JS-like
 * "nonzero is truthy" reading of `toNumber()`, lets a plain numeric
 * expression work as a condition (`if x then ...`) without requiring an
 * explicit comparison, without adding a whole coercion framework.
 */
function isTruthy(value: Value): boolean {
    if (value.type === ValueType.Boolean) return value.value as boolean;
    return value.toNumber() !== 0;
}

/**
 * The answer a conversion gives when the two units measure different things.
 *
 * `UOM_CONVERT_TO` and `UOM_CONVERT_IN` used to push the input back unchanged
 * here, so "5 kg in m" displayed as "5.00 kg" and "$100 in ZZZ" as "$100.00":
 * not an error, not a conversion, the question repeated back as though it had
 * been answered at a rate of one. That is the failure mode this codebase
 * already refuses in `binaryOp` (vm/VMConversion.ts), where "10 m + 5 kg"
 * gives INCOMPATIBLE_UNITS rather than a bare 15, and the two paths now agree.
 *
 * Reached for a genuinely crossed pair ("1 m3 in m2"), for a currency against
 * a physical unit ("$100 in kg"), and for a code the lexer accepts that the
 * exchange does not consider money ("$100 in HRK"). All three are questions
 * with no answer, so all three say so.
 */
function incompatibleConversionError(fromUnit: string, toUnit: string): Value {
    // Name the two dimensions when both are known ("a duration cannot be
    // converted to a length"). A compound rate or an unrecognised currency code
    // has no single dimension to name, so it keeps the unit-naming fallback.
    const named = describeConversionMismatch(fromUnit, toUnit);
    return errorValue(
        "INCOMPATIBLE_UNITS",
        named ?? `Cannot convert ${fromUnit} to ${toUnit}: they do not measure the same thing`,
    );
}

/**
 * How large an exact `^` on a BigInt base is allowed to grow, in bits.
 *
 * Not a precision limit, a safety one. Exponentiation is the one operator
 * where a short line of input asks for an unbounded amount of work: `2n ^
 * 1000000000` is a single instruction that would spend minutes building a
 * ~125MB integer, and this engine runs inside an editor, where that takes the
 * host down with it. The instruction budget (`getMaxInstructions()`) cannot
 * help, because this is one instruction.
 *
 * 65536 bits is a little under twenty thousand decimal digits, far past any
 * result a person reads and far short of anything that stalls.
 *
 * DECIDED (1.0.0, differential run 20260811): past the ceiling the operation is
 * REFUSED, where it used to fall through to the ordinary double path and answer
 * Infinity. Infinity is not the answer to `2n ^ 100000`; the answer is a
 * 30,103-digit integer this engine has chosen not to build, and those are
 * different facts. Reporting the second as the first discards the exactness the
 * `n` type exists for AND the fact that a limit was reached, which is the
 * failure mode ("a confident magnitude that is not the real one") that the rest
 * of this release removes everywhere else.
 *
 * It is also the line this codebase already draws between its two numeric
 * types, one operator over: `1 / 0` is Infinity and `1n / 0n` is refused,
 * because exact integer arithmetic does not hand back approximations (see
 * `bigIntDivisionByZero()` in vm/VMConversion.ts). The double spelling is
 * untouched, so `2 ^ 100000` is still Infinity, exactly as IEEE 754 says.
 */
const MAX_EXACT_POW_BITS = 65536;

/**
 * How many bits `base ^ exponent` would occupy as an exact bigint, or `null`
 * when it has no exact bigint answer at all.
 *
 * Only a whole, non-negative exponent has one (there is no fractional bigint
 * and no reciprocal one); those cases return null and their caller keeps the
 * ordinary double path, which is the correct answer for them rather than a
 * fallback. The size is estimated from the base's magnitude as a double, which
 * is enough for a limit whose job is to reject the absurd: a base too large for
 * a double to hold is already past the limit.
 *
 * A magnitude of one or less is a special case for the same reason
 * {@link bigIntShift} special-cases zero: 0, 1 and -1 raised to anything at all
 * stay one bit wide, so `1n ^ 1000000` is exact, instant, and must not be
 * refused by an estimate that only looks at the exponent.
 */
function exactPowBits(base: Value, exponent: number): number | null {
    if (!Number.isInteger(exponent) || exponent < 0) return null;
    if (exponent === 0) return 1;
    const magnitude = Math.abs(base.toNumber());
    if (magnitude <= 1) return 1;
    const baseBits = magnitude <= 2 ? 1 : Math.log2(magnitude);
    return baseBits * exponent;
}

/**
 * `base ** exponent` for bigints, by repeated squaring.
 *
 * Written out rather than using the `**` operator on purpose. TypeScript
 * downlevels `**` to `Math.pow()` for any target below ES2016, and the test
 * config compiles at ES6, so the operator form threw "Cannot convert a BigInt
 * value to a number" under the test runner while working in the shipped build:
 * a difference between what is tested and what ships, which is worse than the
 * loop. `symbolic/Complex.ts`'s `complexPow` does the same thing for the same
 * shape of reason.
 *
 * `exponent` must be non-negative; {@link exactPowBits} is the guard.
 */
function bigIntPow(base: bigint, exponent: bigint): bigint {
    let result = 1n;
    let factor = base;
    let remaining = exponent;
    while (remaining > 0n) {
        if (remaining % 2n === 1n) result *= factor;
        remaining /= 2n;
        // Skipped on the last pass, where squaring would only build a number
        // twice the size of the answer and throw it away.
        if (remaining > 0n) factor *= factor;
    }
    return result;
}

/**
 * How large an exact bigint SHIFT is allowed to grow, in bits.
 *
 * Deliberately the same number as {@link MAX_EXACT_POW_BITS}, and named
 * separately only so each operator's ceiling can be read where it is used.
 * `1n << k` and `2n ^ k` are the same number written two ways, so a ceiling on
 * one and none on the other is not a difference of opinion between operators,
 * it is a hole: `2n ^ 100000` was refused while `1n << 100000` built the exact
 * 30,103-digit integer it asks for, and `1n << 100000000` built a 12.5MB one
 * and then spent 8.5 seconds inside `formatValue()` rendering thirty million
 * characters of it.
 */
const MAX_EXACT_SHIFT_BITS = MAX_EXACT_POW_BITS;

/**
 * How many bits a bigint occupies.
 *
 * The double path answers for anything a double can hold, where the exponent
 * IS the bit length. Past that `Number()` saturates to Infinity, so the length
 * comes off the hexadecimal form, which is linear in the size of the value.
 * (The decimal form is not, and turning a large bigint into decimal digits is
 * the exact cost this ceiling exists to prevent.)
 */
function bigIntBitLength(value: bigint): number {
    const magnitude = value < 0n ? -value : value;
    if (magnitude === 0n) return 0;
    const asDouble = Number(magnitude);
    if (Number.isFinite(asDouble)) return Math.floor(Math.log2(asDouble)) + 1;
    return magnitude.toString(16).length * 4;
}

/**
 * `l << r` (`direction` +1) or `l >> r` (-1) with a bigint operand, bounded by
 * {@link MAX_EXACT_SHIFT_BITS}.
 *
 * The right shift is guarded as well as the left, and not out of symmetry: a
 * bigint `>>` with a NEGATIVE count shifts the other way, so `1n >> -100000`
 * is the same unbounded growth spelled differently.
 *
 * Past the ceiling the shift is REFUSED, whichever operand made it a bigint
 * operation.
 *
 * DECIDED (1.0.0, differential run 20260811). The two spellings used to part
 * company here: a bigint on the LEFT fell through to `x * 2^n` as a double,
 * which for a number this size is Infinity, while a plain number on the left
 * (`1 << 100000n`, which reaches here because the bigint branch triggers on
 * EITHER operand) was refused by name, since JavaScript's 32-bit `<<` wraps its
 * count modulo 32 and would answer 1.
 *
 * `1n << 66000` is the case that settles it. It is a perfectly ordinary
 * 19,870-digit integer, and answering `Infinity` says two false things about
 * it: that it is beyond counting, and that nothing went wrong. The engine's own
 * reason for having an `n` type is that a double's approximation of a large
 * integer is not the integer, so approximating one as Infinity is that same
 * mistake at the largest possible scale. `^` now refuses at its ceiling for the
 * same reason (see {@link MAX_EXACT_POW_BITS}), which keeps `1n << k` and
 * `2n ^ k`, the same number written two ways, answering the same way at every
 * size.
 *
 * @throws `BIGINT_SHIFT_LIMIT_EXCEEDED` past the ceiling. Recoverable.
 */
function bigIntShift(l: Value, r: Value, direction: 1 | -1): Value {
    const value = toBigIntOperand(l);
    const shift = toBigIntOperand(r);
    // Zero shifted by anything is zero, and it costs nothing to say so, so it
    // is answered rather than refused however absurd the count is.
    if (value === 0n) return bigIntValue(0n);
    // How many bits the result gains. Negative means it shrinks, which no
    // ceiling has to care about. `Number()` on an absurd shift count saturates
    // to Infinity, which fails the comparison below, which is the right answer.
    const grownBits = direction * Number(shift);
    if (grownBits <= 0 || bigIntBitLength(value) + grownBits <= MAX_EXACT_SHIFT_BITS) {
        return bigIntValue(direction === 1 ? value << shift : value >> shift);
    }
    throw ErrorFactory.execution(
        "BIGINT_SHIFT_LIMIT_EXCEEDED",
        `Shifting by ${shift} would build an exact integer of about ${(bigIntBitLength(value) + grownBits).toLocaleString("en-US")} bits, past the limit of ${MAX_EXACT_SHIFT_BITS.toLocaleString("en-US")} bits`,
        { shift: String(shift), limitBits: MAX_EXACT_SHIFT_BITS },
    );
}

/**
 * Rate × Uom (matching the rate's denominator measure) -> plain
 * Uom/Number, the denominator cancelling out. E.g. "$50/week" ×
 * "12 weeks" -> "$600"; "30 fps" × "3 minutes" -> "5,400 frames".
 * Shared by `OpCode.RATE_MUL` (explicit) and `OpCode.MUL`'s automatic
 * rate detection (so plain "*"/"×" syntax works without a package having
 * to route through RATE_MUL specially).
 */
function multiplyRateByMatchingUom(rate: Value, multiplier: Value): Value {
    const { numerator, denominator } = splitRateUnit(rate.unit!);
    const rateMeasure = getMeasure(denominator);
    const multiplierMeasure = getMeasure(multiplier.unit!);
    if (!rateMeasure || rateMeasure !== multiplierMeasure) {
        return errorValue(
            "RATE_MUL_MEASURE_MISMATCH",
            `Cannot multiply a "${denominator}"-denominated rate by "${multiplier.unit}" — different measures`
        );
    }
    const multiplierInDenominatorUnit = convertUnit(multiplier.toNumber(), multiplier.unit!, denominator);
    const total = rate.toNumber() * multiplierInDenominatorUnit;
    return numerator ? uomValue(total, numerator) : numberValue(total);
}

// ── Converters (`as <type>`) formatting helpers ───────────────────────────
// Kept separate from FormatEngine.ts (display-only formatting of a Value
// for the editor gutter): these PRODUCE a new Value (typically a String)
// that becomes the expression's actual result, not just its rendering.

/**
 * Simplify a decimal to the smallest fraction that reproduces it within a
 * tight tolerance, via continued-fraction expansion, so a float like
 * 0.3333333333333333 (not exactly 1/3) still resolves to "1/3" instead of
 * an unreadably large denominator.
 */
function toFractionString(n: number): string {
    if (Number.isNaN(n)) return "NaN";
    if (!isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
    const negative = n < 0;
    const abs = Math.abs(n);
    const whole = Math.floor(abs);
    const frac = abs - whole;
    if (frac < 1e-9) return `${negative ? "-" : ""}${whole}`;

    let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
    let b = frac;
    const maxDenominator = 1_000_000;
    for (let i = 0; i < 30; i++) {
        const a = Math.floor(b + 1e-9);
        const h2 = a * h1 + h0, k2 = a * k1 + k0;
        if (k2 > maxDenominator) break;
        h0 = h1; h1 = h2; k0 = k1; k1 = k2;
        if (Math.abs(frac - h1 / k1) < 1e-9) break;
        const rem = b - a;
        if (rem < 1e-9) break;
        b = 1 / rem;
    }
    const numerator = whole * k1 + h1;
    return `${negative ? "-" : ""}${numerator}/${k1}`;
}

/**
 * Render an exact rational as a fraction: "1/3", "5/2", or a whole number as
 * itself ("4").
 *
 * The exact counterpart of {@link toFractionString}'s continued-fraction guess,
 * used when a value carries the rational it evaluates to. It is what makes
 * "(1/1000003) as fraction" read "1/1000003" rather than the "0/1" the float
 * approximation collapses to once the denominator passes its own ceiling.
 */
function rationalToFractionString(r: Rational): string {
    return r.d === 1n ? String(r.n) : `${r.n}/${r.d}`;
}

/**
 * A value rendered as a multiple, "4x".
 *
 * What counts as the multiple depends on what is being converted, which is why
 * this takes the Value rather than a number:
 *
 * - A **percentage** is a change, so it grows: 50% more is 1.5x, and
 *   `20 to 40 as x` (a 100% change) is 2x.
 * - **Anything else** is already the ratio: `20/5 as multiplier` is 4x.
 *
 * It used to add 1 unconditionally, so `20/5 as multiplier` answered 5x.
 * Telling the two apart only became possible when `%` started producing a
 * Percentage-typed value instead of a bare fraction (see PercentParselet.ts).
 */
function toMultiplierString(value: Value): string {
    const n = value.toNumber();
    const multiple = value.type === ValueType.Percentage ? 1 + n : n;
    return `${Math.round(multiple * 1e6) / 1e6}x`;
}

/** Scientific notation with trailing mantissa zeros trimmed ("1.50e+6" -> "1.5e+6"). */
function toScientificString(n: number): string {
    // An infinity or a NaN has no mantissa and no exponent, so splitting on
    // "e" gave back one piece and the second was undefined: "0/0 as sci"
    // rendered the string "NaNeundefined".
    if (!Number.isFinite(n)) return String(n);
    if (n === 0) return "0e+0";
    const [mantissa, exponent] = n.toExponential().split("e");
    const trimmed = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
    return `${trimmed}e${exponent}`;
}

/**
 * Execute bytecode with optional diagnostic pipeline integration.
 *
 * Performance notes:
 * - Uses a `switch(op)` statement for dispatch. V8 compiles dense integer
 *   switches (OpCode values 0–200) into a jump table with O(1) dispatch.
 *   All handler code is inlined directly in the switch cases, allowing
 *   TurboFan to optimize across opcode boundaries.
 * - ADD/SUB/MUL have an inlined numeric fast path that skips the `binaryOp()`
 *   function call + closure allocation when both operands are plain numbers
 *   (>90% of arithmetic ops).
 * - Tracing uses a boolean guard (`shouldTrace`) that the JIT eliminates
 *   entirely when diagnostics are disabled. No function call overhead.
 * - `Value.toNumber()` caches its result, computed once, read thereafter.
 */
export function executeBytecode(
    bytecode: Bytecode,
    vm: VM,
    pipeline?: DiagnosticPipeline | undefined,
    expression?: string,
    context?: LineExecutionContext,
    // Symbolic-tolerant mode (default false, every existing evaluation
    // path is completely unchanged): when true, LOAD_VAR pushes a
    // Symbolic placeholder (symbolic/SymbolicNode.ts) for an undefined variable
    // instead of throwing UNDEFINED_VARIABLE. Set only by the `=>`
    // solve/simplify path (H.2) and map/reduce's own reentrant calls when
    // folding a symbolic accumulator (H.3), never by top-level
    // evaluation, so the hard UNDEFINED_VARIABLE throw stays exactly as-is
    // for ordinary expressions.
    symbolicTolerant?: boolean
): EvalResult {
    // Before the destructure, which is the point: `executeBytecode(undefined)`
    // used to throw a raw TypeError from the destructure itself, outside the
    // try/catch below, so a host calling this public export got an exception
    // rather than the error arm this function documents. The internal caller
    // that reaches here with nothing is a map/reduce body whose side-table
    // entry is missing.
    const unrunnable = unrunnableProgram(bytecode);
    if (unrunnable) {
        return {
            type: 'error',
            error: ErrorFactory.validation({
                code: "MALFORMED_BYTECODE_PROGRAM",
                message: `Malformed bytecode: ${unrunnable}`,
                expected: "a BytecodeProgram with opcodes, numbers and strings",
                found: unrunnable,
                suggestion: MALFORMED_BYTECODE_SUGGESTION,
            }),
        };
    }

    const { opcodes, numbers, strings, userFunctionBodies, anonymousBodies } = bytecode;
    let ip = 0;
    let localInstructionCount = 0;
    const maxInstructions = vm.getMaxInstructions();
    const maxStackDepth = vm.getMaxStackDepth();

    // Direct stack array reference. Bypasses VM.push/pop's own bounds check
    // (vm.push() silently no-ops past maxStackDepth, fine for the rare
    // direct caller, wrong for the hot loop, which instead gets a single
    // cheap depth check per instruction below, same cost class as the
    // instruction-count check). Built-in packages' bytecode naturally stays
    // well under maxStackDepth (nesting depth is already bounded by
    // maxNestingDepth), but a third-party package's buggy parselet, or a
    // host that raises maxComplexity/maxNestingDepth, has no other
    // backstop against unbounded stack growth without this check.
    const stack = vm.getStack();

    // Boolean guard: JIT will eliminate the entire branch when false.
    // No function call, no argument evaluation, zero overhead.
    const shouldTrace = pipeline?.hasCollectors ?? false;

    // Hoist arena check to a local constant, avoids a function call at
    // every HALT/STORE_VAR/fallback-return in the dispatch loop.
    // The arena is only active during scroll execution (ThreeTierEvaluator
    // Tier 2); in all other paths this is always false and the JIT can
    // eliminate the unreachable persistentValue() branch entirely.
    const hasArena = isArenaActive();

    if (opcodes.length === 0) return { type: 'value', value: numberValue(0) };

    // Makes this VM's allocation allowance current for the duration of this
    // program, so that anything materialised beneath here charges it without
    // the intervening frames having to pass it down. Only the OUTERMOST entry
    // clears the tally: a reentrant call (a user-defined function, a map or
    // reduce body) keeps spending the same allowance, which is what stops
    // recursion from refreshing its own budget the way it can refresh
    // `localInstructionCount`. Paired with `endEvaluation()` in the `finally`
    // below, which is why a throw cannot leave a budget current.
    beginEvaluation(vm);

    // Fatal-bug fix: this whole dispatch loop used to have NO surrounding
    // try/catch at all, a safety-limit throw (INSTRUCTION_LIMIT_EXCEEDED/
    // STACK_LIMIT_EXCEEDED, both just below), an UNDEFINED_VARIABLE throw,
    // or a raw TypeError from a stack-underflow bug (see safePop() below)
    // escaped this function entirely and was only ever caught because every
    // production call site happened to sit inside SOMEONE ELSE's generic
    // catch, confirmed NOT true for AsyncResolutionBatcher.reExecuteMainThread()
    // which had none (now fixed separately, see that file). EvalResult's
    // new {type:'error'} arm makes this function's contract match what it
    // always should have been: three possible outcomes, all returned, none
    // silently relying on an external catch. Deliberately NOT re-indented
    // (a ~900-line body) to keep this diff reviewable, a future full pass
    // could re-indent, this fix does not depend on it.
    try {
    while (ip < opcodes.length) {
      // Tighten instruction limit check: combined increment + guard.
      // V8 optimises `++localInstructionCount > maxInstructions` into a
      // single fused add-and-compare on the hot path. The default limit
      // (50k) is never reached in benchmarks, so this branch is statically
      // predicted not-taken by the CPU.
      if (++localInstructionCount > maxInstructions) {
        throw ErrorFactory.execution("INSTRUCTION_LIMIT_EXCEEDED", `Execution exceeded maximum of ${maxInstructions} instructions`);
      }
      // Same cost class as the check above, one comparison, statically
      // predicted not-taken. Catches stack growth left over from the
      // previous instruction's push(es); a bounded one-instruction delay
      // is fine for a safety limit (see the comment on `stack` above).
      if (stack.length > maxStackDepth) {
        throw ErrorFactory.execution("STACK_LIMIT_EXCEEDED", `Execution exceeded maximum stack depth of ${maxStackDepth}`);
      }
      const op = opcodes[ip++] as OpCode;

      if (shouldTrace) {
        const stackSnapshot = stack.map(v => ({
          type: v.type,
          value: v.value,
          unit: v.unit,
        }));
        pipeline!.fireVmStep({
          type: DiagnosticEventType.VmStep,
          elapsedNs: 0,
          expression: expression ?? "",
          opcode: op,
          opcodeName: getOpCodeName(op),
          ip: ip - 1,
          stackDepth: stack.length,
          instructionNumber: localInstructionCount,
          stack: stackSnapshot,
        });
      }

      // ── switch dispatch: V8 compiles dense integer switches (OpCode 0–200)
      //    into a jump table with O(1) dispatch. Sections mirror the OpCode
      //    enum ordering for discoverability.
      switch (op) {
        // ═══════════════════════════════════════════════════════════════
        // §1  Stack operations  (OpCode 0–3)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.NOP:
          break;
        case OpCode.HALT: {
          const result = safePop(stack);
          return { type: 'value', value: hasArena ? persistentValue(result) : result };
        }
        case OpCode.DUP: {
          // Read through safePop rather than `stack[stack.length - 1]`, which
          // pushes `undefined` on an empty stack. A following HALT then popped
          // that undefined and returned `{ type: 'value', value: undefined }`,
          // a shape EvalResult declares impossible and every caller reads
          // without checking. Found by the bytecode fuzzer on the two-opcode
          // program `[DUP, HALT]`; the same underflow through any other opcode
          // was already controlled, since they all pop through safePop.
          const top = safePop(stack);
          stack.push(top);
          stack.push(top);
          break;
        }
        case OpCode.SWAP: {
          const a = safePop(stack), b = safePop(stack);
          stack.push(a);
          stack.push(b);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §2  Push literals  (OpCode 10–15)
        // ═══════════════════════════════════════════════════════════════
        // Every operand below goes through a checked read. An index past the
        // end of a pool used to yield `undefined` and be pushed as a Value,
        // which then failed somewhere else entirely: PUSH_BIGINT reached
        // `BigInt(undefined)`, and an undefined string sat on the stack until
        // a unit or converter name was read off it.
        case OpCode.PUSH_NUMBER:
          stack.push(numberValue(numbers[poolIndex(opcodes, ip++, op, "constant-pool index", numbers.length, "number-pool")]));
          break;
        case OpCode.PUSH_BIGINT:
          stack.push(bigIntValue(parseBigIntLiteral(poolString(opcodes, ip++, strings, op, "constant-pool index"), op)));
          break;
        case OpCode.PUSH_DECIMAL: {
          // A decimal-point literal: the exact base-ten value rides in the
          // `exact` sidecar, the nearest double stays in `value`, so this reads
          // as an ordinary Number everywhere except where it meets money.
          const dec = decimalFromLiteral(poolString(opcodes, ip++, strings, op, "constant-pool index"));
          stack.push(numberValueExact(decimalToNumber(dec), dec));
          break;
        }
        case OpCode.PUSH_HEX:
          stack.push(hexValue(numbers[poolIndex(opcodes, ip++, op, "constant-pool index", numbers.length, "number-pool")]));
          break;
        case OpCode.PUSH_STRING:
          stack.push(stringValue(poolString(opcodes, ip++, strings, op, "constant-pool index")));
          break;
        case OpCode.PUSH_BOOLEAN:
          stack.push(boolValue(operandByte(opcodes, ip++, op, "boolean operand") === 1));
          break;

        // ═══════════════════════════════════════════════════════════════
        // §3  Arithmetic  (OpCode 20–27)
        //     Binary ops (ADD/SUB/MUL/DIV/MOD/EXP) have inlined numeric
        //     fast paths; unary ops (NEG/POS) handle BigInt and UoM.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.ADD: {
          const r = safePop(stack), l = safePop(stack);
          // binaryOp() at the bottom of this chain propagates a faulted
          // operand, but only the branches that reach it do. The Datetime and
          // timecode branches above it do not: they read the other operand as
          // a duration, and a duration read off an Error is zero, so `today +
          // (5 kg to m)` answered today. See faultedOperand().
          const addFault = faultedOperand(l, r);
          if (addFault) { stack.push(addFault); break; }
          // A carried uncertainty propagates in quadrature before anything else,
          // so "(10 +/- 1) + (20 +/- 2)" is "30 ± 2.24". Gated on a sidecar
          // being present, and checked ahead of the rational branch below so an
          // uncertain operand is never folded into an exact fraction that would
          // silently drop its tolerance. See uncertainOp().
          if (l.uncertainty !== undefined || r.uncertainty !== undefined) {
            const uncAdd = uncertainOp(l, r, "add");
            if (uncAdd) { stack.push(uncAdd); break; }
          }
          // Fraction arithmetic stays exact when a rational already rides on an
          // operand: "1/3 + 1/3 + 1/3" is exactly 1. The sidecar check gates it
          // so this only ever PRESERVES a fraction, a plain integer sum never
          // grows one and "1e16 + 1 - 1e16" stays the double it must be.
          if (l.rational !== undefined || r.rational !== undefined) {
            const ratAdd = exactRationalOp(l, r, "add");
            if (ratAdd) { stack.push(ratAdd); break; }
          }
          const pctAdd = combinePercentage(l, r, 1);
          const ratePeriodAdd = pctAdd === null ? unifyRatePeriods(l, r) : null;
          if (pctAdd !== null) {
            stack.push(pctAdd);
          } else if (ratePeriodAdd !== null) {
            // Two rates over different periods, reconciled onto the right
            // operand's period before adding.
            stack.push(uomValue(ratePeriodAdd + r.toNumber(), r.unit!));
          } else if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(numberValue((l.value as number) + (r.value as number)));
          } else if (l.type === ValueType.Boolean && r.type === ValueType.Boolean) {
            // The word "and" is a synonym for arithmetic "+" ("5 and 3" = 8)
            // and also the boolean conjunction ("true and false"). It has its
            // own token type now (AND_CONJ, see Token.ts) rather than mapping
            // onto PLUS, but it still compiles to this opcode, because which
            // of the two meanings applies is a property of the operands rather
            // than of the word. So the dispatch stays here, where the operand
            // types are known, mirroring the Datetime/Rate special-casing
            // already done in this opcode for the same reason.
            stack.push(boolValue((l.value as boolean) && (r.value as boolean)));
          } else if (l.type === ValueType.Datetime) {
            if (r.type === ValueType.Datetime) {
              // Adding two absolute timestamps has no standard meaning
              // (unlike subtracting them, which yields a duration).
              stack.push(errorValue("INVALID_DATETIME_OP", "Cannot add two datetimes together"));
            } else {
              // Workdays, calendar months/years and whole calendar days each
              // move a date differently. See shiftDatetime()'s doc comment.
              stack.push(datetimeValue(shiftDatetime(l.toNumber(), r, 1, vm)));
            }
          } else if (l.type === ValueType.Uom && isTimecodeUnit(l.unit)) {
            // "timecode + N frames" / "timecode + duration" / "timecode +
            // timecode". See combineTimecode()'s doc comment above.
            stack.push(combineTimecode(l, r, 1));
          } else if (r.type === ValueType.Datetime) {
            // Addition commutes, so a date on the RIGHT is the same sum as a
            // date on the left. Without this it fell through to binaryOp(),
            // which reads both operands as bare numbers: "1 day + 12-25-2023"
            // answered "1,703,491,200,001 days" and "100 + 12-25-2023"
            // answered 1,703,491,200,100. Both are the date's epoch
            // milliseconds wearing the wrong type, which is a confident wrong
            // answer rather than a visible failure.
            stack.push(datetimeValue(shiftDatetime(r.toNumber(), l, 1, vm)));
          } else {
            stack.push(binaryOp(l, r, (a, b) => a + b, (a, b) => a + b, "add"));
          }
          break;
        }
        case OpCode.SUB: {
          const r = safePop(stack), l = safePop(stack);
          // Same reason as ADD above.
          const subFault = faultedOperand(l, r);
          if (subFault) { stack.push(subFault); break; }
          // Uncertainty propagates before the fraction path, same reasoning as
          // ADD: "(10 +/- 1) - (20 +/- 2)" is "-10 ± 2.24" (the spread of a
          // difference combines in quadrature exactly as a sum's does).
          if (l.uncertainty !== undefined || r.uncertainty !== undefined) {
            const uncSub = uncertainOp(l, r, "sub");
            if (uncSub) { stack.push(uncSub); break; }
          }
          // Preserve exact fractions, as ADD does above: "5/6 - 1/6 - 1/6 - 1/6
          // - 1/6 - 1/6" is exactly 0, not the 1.6e-16 the doubles drift to.
          if (l.rational !== undefined || r.rational !== undefined) {
            const ratSub = exactRationalOp(l, r, "sub");
            if (ratSub) { stack.push(ratSub); break; }
          }
          const pctSub = combinePercentage(l, r, -1);
          const ratePeriodSub = pctSub === null ? unifyRatePeriods(l, r) : null;
          if (pctSub !== null) {
            stack.push(pctSub);
          } else if (ratePeriodSub !== null) {
            stack.push(uomValue(ratePeriodSub - r.toNumber(), r.unit!));
          } else if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(numberValue((l.value as number) - (r.value as number)));
          } else if (l.type === ValueType.Datetime) {
            if (r.type === ValueType.Datetime) {
              // "now - now" used to unconditionally re-wrap the result as
              // ANOTHER Datetime, e.g. subtracting two timestamps close
              // together produced a near-Unix-epoch date ("01/01/1970,
              // 01:00:00") instead of the near-zero duration a user would
              // expect. Two datetimes subtract to a duration, not a point
              // in time, represented as a Uom in milliseconds, consistent
              // with how extractDurationMs() reads durations elsewhere.
              stack.push(uomValue(l.toNumber() - r.toNumber(), "ms"));
            } else {
              // See the matching ADD case above, and shiftDatetime()'s own
              // doc comment for why a day is not a fixed number of ms.
              stack.push(datetimeValue(shiftDatetime(l.toNumber(), r, -1, vm)));
            }
          } else if (l.type === ValueType.Uom && isTimecodeUnit(l.unit)) {
            // "timecode - timecode" (difference) / "timecode - duration"
            // see combineTimecode()'s doc comment above.
            stack.push(combineTimecode(l, r, -1));
          } else if (r.type === ValueType.Datetime) {
            // Subtraction does not commute, so unlike ADD there is nothing to
            // salvage here: taking a point in time away from a quantity that
            // is not one has no meaning. ADD already refuses "<date> +
            // <date>"; this is the same guard for the reversed operands, which
            // had none, so "100 - 12-25-2023" answered -1,703,462,399,900,
            // the date's epoch milliseconds leaking out as an ordinary number.
            stack.push(errorValue(
              "INVALID_DATETIME_OP",
              "Cannot subtract a datetime from a value that is not a datetime",
            ));
          } else {
            stack.push(binaryOp(l, r, (a, b) => a - b, (a, b) => a - b, "sub"));
          }
          break;
        }
        case OpCode.MUL: {
          const r = safePop(stack), l = safePop(stack);
          // A percentage scaling an uncertain number carries the tolerance, so
          // "(100 +/- 5) * 10%" and "10% of (100 +/- 5)" are "10 ± 0.5". This sits
          // ahead of uncertainOp, which declines for a Percentage operand.
          const pctUnc = multiplyPercentWithUncertainty(l, r);
          if (pctUnc) { stack.push(pctUnc); break; }
          // Uncertainty first, so "(12.3 +/- 0.5) * 4" is "49.2 ± 2.0": a scalar
          // multiply scales the spread by |k|, which the general quadrature rule
          // gives when the plain operand is read as uncertainty 0. uncertainOp
          // declines for a faulted or non-Number operand, so those keep their
          // own paths below. See uncertainOp().
          if (l.uncertainty !== undefined || r.uncertainty !== undefined) {
            const uncMul = uncertainOp(l, r, "mul");
            if (uncMul) { stack.push(uncMul); break; }
          }
          // Preserve exact fractions before the double fast path: "2/7 * 14" is
          // exactly 4 and "1/49 * 49" exactly 1. Gated on a rational already
          // being present, so a plain "2 * 3" pays only the two sidecar checks.
          if (l.rational !== undefined || r.rational !== undefined) {
            const ratMul = exactRationalOp(l, r, "mul");
            if (ratMul) { stack.push(ratMul); break; }
          }
          // Money times a scalar (a percentage, or a plain/computed number) stays
          // exact to the cent, the same base-ten path as "$X + p%". After the
          // rational check so "$3 * 2/7" keeps its exact fraction; ahead of
          // binaryOp, which would read both as bare doubles and drop the sidecar,
          // so "50% of 1% of $3" (a computed 0.005 factor) rounds like a till.
          const moneyScalar = multiplyMoneyByScalarExact(l, r);
          if (moneyScalar) { stack.push(moneyScalar); break; }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(numberValue((l.value as number) * (r.value as number)));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            // Genuinely different from +/-/comparisons (which stay
            // element-wise, via binaryOp() below), scalar broadcast vs.
            // real matrix product, disambiguated by shape. Must run BEFORE
            // binaryOp(), which only ever does element-wise Matrix math.
            //
            // Refused from the shapes BEFORE the multiply runs, because this is
            // the one arithmetic result whose size is the PRODUCT of two
            // separately legal operands: a 20,001x1 times a 1x20,001 is four
            // hundred million cells from two matrices of twenty thousand, and
            // that allocation aborted the process before any counter watching
            // the result could have seen it. A check rather than a charge,
            // since the result is charged once when `matrixValue()` builds it.
            checkAllocation(matrixProductCells(l.value as MatrixData, r.value as MatrixData), "matrix cells");
            stack.push(matrixMultiply(l.value as MatrixData, r.value as MatrixData));
          } else if (l.type === ValueType.Uom && isRateUnit(l.unit) && r.type === ValueType.Uom && r.unit) {
            // "30 fps × 3 minutes" -> "5,400 frames" via plain "×"/"*"
            // no package needs to route through RATE_MUL explicitly.
            stack.push(multiplyRateByMatchingUom(l, r));
          } else if (r.type === ValueType.Uom && isRateUnit(r.unit) && l.type === ValueType.Uom && l.unit) {
            // Commutative: "3 minutes × 30 fps" too.
            stack.push(multiplyRateByMatchingUom(r, l));
          } else if (moneyTimesQuantity(l, r) !== null) {
            // "$30 × 4 days" is $120: an amount of money multiplied by a
            // count of something. Without this the unit system refused it
            // outright ("Cannot combine incompatible units: USD and days"),
            // because there is no such unit as a dollar-day.
            stack.push(moneyTimesQuantity(l, r)!);
          } else {
            stack.push(binaryOp(l, r, (a, b) => a * b, (a, b) => a * b, "mul"));
          }
          break;
        }
        case OpCode.DIV: {
          const r = safePop(stack), l = safePop(stack);
          // Dividing an uncertain number BY a percentage is a scalar divide, so
          // it carries the tolerance: "(100 +/- 5) / 10%" is "1000 ± 50". This
          // sits ahead of uncertainOp, which declines for a Percentage divisor.
          const pctDivUnc = dividePercentWithUncertainty(l, r);
          if (pctDivUnc) { stack.push(pctDivUnc); break; }
          // Uncertainty first, ahead of both the Uom ratio and the exact-fraction
          // paths below, so a carried tolerance is never dropped by either.
          // uncertainOp declines unless both operands are plain Numbers, so
          // "$10 / 2" and "1/3" are untouched. See uncertainOp().
          if (l.uncertainty !== undefined || r.uncertainty !== undefined) {
            const uncDiv = uncertainOp(l, r, "div");
            if (uncDiv) { stack.push(uncDiv); break; }
          }
          if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { lv, rv, sameMeasure } = unifyUom(l, r);
            if (sameMeasure) {
              stack.push(numberValue(lv / rv));
            } else if (sharedCurrencyExchange.isCurrency(l.unit!) && sharedCurrencyExchange.isCurrency(r.unit!)) {
              // Both currencies, but unifyUom couldn't reconcile them (no
              // live rate cached yet), an honest failure, not a rate:
              // "$X per €Y" isn't a meaningful derived unit the way
              // "km/day" is, so this stays INCOMPATIBLE_UNITS rather than
              // silently becoming a nonsensical currency-pair rate.
              stack.push(errorValue("INCOMPATIBLE_UNITS", `Cannot combine incompatible units: ${l.unit} and ${r.unit}`));
            } else {
              // Genuinely different measures (e.g. "90 km / 3 day")
              // construct a Rate rather than erroring, now that this
              // codebase has a compound/derived-unit representation (see
              // vm/Value.ts's rateValue()), matches RATE_DIV's explicit
              // construction opcode, but reachable via plain "/" too.
              stack.push(rateValue(lv / rv, l.unit!, r.unit!));
            }
          } else {
            // Integer division is the producer of exact fractions: "1/3" seeds
            // the rational 1/3 that the rest of the system carries, so "1/3 + 1/3
            // + 1/3" is exactly 1 and "1/3 as fraction" is exact. exactRationalOp
            // declines for a non-integer operand, a bigint, or a zero divisor, so
            // "1.5 / 0.25" and "1/0" keep the doubles binaryOp gives and "100n /
            // 3n" stays exact integer division. The reduced result's nearest
            // double equals the plain "a / b" quotient, so "10 / 4" is 2.5 and
            // every existing division result is unchanged.
            const ratDiv = exactRationalOp(l, r, "div");
            if (ratDiv) { stack.push(ratDiv); break; }
            // The bigint arm refuses a zero divisor rather than letting V8's
            // own RangeError out. See bigIntDivisionByZero() for why this is
            // an error while `1 / 0` is Infinity.
            stack.push(binaryOp(l, r, (a, b) => a / b, (a, b) => { if (b === 0n) throw bigIntDivisionByZero(); return a / b; }, "div"));
          }
          break;
        }
        case OpCode.MOD: {
          const r = safePop(stack), l = safePop(stack);
          // Same zero case as DIV above, and refused the same way: a
          // remainder is defined in terms of the quotient, so where one has
          // no answer neither does the other.
          stack.push(binaryOp(l, r, (a, b) => a % b, (a, b) => { if (b === 0n) throw bigIntDivisionByZero(); return a % b; }));
          break;
        }
        case OpCode.EXP: {
          const r = safePop(stack), l = safePop(stack);
          // Unlike ADD/SUB/MUL/DIV/MOD, EXP never routed through
          // binaryOp() (VMConversion.ts), it called Math.pow() on raw
          // toNumber() output unconditionally, so it needs its own
          // Error/Pending short-circuit for the same reason binaryOp()
          // now has one: toNumber() returns 0 for both, so
          // `errorValue ^ 2` used to silently become `0`.
          if (l.type === ValueType.Error) { stack.push(l); break; }
          if (r.type === ValueType.Error) { stack.push(r); break; }
          if (l.type === ValueType.Pending) { stack.push(l); break; }
          if (r.type === ValueType.Pending) { stack.push(r); break; }
          // Plain numbers first, so the overwhelmingly common case pays for no
          // extra type test beyond the ones already above it.
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(numberValue(power(l.value as number, r.value as number)));
            break;
          }
          // A Matrix operand means matrix exponentiation, which is repeated
          // matrix multiplication and not the element-wise Math.pow the rest
          // of this case does. Falling through was the same silent-zero shape
          // the symbolic branch below documents: MatrixData.toNumber() is 0,
          // so `[1,2;3,4]^2` answered 0 and `2^[1,2;3,4]` answered 1. `^T` and
          // `^-1` never reach here, PrecedenceParser's caret-suffix rules take
          // both at parse time, so every remaining shape that is not "square
          // matrix to a whole non-negative power" is refused by name.
          if (l.type === ValueType.Matrix || r.type === ValueType.Matrix) {
            if (l.type !== ValueType.Matrix || r.type !== ValueType.Number) {
              stack.push(errorValue(
                "MATRIX_POWER_UNSUPPORTED",
                `^: a matrix may only be the base, raised to a whole number (as in "[1,2;3,4]^2"); "${ValueType[l.type]} ^ ${ValueType[r.type]}" has no matrix reading.`,
              ));
              break;
            }
            // Checked against the whole repeated-squaring run rather than the
            // answer alone, so a hopeless exponent is refused before the first
            // multiplication instead of at whichever step happens to cross the
            // line. See {@link matrixPowerCells}. Each intermediate matrix is
            // still charged as `matrixValue()` builds it.
            checkAllocation(matrixPowerCells(l.value as MatrixData, r.value as number), "matrix cells");
            stack.push(matrixPower(l.value as MatrixData, r.value as number));
            break;
          }
          // A symbolic operand has to build a `pow` node. Falling through to
          // Math.pow() here is what made `x^2` evaluate to 0, silently, since
          // Value.toNumber() reports 0 for a symbolic value.
          if (l.type === ValueType.Symbolic || r.type === ValueType.Symbolic) {
            stack.push(symbolicPow(l, r));
            break;
          }
          // A bigint operand raised to a whole power has an exact answer, and
          // Math.pow does not give it: `2n ^ 100` came back as
          // 1.2676506002282294e+30, a double's approximation of the very
          // integer this type exists to hold. See exactPowBits() for when an
          // exact answer exists at all, and for why there is a size limit.
          if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            const powBits = exactPowBits(l, r.toNumber());
            if (powBits !== null) {
              // Past the ceiling this refuses rather than handing the sum back
              // to the double path, which would report a 30,103-digit integer
              // as Infinity. See MAX_EXACT_POW_BITS for the decision.
              if (powBits > MAX_EXACT_POW_BITS) {
                throw ErrorFactory.execution(
                  "BIGINT_POW_LIMIT_EXCEEDED",
                  `That power would build an exact integer of about ${Math.round(powBits).toLocaleString("en-US")} bits, past the limit of ${MAX_EXACT_POW_BITS.toLocaleString("en-US")} bits`,
                  { limitBits: MAX_EXACT_POW_BITS },
                );
              }
              stack.push(bigIntValue(bigIntPow(toBigIntOperand(l), toBigIntOperand(r))));
              break;
            }
            // A fractional or negative exponent has no bigint answer at all
            // (`4n ^ 0.5` is 2 and `2n ^ -1` is 0.5), so those keep the double
            // path below, which is their right answer rather than a fallback.
          }
          stack.push(numberValue(power(l.toNumber(), r.toNumber())));
          break;
        }
        case OpCode.NEG: {
          const v = safePop(stack);
          // A negated fault is still a fault, and `-0` looks like an answer.
          const negFault = faultedOperand(v);
          if (negFault) { stack.push(negFault); break; }
          if (v.type === ValueType.BigInt) stack.push(bigIntValue(-(v.value as bigint)));
          // Negating money keeps it exact: "-$0.10" is exactly "-$0.10".
          else if (v.type === ValueType.Uom && v.exact !== undefined) stack.push(uomValueExact(-v.toNumber(), v.unit!, decimalNegate(v.exact)));
          else if (v.type === ValueType.Uom) stack.push(uomValue(-v.toNumber(), v.unit!));
          // A negated percentage is still a percentage, for the same reason a
          // negated Uom is still measured in the same unit. Without this
          // branch `-10%` became the bare number -0.1, and every rule that
          // reads a Percentage operand stopped seeing one: `200 + -10%`
          // answered 199.9 (200 plus a tenth) instead of 180, `$300 + -15%`
          // answered $299.85 instead of $255, and `-10%` displayed as "-0.10".
          else if (v.type === ValueType.Percentage) stack.push(percentageValue(-v.toNumber()));
          // Without this branch, unary minus on a free variable produced `-0`,
          // for the same toNumber() reason as EXP above.
          else if (v.type === ValueType.Symbolic) stack.push(symbolicNeg(v));
          // Negating a fraction keeps it exact: "-(1/3)" carries the rational
          // -1/3, so it still reads back exactly through "as fraction".
          else if (v.type === ValueType.Number && v.rational !== undefined) stack.push(numberValueRational(-v.toNumber(), rationalNeg(v.rational)));
          // Negating a decimal literal keeps its exact decimal, the same way
          // money above does, so "-1.005 to 2 dp" rounds the exact -1.005 half
          // away from zero to -1.01 rather than dropping to the drifted double
          // (-1.00499...) the float path rounds toward zero.
          else if (v.type === ValueType.Number && v.exact !== undefined) stack.push(numberValueExact(-v.toNumber(), decimalNegate(v.exact)));
          else stack.push(numberValue(-v.toNumber()));
          break;
        }
        case OpCode.POS: {
          const v = safePop(stack);
          const posFault = faultedOperand(v);
          if (posFault) { stack.push(posFault); break; }
          // Unary plus is a no-op, so money keeps its exact decimal too.
          if (v.type === ValueType.Uom && v.exact !== undefined) stack.push(uomValueExact(v.toNumber(), v.unit!, v.exact));
          else if (v.type === ValueType.Uom) stack.push(uomValue(v.toNumber(), v.unit!));
          // Unary plus is a no-op, so it has to leave the type alone too.
          else if (v.type === ValueType.Percentage) stack.push(percentageValue(v.toNumber()));
          // A no-op keeps a fraction's exact rational, the same way it keeps
          // money's exact decimal above.
          else if (v.type === ValueType.Number && v.rational !== undefined) stack.push(numberValueRational(v.toNumber(), v.rational));
          // And it keeps a decimal literal's exact decimal, so "+1.005" is still
          // exactly 1.005 for a later "to 2 dp".
          else if (v.type === ValueType.Number && v.exact !== undefined) stack.push(numberValueExact(v.toNumber(), v.exact));
          else stack.push(numberValue(v.toNumber()));
          break;
        }
        case OpCode.MAKE_UNCERTAIN: {
          // `center ± spread`: the parselet pushed the center first, then the
          // spread, so the spread pops first. A faulted operand propagates
          // rather than being read as a zero center or spread.
          const spread = safePop(stack), center = safePop(stack);
          const uncFault = faultedOperand(center, spread);
          if (uncFault) { stack.push(uncFault); break; }
          // The center is the measured value, the spread its one-sigma tolerance.
          // The spread is taken as a magnitude, so "5 +/- -2" reads the same as
          // "5 +/- 2". Only a plain-number center carries an uncertainty (a unit
          // or other typed center falls back to its bare magnitude, units with
          // uncertainty are out of scope for this slice).
          stack.push(numberValueUncertain(center.toNumber(), Math.abs(spread.toNumber())));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §4  Bitwise  (OpCode 30–36)
        //     None of these routes through binaryOp(), so each one carries
        //     its own faulted-operand check for the reason that function
        //     documents: a bit pattern read off an Error or a Pending is the
        //     bit pattern of zero, and `(5 kg to m) & 1` answered 0 with
        //     nothing to say it had not been asked a real question.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.LSHIFT: {
          const r = safePop(stack), l = safePop(stack);
          const shiftFault = faultedOperand(l, r);
          if (shiftFault) { stack.push(shiftFault); break; }
          if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            // Bounded, unlike the plain-number path below, which cannot grow:
            // a 32-bit shift is 32 bits whatever it is asked for. See
            // bigIntShift().
            stack.push(bigIntShift(l, r, 1));
          } else {
            stack.push(numberValue(l.toNumber() << r.toNumber()));
          }
          break;
        }
        case OpCode.RSHIFT: {
          const r = safePop(stack), l = safePop(stack);
          const rshiftFault = faultedOperand(l, r);
          if (rshiftFault) { stack.push(rshiftFault); break; }
          if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            stack.push(bigIntShift(l, r, -1));
          } else {
            stack.push(numberValue(l.toNumber() >> r.toNumber()));
          }
          break;
        }
        case OpCode.URSHIFT: {
          const r = safePop(stack), l = safePop(stack);
          // No BigInt branch, unlike its siblings above. `>>>` is defined on a
          // 32-bit unsigned word and JavaScript refuses it on a BigInt, so
          // there is nothing to widen to: BigInt(-8) >>> 1n is a TypeError, not
          // a large number. Both operands go through the 32-bit path.
          const urshiftFault = faultedOperand(l, r);
          if (urshiftFault) { stack.push(urshiftFault); break; }
          stack.push(numberValue(l.toNumber() >>> r.toNumber()));
          break;
        }
        case OpCode.BIT_AND: {
          const r = safePop(stack), l = safePop(stack);
          const andFault = faultedOperand(l, r);
          if (andFault) { stack.push(andFault); break; }
          if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            stack.push(bigIntValue(toBigIntOperand(l) & toBigIntOperand(r)));
          } else {
            stack.push(numberValue(l.toNumber() & r.toNumber()));
          }
          break;
        }
        case OpCode.BIT_OR: {
          const r = safePop(stack), l = safePop(stack);
          const orFault = faultedOperand(l, r);
          if (orFault) { stack.push(orFault); break; }
          if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            stack.push(bigIntValue(toBigIntOperand(l) | toBigIntOperand(r)));
          } else {
            stack.push(numberValue(l.toNumber() | r.toNumber()));
          }
          break;
        }
        case OpCode.BIT_XOR: {
          const r = safePop(stack), l = safePop(stack);
          const xorFault = faultedOperand(l, r);
          if (xorFault) { stack.push(xorFault); break; }
          if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            stack.push(bigIntValue(toBigIntOperand(l) ^ toBigIntOperand(r)));
          } else {
            stack.push(numberValue(l.toNumber() ^ r.toNumber()));
          }
          break;
        }
        case OpCode.BIT_NOT: {
          const v = safePop(stack);
          const notFault = faultedOperand(v);
          if (notFault) { stack.push(notFault); break; }
          if (v.type === ValueType.BigInt) stack.push(bigIntValue(~(v.value as bigint)));
          else stack.push(numberValue(~v.toNumber()));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §4b Comparison  (OpCode 40–45)
        //     Numeric fast path when both operands are Number;
        //     all six unify UoM operands before comparing them.
        //
        //     The four ordering opcodes used to skip that unification and
        //     compare the bare magnitudes, so `1 km > 500 m` answered false
        //     and `30 min < 1 hour` answered false as well. They now go
        //     through compareUom() like EQ/NEQ, which also means they agree
        //     with EQ about where the boundary between "less" and "equal"
        //     falls: `equal` there is a tolerance rather than `===`, so a
        //     pair EQ calls equal is one GT and LT both call false.
        //
        //     Two units that share no measure cannot be ordered at all, so
        //     the four ordering opcodes answer with an error rather than a
        //     boolean. EQ and NEQ still answer with a boolean, because
        //     "a kilogram is not a metre" is a true statement about a pair
        //     that cannot be converted, whereas "a kilogram is less than a
        //     metre" is not a statement at all.
        //
        //     A faulted operand is the second case even for EQ and NEQ, and
        //     all six propagate it. A kilogram is a quantity that is not a
        //     metre; an Error is not a quantity, so there is nothing for it
        //     to be equal to. Reading its number gave zero, which made
        //     `(5 kg to m) == 0` answer true.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.EQ: {
          const r = safePop(stack), l = safePop(stack);
          const eqFault = faultedOperand(l, r);
          if (eqFault) { stack.push(eqFault); break; }
          // Equal fractions are equal on the value, not on whichever doubles
          // they rounded to: "1/49 * 49 == 1" is true. Gated on a rational being
          // present, so "1 == 1" keeps its double compare below.
          if (l.rational !== undefined || r.rational !== undefined) {
            const cmp = compareRationalOperands(l, r);
            if (cmp !== null) { stack.push(boolValue(cmp === 0)); break; }
          }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(boolValue((l.value as number) === (r.value as number)));
          } else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            // Comparing through toNumber() rounds a bigint to the nearest
            // double first, so two giants a single digit apart landed on the
            // same double and this answered true. See compareBigIntOperands().
            const cmp = compareBigIntOperands(l, r);
            stack.push(boolValue(cmp === null ? l.toNumber() === r.toNumber() : cmp === 0));
          } else if (l.type === ValueType.String && r.type === ValueType.String) {
            // Two strings compare as strings. Through toNumber() every
            // non-numeric string reads as 0, so `"a" == "b"` answered true.
            stack.push(boolValue((l.value as string) === (r.value as string)));
          } else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { equal, sameMeasure } = compareUom(l, r);
            stack.push(boolValue(sameMeasure && equal));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            stack.push(matrixCompare(l.value as MatrixData, r.value as MatrixData, (a, b) => a === b));
          } else if (l.type === ValueType.Colour || r.type === ValueType.Colour) {
            // A colour equals only another colour with the same canonical
            // channels, so `#ff0000 == rgb(255,0,0)` is true regardless of
            // format. A colour and a non-colour are never equal: NOT via
            // toNumber() (0 for a colour), which would make `#000000 == 0` true,
            // exactly the coercion fault this repo guards against.
            if (l.type === ValueType.Colour && r.type === ValueType.Colour) {
              const a = l.value as ColourData, b = r.value as ColourData;
              stack.push(boolValue(a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a));
            } else {
              stack.push(boolValue(false));
            }
          } else {
            stack.push(boolValue(l.toNumber() === r.toNumber()));
          }
          break;
        }
        case OpCode.NEQ: {
          const r = safePop(stack), l = safePop(stack);
          const neqFault = faultedOperand(l, r);
          if (neqFault) { stack.push(neqFault); break; }
          // The negation of EQ's rational branch, fraction for fraction.
          if (l.rational !== undefined || r.rational !== undefined) {
            const cmp = compareRationalOperands(l, r);
            if (cmp !== null) { stack.push(boolValue(cmp !== 0)); break; }
          }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(boolValue((l.value as number) !== (r.value as number)));
          } else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            // The negation of EQ's bigint branch above, digit for digit.
            const cmp = compareBigIntOperands(l, r);
            stack.push(boolValue(cmp === null ? l.toNumber() !== r.toNumber() : cmp !== 0));
          } else if (l.type === ValueType.String && r.type === ValueType.String) {
            stack.push(boolValue((l.value as string) !== (r.value as string)));
          } else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { equal, sameMeasure } = compareUom(l, r);
            stack.push(boolValue(!sameMeasure || !equal));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            stack.push(matrixCompare(l.value as MatrixData, r.value as MatrixData, (a, b) => a !== b));
          } else if (l.type === ValueType.Colour || r.type === ValueType.Colour) {
            // The negation of EQ's colour branch: two colours differ by channel,
            // and a colour and a non-colour are always unequal.
            if (l.type === ValueType.Colour && r.type === ValueType.Colour) {
              const a = l.value as ColourData, b = r.value as ColourData;
              stack.push(boolValue(!(a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a)));
            } else {
              stack.push(boolValue(true));
            }
          } else {
            stack.push(boolValue(l.toNumber() !== r.toNumber()));
          }
          break;
        }
        case OpCode.LT: {
          const r = safePop(stack), l = safePop(stack);
          const ltFault = faultedOperand(l, r);
          if (ltFault) { stack.push(ltFault); break; }
          if (l.rational !== undefined || r.rational !== undefined) {
            const cmp = compareRationalOperands(l, r);
            if (cmp !== null) { stack.push(boolValue(cmp < 0)); break; }
          }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(boolValue((l.value as number) < (r.value as number)));
          } else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            // Digit-exact, for the reason given on EQ's matching branch.
            const cmp = compareBigIntOperands(l, r);
            stack.push(boolValue(cmp === null ? l.toNumber() < r.toNumber() : cmp < 0));
          } else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { lv, rv, equal, sameMeasure } = compareUom(l, r);
            stack.push(sameMeasure ? boolValue(!equal && lv < rv) : incomparableUnitsError(l, r));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            stack.push(matrixCompare(l.value as MatrixData, r.value as MatrixData, (a, b) => a < b));
          } else {
            stack.push(boolValue(l.toNumber() < r.toNumber()));
          }
          break;
        }
        case OpCode.LTE: {
          const r = safePop(stack), l = safePop(stack);
          const lteFault = faultedOperand(l, r);
          if (lteFault) { stack.push(lteFault); break; }
          if (l.rational !== undefined || r.rational !== undefined) {
            const cmp = compareRationalOperands(l, r);
            if (cmp !== null) { stack.push(boolValue(cmp <= 0)); break; }
          }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(boolValue((l.value as number) <= (r.value as number)));
          } else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            const cmp = compareBigIntOperands(l, r);
            stack.push(boolValue(cmp === null ? l.toNumber() <= r.toNumber() : cmp <= 0));
          } else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { lv, rv, equal, sameMeasure } = compareUom(l, r);
            stack.push(sameMeasure ? boolValue(equal || lv <= rv) : incomparableUnitsError(l, r));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            stack.push(matrixCompare(l.value as MatrixData, r.value as MatrixData, (a, b) => a <= b));
          } else {
            stack.push(boolValue(l.toNumber() <= r.toNumber()));
          }
          break;
        }
        case OpCode.GT: {
          const r = safePop(stack), l = safePop(stack);
          const gtFault = faultedOperand(l, r);
          if (gtFault) { stack.push(gtFault); break; }
          if (l.rational !== undefined || r.rational !== undefined) {
            const cmp = compareRationalOperands(l, r);
            if (cmp !== null) { stack.push(boolValue(cmp > 0)); break; }
          }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(boolValue((l.value as number) > (r.value as number)));
          } else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            const cmp = compareBigIntOperands(l, r);
            stack.push(boolValue(cmp === null ? l.toNumber() > r.toNumber() : cmp > 0));
          } else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { lv, rv, equal, sameMeasure } = compareUom(l, r);
            stack.push(sameMeasure ? boolValue(!equal && lv > rv) : incomparableUnitsError(l, r));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            stack.push(matrixCompare(l.value as MatrixData, r.value as MatrixData, (a, b) => a > b));
          } else {
            stack.push(boolValue(l.toNumber() > r.toNumber()));
          }
          break;
        }
        case OpCode.GTE: {
          const r = safePop(stack), l = safePop(stack);
          const gteFault = faultedOperand(l, r);
          if (gteFault) { stack.push(gteFault); break; }
          if (l.rational !== undefined || r.rational !== undefined) {
            const cmp = compareRationalOperands(l, r);
            if (cmp !== null) { stack.push(boolValue(cmp >= 0)); break; }
          }
          if (l.type === ValueType.Number && r.type === ValueType.Number) {
            stack.push(boolValue((l.value as number) >= (r.value as number)));
          } else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
            const cmp = compareBigIntOperands(l, r);
            stack.push(boolValue(cmp === null ? l.toNumber() >= r.toNumber() : cmp >= 0));
          } else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
            const { lv, rv, equal, sameMeasure } = compareUom(l, r);
            stack.push(sameMeasure ? boolValue(equal || lv >= rv) : incomparableUnitsError(l, r));
          } else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
            stack.push(matrixCompare(l.value as MatrixData, r.value as MatrixData, (a, b) => a >= b));
          } else {
            stack.push(boolValue(l.toNumber() >= r.toNumber()));
          }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §4c Logical / conditional select  (OpCode 130–132)
        //
        //     Truthiness is read through isTruthy(), which reads a number,
        //     which is zero for a fault, so a failed operand used to be
        //     quietly false. Both operands are already evaluated by the time
        //     either opcode runs (this VM has no branch opcodes), so there is
        //     no short-circuit to preserve by ignoring the right-hand one.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.LOGICAL_AND: {
          const r = safePop(stack), l = safePop(stack);
          const andLogicFault = faultedOperand(l, r);
          if (andLogicFault) { stack.push(andLogicFault); break; }
          stack.push(boolValue(isTruthy(l) && isTruthy(r)));
          break;
        }
        case OpCode.LOGICAL_OR: {
          const r = safePop(stack), l = safePop(stack);
          const orLogicFault = faultedOperand(l, r);
          if (orLogicFault) { stack.push(orLogicFault); break; }
          stack.push(boolValue(isTruthy(l) || isTruthy(r)));
          break;
        }
        case OpCode.SELECT: {
          // Eager ternary: both branches are ALREADY evaluated and on the
          // stack by the time this opcode runs (this VM has no jump/branch
          // opcodes. See OpCode.ts's comment on SELECT for why that's an
          // intentional simplification, not an oversight). Stack order
          // (bottom to top) matches the natural parse order of "if
          // condition then thenVal else elseVal": [condition, thenVal, elseVal].
          const elseVal = safePop(stack);
          const thenVal = safePop(stack);
          const condition = safePop(stack);
          // Only the CONDITION is checked for a fault, unlike every other
          // opcode here. Both arms are already evaluated, and the arm that is
          // not chosen is not part of the answer: refusing `if 1 then 2 else
          // (5 kg to m)` would report a failure the reader's own line never
          // asked about. A faulted condition selects nothing, so it stands.
          const conditionFault = faultedOperand(condition);
          if (conditionFault) { stack.push(conditionFault); break; }
          stack.push(isTruthy(condition) ? thenVal : elseVal);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §5  Functions  (OpCode 50–52)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.CALL_PLUGIN: {
          const fnIdx = operandByte(opcodes, ip++, op, "plugin-function index");
          const argCount = operandByte(opcodes, ip++, op, "argument count");
          const args: Value[] = [];
          for (let i = 0; i < argCount; i++) args.push(safePop(stack));
          args.reverse();
          const fn = vm.context.pluginFunctions[fnIdx];
          // A plugin handler reads its arguments the same way a builtin does,
          // and none of them can do anything useful with an argument that
          // failed or has not arrived: the call would be made with a zero, or
          // with a query built from one. Checked here rather than in each
          // handler, for the same reason the arity check below lives at the
          // dispatch point.
          const pluginArgFault = faultedIn(args);
          if (pluginArgFault) {
            stack.push(pluginArgFault);
          } else if (!fn) {
            stack.push(numberValue(0));
          } else {
            const result = fn(args, context);
            if (result instanceof Promise) {
              // Return pending result, no throw. The orchestrator checks
              // result.type and handles async resolution outside the VM.
              // The pluginId + domain are embedded in the cache key format:
              //   {pluginId}:{domain}:{fnIdx}:{hash(args)}
              // We use a deterministic key from fnIdx + args for now;
              // the engine scopes it by pluginId before storing.
              const cacheKey = `plugin:${fnIdx}:${args.map(a => String(a.value ?? '')).join('|')}`;
              // activeSignal must be set by the engine before calling executeBytecode.
              // If it's not (bug), we use a new signal that will never abort
              // this is a safety net, not the expected path.
              const signal = vm.activeSignal!;
              // The owning package, so a failed or slow async call can be attributed.
              // Falls back to the empty string only for a handler installed
              // directly into a context rather than through registerPackage.
              const packageId = vm.context.pluginFunctionOwners[fnIdx] ?? '';
              return { type: 'pending', queryKey: cacheKey, resolver: result, packageId, signal };
            }
            stack.push(result);
          }
          break;
        }
        case OpCode.CALL_BUILTIN: {
          const fnIdx = operandByte(opcodes, ip++, op, "builtin-function index");
          const argCount = operandByte(opcodes, ip++, op, "argument count");
          // Argument count first, before anything is popped. Every builtin
          // indexes its args positionally with no length check of its own, so
          // `sqrt()` used to reach `args[0].toNumber()` on an empty array and
          // throw a raw TypeError that arrived at the host as an INTERNAL
          // engine bug naming no function. This is the only place that knows
          // both the index and the count; see vm/VMBuiltinArity.ts.
          const arityError = builtinArityError(fnIdx, argCount);
          if (arityError) throw arityError;
          const args: Value[] = [];
          // The symbolic flag is tracked while popping rather than by a second
          // pass, so the ordinary numeric call pays one type comparison per
          // argument and nothing else.
          let sawSymbolic = false;
          for (let i = 0; i < argCount; i++) {
            const arg = safePop(stack);
            if (arg.type === ValueType.Symbolic) sawSymbolic = true;
            args.push(arg);
          }
          // The same argument as the symbolic routing below, for the operand
          // type that has no reading at all rather than a non-numeric one:
          // every implementation reads args[n].toNumber(), which is 0 for an
          // Error and for a Pending, so `abs(5 kg to m)` answered 0 and
          // `round(<a price still loading>)` answered 0 as well. One check
          // here covers all ~90 of them; see faultedOperand() in vm/Value.ts.
          const builtinArgFault = faultedIn(args);
          if (builtinArgFault) { stack.push(builtinArgFault); break; }
          const fn = builtinFunctions[fnIdx];
          if (fn) {
            const ordered = args.reverse();
            // One dispatch point covers all ~60 builtins. Each of their
            // implementations reads args[n].toNumber(), which reports 0 for a
            // symbolic operand, so routing here is what stops `sqrt(x)` from
            // quietly returning 0. An index with no symbolic reading comes back
            // as an error rather than a number computed from that placeholder.
            // The algebra verbs are the exception: they exist to take an
            // expression containing unknowns, so they run their own handler.
            const routeSymbolically = sawSymbolic && !SYMBOLIC_NATIVE_BUILTINS.has(fnIdx);
            stack.push(routeSymbolically ? symbolicBuiltin(fnIdx, ordered) : fn(ordered));
          }
          break;
        }
        case OpCode.DEFINE_USER_FUNCTION: {
          // Registration happens HERE, at execution time, not at parse
          // time, so a diagnostic/lookahead parse of a definition line
          // that never actually executes (syntax highlighting, autocomplete
          // preview, ...) has no side effect on vm.userFunctions. See
          // BytecodeBuilder.ts's UserFunctionDef doc comment.
          const bodyIdx = operandByte(opcodes, ip++, op, "function-body index");
          const def = userFunctionBodies?.[bodyIdx];
          if (!def) {
            // A compiler/VM invariant violation, not user-input, a
            // mismatched bodyIdx means the bytecode compiler and this
            // dispatch loop disagree about userFunctionBodies' contents,
            // never something reachable by writing a normal `f(x) = ...`
            // expression correctly. See ErrorCode.ts's own catalog comment.
            throw ErrorFactory.internal(
              "INTERNAL_MISSING_FUNCTION_BODY",
              `Internal error: DEFINE_USER_FUNCTION referenced missing body index ${bodyIdx}`,
              { bodyIdx },
            );
          }
          vm.defineUserFunction(def.name, def.params, def.program);
          break;
        }
        case OpCode.CALL_USER_FUNCTION: {
          // User-defined, parameterized, reusable functions. `name`'s body
          // was compiled to its OWN independent BytecodeProgram at
          // definition time, parameter references inside it are ORDINARY
          // LOAD_VAR opcodes (see BytecodeBuilder.ts's UserFunctionDef doc
          // comment for why), resolved dynamically via the call frame
          // pushed below. Re-executing the body here is a genuinely
          // reentrant executeBytecode() call sharing this same `vm`/stack
          // safe because any valid bytecode program, run to completion,
          // leaves exactly one net value on the stack, the same invariant
          // every other expression already relies on.
          const name = poolString(opcodes, ip++, strings, op, "function-name index");
          const argCount = operandByte(opcodes, ip++, op, "argument count");
          const args: Value[] = [];
          for (let i = 0; i < argCount; i++) args.push(safePop(stack));
          args.reverse();
          const fn = vm.getUserFunction(name);
          if (!fn) {
            throw ErrorFactory.execution("UNDEFINED_FUNCTION", `Undefined function: ${name}`, { name });
          }
          if (argCount !== fn.params.length) {
            throw ErrorFactory.execution(
              "FUNCTION_ARITY_MISMATCH",
              `${name} expects ${fn.params.length} argument(s) but got ${argCount}`,
              { name, expected: fn.params.length, actual: argCount },
            );
          }
          const frame = new Map<string, Value>();
          for (let i = 0; i < fn.params.length; i++) frame.set(fn.params[i], args[i]);
          // Two guards, because they bound two different numbers and each is
          // blind to the other's case.
          //
          // pushCallFrame() throws FUNCTION_RECURSION_LIMIT_EXCEEDED before
          // ever reaching the reentrant executeBytecode() call below if
          // this would exceed maxFunctionRecursionDepth, the backstop for
          // f(x) = f(x), which would otherwise recurse via nested
          // executeBytecode() calls (each with its OWN fresh
          // localInstructionCount, so maxInstructions cannot catch this)
          // until the native V8 stack overflows uncatchably.
          //
          // chargeFunctionCall() bounds how MANY calls this evaluation makes
          // rather than how deeply they nest, which the depth guard cannot
          // see: `f(n)(v) = f(n-1)(v) + f(n-1)(v)` over twenty-two lines nests
          // twenty-two deep and calls two million times, and killed the
          // process. It is charged here rather than counted in the VM because
          // the tally has to survive the reentrant call below, exactly like
          // the allocation tally and unlike localInstructionCount.
          chargeFunctionCall();
          vm.pushCallFrame(frame);
          let bodyResult: EvalResult;
          try {
            bodyResult = executeBytecode(fn.program, vm, pipeline, expression, context);
          } finally {
            // Always pop, even if the body throws, an uncaught error inside
            // one call must not leave a stale frame poisoning whatever
            // (unrelated) expression runs next.
            vm.popCallFrame();
          }
          if (bodyResult.type === "pending") {
            // v1 scope decision: a user function's body calling an async
            // plugin function (weather, stocks, ...) isn't supported yet
            // propagating a 'pending' result up through a reentrant
            // executeBytecode() call would need the OUTER expression's own
            // bytecode position/stack state to also be resumable later,
            // which this first pass doesn't implement. Also rejected at
            // DEFINITION time (see PrecedenceParser.ts's
            // parseUserFunctionDefinition). This is a defense-in-depth
            // backstop, not the primary guard.
            throw ErrorFactory.execution(
              "USER_FUNCTION_ASYNC_UNSUPPORTED",
              `${name}: user-defined functions with async bodies (weather, stocks, currency, ...) aren't supported`,
              { name },
            );
          }
          if (bodyResult.type === "error") {
            // A controlled internal-invariant error inside the body, surface
            // it as-is rather than swallowing/rewrapping (same convention as
            // unwrapEvalResult()).
            throw bodyResult.error;
          }
          stack.push(bodyResult.value);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §6  Variables  (OpCode 60–63)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.LOAD_VAR: {
          const varName = poolString(opcodes, ip++, strings, op, "variable-name index");
          const val = vm.getVar(varName);
          if (val !== undefined) {
            stack.push(val);
          } else if (symbolicTolerant) {
            stack.push(symbolicValue(varSymbolicNode(varName)));
          } else {
            throw ErrorFactory.execution(
              "UNDEFINED_VARIABLE",
              `Undefined variable: ${varName}`,
              { varName },
            );
          }
          break;
        }
        case OpCode.STORE_VAR: {
          const val = safePop(stack);
          const varName = poolString(opcodes, ip++, strings, op, "variable-name index");
          vm.setVar(varName, hasArena ? persistentValue(val) : val);
          stack.push(val);
          break;
        }
        case OpCode.LOAD_GLOBAL_VAR: {
          // GlobalVariableAsyncResolver's preflight() runs BEFORE the VM ever
          // reaches this opcode and is SUPPOSED to intercept the "not yet
          // declared by any loaded document" case (returning a Pending value
          // up front, mirroring how currency conversion's preflight
          // intercepts before UOM_CONVERT_TO runs), but that invariant is
          // confirmed violable: ThreeTierEvaluator's Tier 2 (executeCached())
          // can mark a line "clean" and skip straight to VM execution without
          // ever running preflightAll() (see ARCHITECTURE.md §7's P0 item
          // still open, gated on the larger L1 migration). This used to be a
          // bare `!` non-null assertion, a raw, uncontrolled TypeError the
          // instant that invariant was violated, rather than a controlled
          // error. Explicit check instead: the read is still expected to
          // always succeed in the common case, but "expected to always
          // succeed" was exactly the wrong assumption that produced the
          // Tier-2 bypass bug in the first place.
          const varName = poolString(opcodes, ip++, strings, op, "variable-name index");
          const globalValue = sharedGlobalVariableStore.get(varName);
          if (globalValue === undefined) {
            // .internal(), not .execution(): this is the Tier-2/preflight-
            // bypass invariant violation described above, not something an
            // ordinary user expression can trigger by itself, the
            // precondition ("preflight already ran") is the CALLER's
            // (ThreeTierEvaluator's) responsibility, not the user's.
            throw ErrorFactory.internal({
              code: "GLOBAL_VARIABLE_NOT_RESOLVED",
              message: `Global variable "${varName}" was read before it resolved`,
              expected: `global variable "${varName}" to already be resolved (async preflight should guarantee this)`,
              found: "no value in the global variable store",
              context: { varName },
            });
          }
          stack.push(globalValue);
          break;
        }
        case OpCode.STORE_GLOBAL_VAR: {
          const val = safePop(stack);
          const varName = poolString(opcodes, ip++, strings, op, "variable-name index");
          // Persisting here matters even more than for STORE_VAR: a global
          // outlives not just this call's own VM but every OTHER document's
          // arena-reset cycles too. An un-persisted arena Value stored here
          // would get silently corrupted by a later, unrelated arena
          // allocation in ANY document, not just this one.
          sharedGlobalVariableStore.set(varName, hasArena ? persistentValue(val) : val);
          stack.push(val);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §7  Type conversions  (OpCode 70–74, 140–145)
        //     Every one of these restates a number in another notation, so a
        //     faulted operand has nothing to restate and each propagates it
        //     rather than converting the zero toNumber() reports. Without it
        //     "(5 kg to m) as hex" answered 0x0 and "as binary" answered 0b0.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.TO_NUMBER: {
          const v = safePop(stack);
          const toNumberFault = faultedOperand(v);
          if (toNumberFault) { stack.push(toNumberFault); break; }
          stack.push(numberValue(v.toNumber()));
          break;
        }
        case OpCode.TO_HEX: {
          const v = safePop(stack);
          const toHexFault = faultedOperand(v);
          if (toHexFault) { stack.push(toHexFault); break; }
          // A colour already has a hex reading, so `#3366cc as rgb as hex` should
          // round-trip rather than collapse through toNumber() (which is 0 for a
          // colour). Re-tag its display format to hex, leaving channels intact.
          if (v.type === ValueType.Colour) {
            const c = v.value as ColourData;
            stack.push(colourValue({ r: c.r, g: c.g, b: c.b, a: c.a, format: "hex" }));
            break;
          }
          // A bigint keeps its bigint, exactly as ADD/SUB/MUL/DIV do:
          // `12345678901234567890n as hex` rendered 0xAB54A98CEB1F0800 while
          // the value ends 0AD2, because toNumber() rounded it first.
          stack.push(hexValue(v.type === ValueType.BigInt ? (v.value as bigint) : v.toNumber()));
          break;
        }
        case OpCode.TO_PERCENTAGE: {
          const v = safePop(stack);
          const toPercentageFault = faultedOperand(v);
          if (toPercentageFault) { stack.push(toPercentageFault); break; }
          stack.push(percentageValue(v.toNumber()));
          break;
        }
        case OpCode.TO_FRACTION: {
          const v = safePop(stack);
          const toFractionFault = faultedOperand(v);
          if (toFractionFault) { stack.push(toFractionFault); break; }
          // A value carrying its exact rational renders that fraction exactly;
          // everything else keeps the continued-fraction guess from the double,
          // so "0.75 as fraction" is still "3/4".
          stack.push(stringValue(v.rational !== undefined ? rationalToFractionString(v.rational) : toFractionString(v.toNumber())));
          break;
        }
        case OpCode.TO_MULTIPLIER: {
          const v = safePop(stack);
          const toMultiplierFault = faultedOperand(v);
          if (toMultiplierFault) { stack.push(toMultiplierFault); break; }
          stack.push(stringValue(toMultiplierString(v)));
          break;
        }
        case OpCode.TO_SCI: {
          const v = safePop(stack);
          const toSciFault = faultedOperand(v);
          if (toSciFault) { stack.push(toSciFault); break; }
          stack.push(stringValue(toScientificString(v.toNumber())));
          break;
        }
        // Numeric, like TO_HEX above. A base is a way of writing a number, so
        // `(255 as binary) + 1` has to be 256; as a string it was 1.
        case OpCode.TO_BINARY: {
          const v = safePop(stack);
          const toBinaryFault = faultedOperand(v);
          if (toBinaryFault) { stack.push(toBinaryFault); break; }
          stack.push(hexValue(v.type === ValueType.BigInt ? (v.value as bigint) : v.toNumber(), "bin"));
          break;
        }
        case OpCode.TO_OCTAL: {
          const v = safePop(stack);
          const toOctalFault = faultedOperand(v);
          if (toOctalFault) { stack.push(toOctalFault); break; }
          stack.push(hexValue(v.type === ValueType.BigInt ? (v.value as bigint) : v.toNumber(), "oct"));
          break;
        }
        case OpCode.CALL_AS_CONVERTER: {
          const name = stringOperand(safePop(stack), op, "converter name").toLowerCase();
          const value = safePop(stack);
          // A registered converter is arbitrary host code reading the Value
          // it is handed, so the fault is stopped before it gets there rather
          // than inside each converter.
          const converterFault = faultedOperand(value);
          if (converterFault) { stack.push(converterFault); break; }
          const converter = asConverterRegistry.get(name);
          if (!converter) {
            stack.push(errorValue("UNKNOWN_AS_CONVERTER", `Unknown converter "as ${name}"`));
          } else {
            stack.push(converter(value));
          }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §8  UoM  (OpCode 80–84)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.UOM_CONVERT: {
          const unit = stringOperand(safePop(stack), op, "unit name");
          const operand = safePop(stack);
          const faulted = faultedOperand(operand);
          if (faulted) { stack.push(faulted); break; }
          // Money keeps its exact decimal from here on. The amount either
          // arrived as a decimal literal (exact sidecar already set) or is a
          // whole number, either of which has an exact decimal; a fractional
          // double amount ("$sqrt(2)") has none and stays an ordinary float
          // Uom. Only currencies carry the sidecar, so every other unit (km,
          // kg, ...) is unchanged.
          const money = moneyExactMagnitude(operand, unit);
          if (money) stack.push(uomValueExact(operand.toNumber(), unit, money));
          else stack.push(uomValue(operand.toNumber(), unit));
          break;
        }
        case OpCode.UOM_CONVERT_TO: {
          const toUnit = stringOperand(safePop(stack), op, "target unit name");
          const fromUnit = stringOperand(safePop(stack), op, "source unit name");
          const operand = safePop(stack);
          // The quantity being converted may already have failed, and a
          // conversion is the one operator that made that invisible: it reads
          // the operand's number, gets the zero Error and Pending report, and
          // pushes it back wearing the unit the reader asked for. `5 kg to m
          // to s` answered `0.00 s` and `60 km/h in m/s` answered `0.00 /s`,
          // a plausible number in a unit with no numerator, with the failed
          // first conversion nowhere on screen. `binaryOp` has refused this
          // for `+` and `*` since it was written, which is why the same value
          // carried its fault everywhere except through here.
          const faulted = faultedOperand(operand);
          if (faulted) { stack.push(faulted); break; }
          const val = operand.toNumber();
          const measure = getMeasure(fromUnit);
          const isCurrency = sharedCurrencyExchange.isCurrency(fromUnit) && sharedCurrencyExchange.isCurrency(toUnit);
          if (measure && getMeasure(toUnit) === measure) {
            stack.push(uomValue(convertUnit(val, fromUnit, toUnit), toUnit));
          } else if (isCurrency) {
            const converted = sharedCurrencyExchange.convertSync(val, fromUnit, toUnit);
            if (converted !== null) {
              stack.push(uomValue(converted, toUnit));
            } else {
              // No live rate cached yet (or the fetch failed). Pushing the
              // unconverted value under its original unit would silently
              // masquerade as a correct conversion, e.g. "450 EUR to USD"
              // displaying as "450.00 EUR", which reads as a successful
              // no-op rather than the missing-data case it actually is.
              // An Error value makes the failure visible instead.
              stack.push(errorValue("CURRENCY_RATE_UNAVAILABLE", `No exchange rate available for ${fromUnit} to ${toUnit}`));
            }
          } else {
            // A rate or speed spelling ("km/h", "m/s", "mph") has no single
            // measure, so the checks above cannot see it. "100 km/h in mph"
            // and "10 m/s in km/h" reach conversion here, not through
            // convertUnit(). A null means the pair really is incompatible.
            const rate = convertRate(val, fromUnit, toUnit);
            if (rate !== null) {
              stack.push(uomValue(rate, toUnit));
            } else {
              stack.push(incompatibleConversionError(fromUnit, toUnit));
            }
          }
          break;
        }
        case OpCode.UOM_POSSIBILITIES: {
          // "sourceUnit to ?", pops the source unit name string, pushes a
          // human-readable list of every other unit in the same measure.
          const unit = stringOperand(safePop(stack), op, "unit name");
          const possibilities = getConvertiblePossibilities(unit);
          stack.push(stringValue(possibilities.length > 0 ? possibilities.join(", ") : `No known units for "${unit}"`));
          break;
        }
        case OpCode.UOM_BEST: {
          const unit = stringOperand(safePop(stack), op, "unit name");
          const operand = safePop(stack);
          const faulted = faultedOperand(operand);
          if (faulted) { stack.push(faulted); break; }
          const { value, unit: bestUnit } = getBestUnit(operand.toNumber(), unit);
          stack.push(uomValue(value, bestUnit));
          break;
        }
        case OpCode.UOM_CONVERT_IN: {
          const toUnit = stringOperand(safePop(stack), op, "target unit name");
          const left = safePop(stack);
          // See UOM_CONVERT_TO above. This is the spelling `5 kg to m to s`
          // actually reaches, since the second conversion's source is an
          // expression rather than a literal: an Error is not a Uom, so it
          // fell into the else branch at the bottom and came back out as
          // `uomValue(0, "s")`.
          const faulted = faultedOperand(left);
          if (faulted) { stack.push(faulted); break; }
          if (left.type === ValueType.Uom) {
            const fromUnit = left.unit!;
            const val = left.toNumber();
            const measure = getMeasure(fromUnit);
            const isCurrency = sharedCurrencyExchange.isCurrency(fromUnit) && sharedCurrencyExchange.isCurrency(toUnit);
            if (measure && getMeasure(toUnit) === measure) {
              stack.push(uomValue(convertUnit(val, fromUnit, toUnit), toUnit));
            } else if (isCurrency) {
              const converted = sharedCurrencyExchange.convertSync(val, fromUnit, toUnit);
              if (converted !== null) {
                stack.push(uomValue(converted, toUnit));
              } else {
                // See the matching comment in UOM_CONVERT_TO, pushing the
                // original value here would silently pass off a missing
                // exchange rate as a successful (non-)conversion.
                stack.push(errorValue("CURRENCY_RATE_UNAVAILABLE", `No exchange rate available for ${fromUnit} to ${toUnit}`));
              }
            } else {
              // Rate or speed conversion, "(120 km / 2 hours) in kph". See the
              // matching branch in UOM_CONVERT_TO above.
              const rate = convertRate(val, fromUnit, toUnit);
              if (rate !== null) {
                stack.push(uomValue(rate, toUnit));
              } else {
                stack.push(incompatibleConversionError(fromUnit, toUnit));
              }
            }
          } else {
            stack.push(uomValue(left.toNumber(), toUnit));
          }
          break;
        }
        case OpCode.UOM_GET_VALUE: {
          const v = safePop(stack);
          const getValueFault = faultedOperand(v);
          if (getValueFault) { stack.push(getValueFault); break; }
          stack.push(numberValue(v.toNumber()));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §8.5  Rate, "quantity per unit of something" (OpCode 110–112)
        //       See vm/Value.ts's rateValue()/isRateUnit()/splitRateUnit().
        // ═══════════════════════════════════════════════════════════════
        case OpCode.RATE_DIV: {
          // Construction: Uom ÷ Uom (different measures) -> Rate.
          // "90 km / 3 day" -> "30 km/day": magnitude divides, units join.
          const denominatorVal = safePop(stack);
          const numeratorVal = safePop(stack);
          // "60 km/h in m/s" reaches here with a failed conversion as its
          // numerator, and a rate built from one is the same silent zero the
          // conversion opcodes had, wearing an even stranger unit: the
          // numerator label comes off the operand's type, so an Error
          // contributed no label at all and the answer displayed as
          // "0.00 /s", a rate of nothing per second.
          const rateDivFault = faultedOperand(numeratorVal, denominatorVal);
          if (rateDivFault) { stack.push(rateDivFault); break; }
          if (denominatorVal.type !== ValueType.Uom || !denominatorVal.unit) {
            stack.push(errorValue("RATE_MISSING_DENOMINATOR_UNIT", "Cannot build a rate: the right-hand side of \"/\" has no unit"));
            break;
          }
          const numeratorUnit = numeratorVal.type === ValueType.Uom ? (numeratorVal.unit ?? "") : "";
          stack.push(rateValue(numeratorVal.toNumber() / denominatorVal.toNumber(), numeratorUnit, denominatorVal.unit));
          break;
        }
        case OpCode.RATE_MUL: {
          // Explicit form of the same rate-multiplication OpCode.MUL now
          // applies automatically to any Uom×Uom pair where one side is
          // rate-shaped. See multiplyRateByMatchingUom(). Kept as its own
          // opcode for packages that want to emit it deliberately rather
          // than relying on operand-type auto-detection.
          const multiplier = safePop(stack);
          const rate = safePop(stack);
          const rateMulFault = faultedOperand(rate, multiplier);
          if (rateMulFault) { stack.push(rateMulFault); break; }
          if (rate.type !== ValueType.Uom || !isRateUnit(rate.unit)) {
            stack.push(errorValue("RATE_MUL_LEFT_NOT_A_RATE", "Left-hand side of a rate multiplication must be a rate (e.g. \"$50/week\")"));
            break;
          }
          if (multiplier.type !== ValueType.Uom || !multiplier.unit) {
            stack.push(errorValue("RATE_MUL_RIGHT_MISSING_UNIT", "Right-hand side of a rate multiplication must have a unit matching the rate's denominator"));
            break;
          }
          stack.push(multiplyRateByMatchingUom(rate, multiplier));
          break;
        }
        case OpCode.RATE_CONVERT: {
          // Rescale a rate's denominator to a new unit, preserving the
          // real-world rate. "30/week as /month" -> "~130/month".
          const newDenominatorUnit = stringOperand(safePop(stack), op, "denominator unit name");
          const rate = safePop(stack);
          const rateConvertFault = faultedOperand(rate);
          if (rateConvertFault) { stack.push(rateConvertFault); break; }
          if (rate.type !== ValueType.Uom || !isRateUnit(rate.unit)) {
            stack.push(errorValue("RATE_CONVERT_NOT_A_RATE", "Cannot convert a non-rate value's denominator"));
            break;
          }
          const { numerator, denominator } = splitRateUnit(rate.unit);
          const rateMeasure = getMeasure(denominator);
          const targetMeasure = getMeasure(newDenominatorUnit);
          if (!rateMeasure || rateMeasure !== targetMeasure) {
            stack.push(errorValue(
              "RATE_CONVERT_MEASURE_MISMATCH",
              `Cannot convert a "${denominator}"-denominated rate to "${newDenominatorUnit}" — different measures`
            ));
            break;
          }
          // How many `denominator` units are in one `newDenominatorUnit`
          // (e.g. how many weeks in 1 month), the rate scales by that factor.
          const factor = convertUnit(1, newDenominatorUnit, denominator);
          stack.push(rateValue(rate.toNumber() * factor, numerator, newDenominatorUnit));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §8.7  Time, clock-time-of-day (OpCode 120)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.CLOCK_TIME_TODAY: {
          // "9:00am"/"16:00", anchored to TODAY's calendar date, not a
          // relative offset from `now` (so it stays correct regardless of
          // what time it currently is, "9:00am" always means 9am today).
          const minutesValue = safePop(stack);
          const clockFault = faultedOperand(minutesValue);
          if (clockFault) { stack.push(clockFault); break; }
          const totalMinutes = minutesValue.toNumber();
          const now = new Date();
          const anchored = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          anchored.setMinutes(totalMinutes);
          stack.push(datetimeValue(anchored.getTime()));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §9  Datetime  (OpCode 90–93)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.DATE_NOW:
          stack.push(datetimeValue(Date.now()));
          break;
        case OpCode.DATE_LITERAL:
          stack.push(datetimeValue(numbers[poolIndex(opcodes, ip++, op, "constant-pool index", numbers.length, "number-pool")]));
          break;
        case OpCode.DATE_ADD: {
          const durValue = safePop(stack), dtValue = safePop(stack);
          // A duration read off a fault is zero, so the date came back
          // unmoved: an answer that looks exactly like a correct one. Same
          // reasoning as OpCode.ADD's own check.
          const dateAddFault = faultedOperand(dtValue, durValue);
          if (dateAddFault) { stack.push(dateAddFault); break; }
          stack.push(datetimeValue(shiftDatetime(dtValue.toNumber(), durValue, 1, vm)));
          break;
        }
        case OpCode.DATE_SUB: {
          const durValue = safePop(stack), dtValue = safePop(stack);
          const dateSubFault = faultedOperand(dtValue, durValue);
          if (dateSubFault) { stack.push(dateSubFault); break; }
          stack.push(datetimeValue(shiftDatetime(dtValue.toNumber(), durValue, -1, vm)));
          break;
        }
        case OpCode.DATE_WORKDAY_OFFSET: {
          // "N working days after/before/from <date>". One operand byte gives
          // the direction: 0 forward (after/from), 1 backward (before). The
          // anchor date is on top (WorkdayOffsetParselet compiles it last); the
          // count is the left operand beneath it. Routed through the same
          // addBusinessDays() as `<date> + N workdays`, so the two forms and
          // the holiday calendar stay in lockstep.
          const workdayDirection = operandByte(opcodes, ip++, op, "workday offset direction") === 1 ? -1 : 1;
          const anchorValue = safePop(stack), countValue = safePop(stack);
          const offsetFault = faultedOperand(countValue, anchorValue);
          if (offsetFault) { stack.push(offsetFault); break; }
          if (anchorValue.type !== ValueType.Datetime) {
            stack.push(errorValue(
              CoreErrorCodes.WORKDAY_OFFSET_EXPECTED_DATE,
              `"working days after/before/from" expects a date to count from, got ${ValueType[anchorValue.type] ?? "an unsupported value"}`,
            ));
            break;
          }
          stack.push(datetimeValue(addBusinessDays(anchorValue.toNumber(), workdayDirection * countValue.toNumber(), vm)));
          break;
        }
        case OpCode.DATE_WORKDAYS_BETWEEN: {
          // "working days between <date> and <date>": the count of working days
          // in the inclusive span, order-independent. Stack: [start, end], end
          // on top (WorkdaysBetweenParselet compiles the second endpoint last).
          const endValue = safePop(stack), startValue = safePop(stack);
          const betweenFault = faultedOperand(startValue, endValue);
          if (betweenFault) { stack.push(betweenFault); break; }
          if (startValue.type !== ValueType.Datetime || endValue.type !== ValueType.Datetime) {
            stack.push(errorValue(
              CoreErrorCodes.WORKDAYS_BETWEEN_EXPECTED_DATES,
              `"working days between" expects two dates, got ${ValueType[startValue.type] ?? "an unsupported value"} and ${ValueType[endValue.type] ?? "an unsupported value"}`,
            ));
            break;
          }
          // Bounded by the full configured offset range in calendar days, so a
          // span of millennia is refused rather than walked a day at a time.
          const spanLimitDays = Math.ceil((vm.getMaxDateOffsetYears() - vm.getMinDateOffsetYears()) * 366);
          const workdayCount = countBusinessDaysBetween(startValue.toNumber(), endValue.toNumber(), (ms) => vm.isHoliday(ms), spanLimitDays);
          if (workdayCount === null) {
            stack.push(errorValue(
              CoreErrorCodes.WORKDAYS_BETWEEN_RANGE_TOO_LARGE,
              `The two dates are more than ${vm.getMaxDateOffsetYears() - vm.getMinDateOffsetYears()} years apart, past the working-day count's limit`,
            ));
            break;
          }
          stack.push(numberValue(workdayCount));
          break;
        }
        case OpCode.DATE_NEXT_WEEKDAY:
        case OpCode.DATE_LAST_WEEKDAY: {
          // Stack: [now, targetDayIndex], targetDayIndex on top (0=Sunday..6=Saturday).
          // Computes the actual next/previous occurrence of that weekday,
          // NOT a blind ±7-day offset, "next Monday" from a Monday lands
          // 7 days ahead (next week's Monday), not today; "last Monday"
          // from a Monday lands 7 days back, not today. Time-of-day is
          // preserved from `now` (matches "today"/"now" both resolving to
          // the current instant elsewhere in this file, not midnight).
          const targetDayValue = safePop(stack);
          const nowValue = safePop(stack);
          const weekdayFault = faultedOperand(nowValue, targetDayValue);
          if (weekdayFault) { stack.push(weekdayFault); break; }
          const targetDay = targetDayValue.toNumber();
          const now = nowValue.toNumber();
          const currentDay = new Date(now).getDay();
          let diffDays = op === OpCode.DATE_NEXT_WEEKDAY
            ? (targetDay - currentDay + 7) % 7
            : (currentDay - targetDay + 7) % 7;
          if (diffDays === 0) diffDays = 7;
          // Stepped as calendar days rather than added as milliseconds: a
          // week that contains a daylight-saving transition is not 7 x
          // 86,400,000 ms long, and being an hour out is enough to land on the
          // day before or after the weekday that was asked for. See
          // addCalendarDays() above.
          stack.push(datetimeValue(addCalendarDays(now, op === OpCode.DATE_NEXT_WEEKDAY ? diffDays : -diffDays)));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §10 Matrix  (OpCode 152+, see parser/OpCode.ts's Matrix band)
        //     Replaces the old ARR_* vector-only opcodes (100-107), which
        //     were never emitted by any registered parselet in production
        //     confirmed dead code, deleted outright rather than repurposed.
        //     See vm/Value.ts's MatrixData and vm/MatrixOps.ts's shared
        //     column-major storage helpers.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.MAT_NEW: {
          const rows = operandByte(opcodes, ip++, op, "row count");
          const cols = operandByte(opcodes, ip++, op, "column count");
          const count = rows * cols;
          // Cells were pushed in ROW-MAJOR reading order (matching how a
          // literal like `[1,2;3,4]` is textually written), pop in
          // reverse to restore that order, then transpose once into the
          // column-major storage MatrixData actually uses.
          const rowMajor = checkedArray<MatrixEntry>(count, "matrix cells");
          // A MatrixEntry is a number, a boolean or a symbolic node, so a
          // faulted cell has nowhere to live inside the matrix and became a
          // zero cell nothing could tell apart from a real one. The whole
          // literal fails instead, the way one bad cell fails a map() (see
          // MAP_INVOKE's own check).
          let cellFault: Value | null = null;
          for (let i = count - 1; i >= 0; i--) {
            const cellVal = safePop(stack);
            if (cellFault === null) cellFault = faultedOperand(cellVal);
            rowMajor[i] = cellVal.type === ValueType.Boolean ? (cellVal.value as boolean)
              : cellVal.type === ValueType.Symbolic ? (cellVal.value as SymbolicNodeType)
              : cellVal.toNumber();
          }
          if (cellFault) { stack.push(cellFault); break; }
          stack.push(matrixValue(rows, cols, rowMajorToColumnMajor(rows, cols, rowMajor)));
          break;
        }

        case OpCode.MAT_INDEX1: {
          const indexVal = safePop(stack), matrixVal = safePop(stack);
          // Pending as well as Error, here and in the three cases below: a
          // value that has not arrived yet indexes no better than one that
          // failed, and toNumber() reports zero for both. These checked only
          // Error, so an index still loading read as cell 0.
          const index1Fault = faultedOperand(matrixVal, indexVal);
          if (index1Fault) { stack.push(index1Fault); break; }
          if (matrixVal.type !== ValueType.Matrix) {
            stack.push(errorValue("MATRIX_INDEX_NOT_A_MATRIX", `Cannot index a non-matrix value with "[...]".`));
            break;
          }
          const m = matrixVal.value as MatrixData;
          const index = Math.trunc(indexVal.toNumber());
          if (index < 0 || index >= m.data.length) {
            stack.push(errorValue(
              "MATRIX_INDEX_OUT_OF_BOUNDS",
              `Index ${index} is out of bounds for a ${m.rows}x${m.cols} matrix (valid range: 0-${m.data.length - 1}).`,
            ));
            break;
          }
          const cell = matIndex(m, index);
          stack.push(matrixEntryToValue(cell));
          break;
        }

        case OpCode.MAT_INDEX2: {
          const colVal = safePop(stack), rowVal = safePop(stack), matrixVal = safePop(stack);
          const index2Fault = faultedOperand(matrixVal, rowVal, colVal);
          if (index2Fault) { stack.push(index2Fault); break; }
          if (matrixVal.type !== ValueType.Matrix) {
            stack.push(errorValue("MATRIX_INDEX_NOT_A_MATRIX", `Cannot index a non-matrix value with "[...]".`));
            break;
          }
          const m = matrixVal.value as MatrixData;
          const row = Math.trunc(rowVal.toNumber());
          const col = Math.trunc(colVal.toNumber());
          if (!inBounds(m, row, col)) {
            stack.push(errorValue(
              "MATRIX_INDEX_OUT_OF_BOUNDS",
              `[${row}, ${col}] is out of bounds for a ${m.rows}x${m.cols} matrix.`,
            ));
            break;
          }
          const cell = matAt(m, row, col);
          stack.push(matrixEntryToValue(cell));
          break;
        }

        case OpCode.RANGE_NEW: {
          const maxVal = safePop(stack), minVal = safePop(stack);
          const rangeFault = faultedOperand(minVal, maxVal);
          if (rangeFault) { stack.push(rangeFault); break; }
          if (minVal.type !== ValueType.Number || maxVal.type !== ValueType.Number) {
            stack.push(errorValue("INVALID_RANGE_BOUND", `A range's bounds must be plain numbers (e.g. "0:3").`));
            break;
          }
          const min = minVal.value as number;
          const max = maxVal.value as number;
          if (!Number.isInteger(min) || !Number.isInteger(max)) {
            stack.push(errorValue("NON_INTEGER_RANGE_BOUND", `A range's bounds must be whole numbers, got "${min}:${max}".`));
            break;
          }
          if (min > max) {
            stack.push(errorValue(
              "DESCENDING_RANGE",
              `A range's min (${min}) cannot be greater than its max (${max}) — did you mean "${max}:${min}"?`,
            ));
            break;
          }
          stack.push(rangeValue(min, max));
          break;
        }

        case OpCode.MAT_SLICE: {
          const colRangeVal = safePop(stack), rowRangeVal = safePop(stack), matrixVal = safePop(stack);
          const sliceFault = faultedOperand(matrixVal, rowRangeVal, colRangeVal);
          if (sliceFault) { stack.push(sliceFault); break; }
          if (matrixVal.type !== ValueType.Matrix) {
            stack.push(errorValue("MATRIX_INDEX_NOT_A_MATRIX", `Cannot slice a non-matrix value with "[...]".`));
            break;
          }
          if (rowRangeVal.type !== ValueType.Range || colRangeVal.type !== ValueType.Range) {
            stack.push(errorValue("INVALID_MATRIX_SLICE_BOUND", `Matrix slicing needs range bounds (e.g. "a[0:1, 1:2]").`));
            break;
          }
          const m = matrixVal.value as MatrixData;
          const rowRange = rowRangeVal.value as RangeData;
          const colRange = colRangeVal.value as RangeData;
          if (rowRange.min < 0 || rowRange.max >= m.rows || colRange.min < 0 || colRange.max >= m.cols) {
            stack.push(errorValue(
              "MATRIX_INDEX_OUT_OF_BOUNDS",
              `Slice [${rowRange.min}:${rowRange.max}, ${colRange.min}:${colRange.max}] is out of bounds for a ${m.rows}x${m.cols} matrix.`,
            ));
            break;
          }
          const newRows = rowRange.max - rowRange.min + 1;
          const newCols = colRange.max - colRange.min + 1;
          const data = checkedArray<MatrixEntry>(newRows * newCols, "matrix cells");
          for (let r = 0; r < newRows; r++) {
            for (let c = 0; c < newCols; c++) {
              data[r + c * newRows] = matAt(m, rowRange.min + r, colRange.min + c);
            }
          }
          stack.push(matrixValue(newRows, newCols, data));
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §11 map/reduce  (OpCode 157-158, see parser/OpCode.ts's Matrix
        //     band). See packages/mapreduce/ for the parselets that decide
        //     `kind` (0=inline anonymous body, 1=builtin function,
        //     2=user-defined function) at parse time, and
        //     `BytecodeBuilder.ts`'s AnonymousBodyDef doc comment for why
        //     kind-0 bodies are a SEPARATE side-table from userFunctionBodies.
        // ═══════════════════════════════════════════════════════════════
        case OpCode.MAP_INVOKE: {
          const kind = operandByte(opcodes, ip++, op, "body kind");
          const ref = operandByte(opcodes, ip++, op, "body reference");
          const collectionCount = operandByte(opcodes, ip++, op, "collection count");
          requireKnownBodyKind(kind, ref, op);

          // Collections were pushed in declared param order, pop in
          // reverse to restore that order (same convention as MAT_NEW's
          // row-major restore).
          const rawCollections: Value[] = new Array(collectionCount);
          for (let i = collectionCount - 1; i >= 0; i--) rawCollections[i] = safePop(stack);

          let paramNames: string[] = [];
          let program: BytecodeProgram | undefined;
          if (kind === 0) {
            const def = anonymousBodies?.[ref];
            if (!def) {
              throw ErrorFactory.internal(
                "INTERNAL_MISSING_ANONYMOUS_BODY",
                `Internal error: MAP_INVOKE referenced missing anonymous body index ${ref}`,
                { ref },
              );
            }
            paramNames = def.params;
            program = def.program;
          } else if (kind === 2) {
            const name = pooledString(strings, ref, op);
            const fn = vm.getUserFunction(name);
            if (!fn) {
              stack.push(errorValue("UNDEFINED_FUNCTION", `map: undefined function "${name}"`));
              break;
            }
            if (fn.params.length !== collectionCount) {
              stack.push(errorValue(
                "FUNCTION_ARITY_MISMATCH",
                `map: "${name}" expects ${fn.params.length} argument(s) but ${collectionCount} collection(s) were given`,
              ));
              break;
            }
            paramNames = fn.params;
            program = fn.program;
          }

          // Resolve every collection into a flat array of per-cell Values
          // (a Matrix's own cells, or a materialized Range), all must
          // agree on length (this is a ZIP, not a cartesian product).
          let collectionLength = -1;
          const cellArrays: Value[][] = new Array(collectionCount);
          let mapEarlyError: Value | undefined;
          for (let i = 0; i < collectionCount; i++) {
            const resolved = collectionToValues(rawCollections[i], vm.getMaxCollectionSize());
            if (!Array.isArray(resolved)) { mapEarlyError = resolved; break; }
            // Charged after the fact, which is safe only because
            // `maxCollectionSize` has already bounded this one expansion to
            // something survivable. The tally is what stops the SECOND and
            // third: individually legal collections are legal together, and
            // nothing else counts them. Delete this line if
            // `collectionToValues()` ever charges before expanding, which is
            // the better place for it (it knows the length before it allocates)
            // and would make this a double charge.
            chargeAllocation(resolved.length, "collection elements");
            if (collectionLength === -1) {
              collectionLength = resolved.length;
            } else if (resolved.length !== collectionLength) {
              mapEarlyError = errorValue(
                "MAP_COLLECTION_LENGTH_MISMATCH",
                `map: all collections must have the same length (got ${collectionLength} and ${resolved.length}).`,
              );
              break;
            }
            cellArrays[i] = resolved;
          }
          if (mapEarlyError) { stack.push(mapEarlyError); break; }

          const resultData: MatrixEntry[] = checkedArray<MatrixEntry>(collectionLength, "matrix cells");
          let mapError: Value | undefined;
          for (let i = 0; i < collectionLength; i++) {
            const args: Value[] = new Array(collectionCount);
            for (let j = 0; j < collectionCount; j++) args[j] = cellArrays[j][i];

            const resultVal = kind === 1
              ? (builtinFunctions[ref]?.(args) ?? errorValue("UNKNOWN_BUILTIN_FUNCTION", `map: unknown builtin function index ${ref}`))
              : invokeFrameBody(paramNames, program!, args, vm, pipeline, expression, context, !!symbolicTolerant);

            const resultFault = faultedOperand(resultVal);
            if (resultFault) { mapError = resultFault; break; }
            resultData[i] = resultVal.type === ValueType.Boolean ? (resultVal.value as boolean)
              : resultVal.type === ValueType.Symbolic ? (resultVal.value as SymbolicNodeType)
              : resultVal.toNumber();
          }
          if (mapError) { stack.push(mapError); break; }

          // A mapped matrix keeps the shape it was given. `resultData` is
          // filled in the same order `collectionToValues()` read the cells
          // out, which for a Matrix is its own column-major storage order,
          // so handing that array straight back with the source dimensions
          // puts every result in the cell its input came from. Without this
          // `map(x*2, [1,2;3,4])` answered a 1x4 row reading [2,6,4,8]: not
          // just the wrong shape but the storage order leaking into what the
          // user sees, since 6 is the image of 3, the cell BELOW 1. A Range
          // (and a 1xN literal) is a row either way.
          const firstCollection = rawCollections[0];
          const sourceShape = firstCollection?.type === ValueType.Matrix ? (firstCollection.value as MatrixData) : undefined;
          if (sourceShape && sourceShape.rows * sourceShape.cols === collectionLength) {
            stack.push(matrixValue(sourceShape.rows, sourceShape.cols, resultData));
          } else {
            stack.push(matrixValue(1, collectionLength, resultData));
          }
          break;
        }

        case OpCode.REDUCE_INVOKE: {
          const kind = operandByte(opcodes, ip++, op, "body kind");
          const ref = operandByte(opcodes, ip++, op, "body reference");
          const hasInitial = operandByte(opcodes, ip++, op, "initial-value flag");
          requireKnownBodyKind(kind, ref, op);

          // Pushed in textual order (collection, then optional initial)
          // pop in reverse.
          const initialVal = hasInitial ? safePop(stack) : undefined;
          const collectionVal = safePop(stack);

          let paramNames: string[] = [];
          let program: BytecodeProgram | undefined;
          if (kind === 0) {
            const def = anonymousBodies?.[ref];
            if (!def) {
              throw ErrorFactory.internal(
                "INTERNAL_MISSING_ANONYMOUS_BODY",
                `Internal error: REDUCE_INVOKE referenced missing anonymous body index ${ref}`,
                { ref },
              );
            }
            paramNames = def.params;
            program = def.program;
          } else if (kind === 2) {
            const name = pooledString(strings, ref, op);
            const fn = vm.getUserFunction(name);
            if (!fn) {
              stack.push(errorValue("UNDEFINED_FUNCTION", `reduce: undefined function "${name}"`));
              break;
            }
            if (fn.params.length !== 2) {
              stack.push(errorValue(
                "FUNCTION_ARITY_MISMATCH",
                `reduce: "${name}" must take exactly 2 arguments (accumulator, element), got ${fn.params.length}`,
              ));
              break;
            }
            paramNames = fn.params;
            program = fn.program;
          }

          const cells = collectionToValues(collectionVal, vm.getMaxCollectionSize());
          if (!Array.isArray(cells)) { stack.push(cells); break; }
          // Same post-charge, and the same note, as MAP_INVOKE above.
          chargeAllocation(cells.length, "collection elements");

          let acc: Value;
          let startIdx: number;
          if (initialVal !== undefined) {
            const initialFault = faultedOperand(initialVal);
            if (initialFault) { stack.push(initialFault); break; }
            acc = initialVal;
            startIdx = 0;
          } else {
            if (cells.length === 0) {
              stack.push(errorValue("REDUCE_EMPTY_COLLECTION", `reduce: cannot reduce an empty collection without an initial value.`));
              break;
            }
            acc = cells[0];
            startIdx = 1;
          }

          let reduceError: Value | undefined;
          for (let i = startIdx; i < cells.length; i++) {
            const args = [acc, cells[i]];
            const resultVal = kind === 1
              ? (builtinFunctions[ref]?.(args) ?? errorValue("UNKNOWN_BUILTIN_FUNCTION", `reduce: unknown builtin function index ${ref}`))
              : invokeFrameBody(paramNames, program!, args, vm, pipeline, expression, context, !!symbolicTolerant);

            const stepFault = faultedOperand(resultVal);
            if (stepFault) { reduceError = stepFault; break; }
            acc = resultVal;
          }
          if (reduceError) { stack.push(reduceError); break; }

          stack.push(acc);
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // §12 Algebra verbs' bound unknown  (OpCode 159)
        // ═══════════════════════════════════════════════════════════════
        case OpCode.BIND_UNKNOWN: {
          const ref = operandByte(opcodes, ip++, op, "body reference");
          const def = anonymousBodies?.[ref];
          if (!def) {
            throw ErrorFactory.internal(
              "INTERNAL_MISSING_ANONYMOUS_BODY",
              `Internal error: BIND_UNKNOWN referenced missing anonymous body index ${ref}`,
              { ref },
            );
          }
          // `der(x^2, x)` names x as the unknown, so inside that expression x
          // IS the unknown, whatever the document says elsewhere. Evaluated in
          // a call frame binding the name to itself, the same mechanism that
          // already makes a function's parameter shadow a document variable
          // (see `getVar`, which reads the innermost frame first). Without it
          // an earlier `:x = 5` turned `der(x^2, x)` into `der(25, x)`, and
          // the answer 0 looked exactly like a correct one.
          stack.push(invokeWithBoundUnknown(def.params[0], def.program, vm, pipeline, expression, context, !!symbolicTolerant));
          break;
        }

      }
    }

    // Fallback return (reached if while loop exits without HALT, shouldn't happen on valid bytecode)
    const fallback = safePop(stack);
    return { type: 'value', value: hasArena ? persistentValue(fallback) : fallback };
    } catch (e) {
        return { type: 'error', error: normalizeUnknownError(e) };
    } finally {
        endEvaluation();
    }
}